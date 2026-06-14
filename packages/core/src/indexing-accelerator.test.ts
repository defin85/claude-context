import { envManager } from './utils/env-manager';
import {
    AsyncLimiter,
    AdaptiveBackpressureController,
    createAdaptivePressureSignals,
    createDefaultAdaptiveBackpressureConfig,
    evaluateAdaptivePressure,
    getEffectiveEmbeddingPayloadLimits,
    getIndexingAcceleratorConfig,
    IndexingAcceleratorRuntime,
    resolveVectorWritePolicy,
    shouldAccelerateIndexing,
} from './indexing-accelerator';
import { getPreIndexTraversalConcurrency } from './sync/preindex-traversal';

describe('indexing accelerator configuration', () => {
    let getSpy: jest.SpyInstance<string | undefined, [name: string]>;

    beforeEach(() => {
        getSpy = jest.spyOn(envManager, 'get').mockReturnValue(undefined);
    });

    afterEach(() => {
        getSpy.mockRestore();
    });

    function mockEnv(values: Record<string, string | undefined>): void {
        getSpy.mockImplementation((name: string) => values[name]);
    }

    it('defaults to conservative single-worker behavior when disabled', () => {
        const config = getIndexingAcceleratorConfig();

        expect(config).toEqual({
            mode: 'off',
            embeddingBatchSize: 100,
            insertBatchSize: 100,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            insertQueueCapacity: 2,
            maxBgeM3Workers: 1,
            vramLimitPercent: 75,
            retryBudget: 1,
            accelerateBackgroundSync: false,
            embeddingMaxContentChars: undefined,
            embeddingMaxEstimatedTokens: undefined,
            writeCoalescingEnabled: false,
            writeCoalescingTargetDocuments: undefined,
            writeCoalescingMaxDocuments: undefined,
            writeCoalescingFlushIntervalMs: undefined,
            adaptiveBackpressure: createDefaultAdaptiveBackpressureConfig(false),
        });
        expect(shouldAccelerateIndexing(config, {
            isInitialOrForce: true,
            isBackgroundSync: false,
        })).toEqual({
            active: false,
            fallbackReason: 'accelerator disabled',
        });
    });

    it('parses auto mode, concurrency, VRAM budget, retry budget, and background sync policy', () => {
        mockEnv({
            INDEX_ACCELERATOR_MODE: 'auto',
            INDEX_EMBEDDING_BATCH_SIZE: '256',
            INDEX_INSERT_BATCH_SIZE: '64',
            INDEX_EMBEDDING_CONCURRENCY: '4',
            INDEX_INSERT_CONCURRENCY: '2',
            INDEX_INSERT_QUEUE_CAPACITY: '8',
            INDEX_EMBEDDING_MAX_CONTENT_CHARS: '1000000',
            INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS: '250000',
            INDEX_WRITE_COALESCING: 'false',
            INDEX_WRITE_COALESCING_TARGET_DOCUMENTS: '120',
            INDEX_WRITE_COALESCING_MAX_DOCUMENTS: '360',
            INDEX_WRITE_COALESCING_FLUSH_INTERVAL_MS: '125',
            BGE_M3_ACCELERATOR_MAX_WORKERS: '3',
            BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT: '75',
            INDEX_ACCELERATOR_RETRY_BUDGET: '5',
            INDEX_ACCELERATE_BACKGROUND_SYNC: 'true',
            INDEX_ADAPTIVE_BACKPRESSURE: 'true',
            INDEX_ADAPTIVE_INSERT_BACKLOG_THRESHOLD: '6',
            INDEX_ADAPTIVE_INSERT_LATENCY_MS_THRESHOLD: '12000',
            INDEX_ADAPTIVE_RETRY_RATE_THRESHOLD: '0.25',
            INDEX_ADAPTIVE_REJECTED_WORKERS_THRESHOLD: '2',
            INDEX_ADAPTIVE_MEMORY_FREE_PERCENT_THRESHOLD: '12',
            INDEX_ADAPTIVE_VRAM_USAGE_LIMIT_PERCENT: '80',
        });

        const config = getIndexingAcceleratorConfig();

        expect(config).toEqual({
            mode: 'auto',
            embeddingBatchSize: 256,
            insertBatchSize: 64,
            embeddingConcurrency: 4,
            insertConcurrency: 2,
            insertQueueCapacity: 8,
            maxBgeM3Workers: 3,
                vramLimitPercent: 75,
                retryBudget: 5,
                accelerateBackgroundSync: true,
                embeddingMaxContentChars: 1000000,
                embeddingMaxEstimatedTokens: 250000,
                writeCoalescingEnabled: false,
                writeCoalescingTargetDocuments: 120,
                writeCoalescingMaxDocuments: 360,
                writeCoalescingFlushIntervalMs: 125,
                adaptiveBackpressure: {
                    enabled: true,
                    minEmbeddingConcurrency: 1,
                    highPressureThreshold: 1,
                    lowPressureThreshold: 0.5,
                    healthySampleCount: 3,
                    cooldownMs: 5000,
                    insertBacklogThreshold: 6,
                    insertBacklogMinBatches: 30,
                    insertLatencyMsThreshold: 12000,
                retryRateThreshold: 0.25,
                retryRateMinBatches: 10,
                rejectedWorkersThreshold: 2,
                memoryFreePercentThreshold: 12,
                vramUsageLimitPercent: 80,
            },
        });
        expect(shouldAccelerateIndexing(config, {
            isInitialOrForce: true,
            isBackgroundSync: false,
        })).toEqual({ active: true });
    });

    it('keeps auto mode insert concurrency conservative by default', () => {
        mockEnv({
            INDEX_ACCELERATOR_MODE: 'auto',
        });

        const config = getIndexingAcceleratorConfig();

        expect(config.embeddingConcurrency).toBe(2);
        expect(config.insertConcurrency).toBe(1);
    });

    it('falls back for invalid values and clamps percent values', () => {
        mockEnv({
            BGE_M3_ACCELERATOR: 'auto',
            INDEX_EMBEDDING_BATCH_SIZE: '0',
            INDEX_INSERT_BATCH_SIZE: '20000',
            INDEX_EMBEDDING_CONCURRENCY: 'bad',
            INDEX_INSERT_CONCURRENCY: '-1',
            INDEX_EMBEDDING_MAX_CONTENT_CHARS: '0',
            INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS: '999999999999',
            BGE_M3_ACCELERATOR_MAX_WORKERS: '0',
            BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT: '500',
            INDEX_ACCELERATOR_RETRY_BUDGET: 'nope',
            INDEX_ACCELERATE_BACKGROUND_SYNC: 'maybe',
        });

        const config = getIndexingAcceleratorConfig();

        expect(config.mode).toBe('auto');
        expect(config.embeddingBatchSize).toBe(100);
        expect(config.insertBatchSize).toBe(10000);
        expect(config.embeddingConcurrency).toBe(2);
        expect(config.insertConcurrency).toBe(1);
        expect(config.maxBgeM3Workers).toBe(1);
        expect(config.vramLimitPercent).toBe(100);
        expect(config.retryBudget).toBe(1);
        expect(config.accelerateBackgroundSync).toBe(false);
        expect(config.embeddingMaxContentChars).toBeUndefined();
        expect(config.embeddingMaxEstimatedTokens).toBeLessThan(999999999999);
    });

    it('applies BGE-M3 full payload-safe effective limits without reducing dense-only defaults', () => {
        const config = getIndexingAcceleratorConfig();

        expect(getEffectiveEmbeddingPayloadLimits(config, 'dense')).toEqual({
            maxContentChars: undefined,
            maxEstimatedTokens: undefined,
        });
        expect(getEffectiveEmbeddingPayloadLimits(config, 'bge_m3_dense')).toEqual({
            maxContentChars: undefined,
            maxEstimatedTokens: undefined,
        });
        expect(getEffectiveEmbeddingPayloadLimits(config, 'bge_m3_full')).toEqual({
            maxContentChars: expect.any(Number),
            maxEstimatedTokens: expect.any(Number),
        });
    });

    it('lets explicit payload limit overrides apply to all retrieval modes', () => {
        mockEnv({
            INDEX_EMBEDDING_MAX_CONTENT_CHARS: '12345',
            INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS: '3456',
        });

        const config = getIndexingAcceleratorConfig();

        expect(getEffectiveEmbeddingPayloadLimits(config, 'dense')).toEqual({
            maxContentChars: 12345,
            maxEstimatedTokens: 3456,
        });
        expect(getEffectiveEmbeddingPayloadLimits(config, 'bge_m3_full')).toEqual({
            maxContentChars: 12345,
            maxEstimatedTokens: 3456,
        });
    });

    it('scores pressure from explicit downstream and guardrail signals', () => {
        const config = createDefaultAdaptiveBackpressureConfig(true);

        expect(evaluateAdaptivePressure(config, {
            insertBacklog: 3,
            insertLatencyMs: 0,
            retryRate: 0,
            submittedBatches: 30,
            retriedBatches: 0,
            rejectedWorkers: 0,
        })).toEqual({ score: 1, reason: 'insert_backlog' });

        expect(evaluateAdaptivePressure(config, {
            insertBacklog: 0,
            insertLatencyMs: 0,
            retryRate: 0.75,
            submittedBatches: 10,
            retriedBatches: 8,
            rejectedWorkers: 0,
        })).toEqual({ score: 1, reason: 'retry_rate' });

        expect(evaluateAdaptivePressure(config, {
            insertBacklog: 0,
            insertLatencyMs: 0,
            retryRate: 1,
            submittedBatches: 1,
            retriedBatches: 1,
            rejectedWorkers: 0,
        })).toEqual({ score: 0, reason: 'none' });

        expect(evaluateAdaptivePressure(config, {
            insertBacklog: 0,
            insertLatencyMs: 0,
            retryRate: 0,
            submittedBatches: 0,
            retriedBatches: 0,
            rejectedWorkers: 0,
            memoryFreePercent: 1,
            vramUsedPercent: 95,
        })).toEqual({ score: 1, reason: 'memory' });
    });

    it('reduces effective concurrency quickly and recovers after healthy samples', () => {
        const controller = new AdaptiveBackpressureController({
            config: {
                ...createDefaultAdaptiveBackpressureConfig(true),
                healthySampleCount: 2,
                cooldownMs: 10,
                insertBacklogMinBatches: 0,
            },
            configuredEmbeddingConcurrency: 4,
            configuredInsertConcurrency: 1,
            queueCapacity: 8,
        });

        let state = controller.observe({
            insertBacklog: 3,
            insertLatencyMs: 0,
            retryRate: 0,
            submittedBatches: 0,
            retriedBatches: 0,
            rejectedWorkers: 0,
        }, 0);

        expect(state.effectiveEmbeddingConcurrency).toBe(3);
        expect(state.throttleReason).toBe('insert_backlog');
        expect(state.effectiveQueueCapacity).toBe(6);

        state = controller.observe({
            insertBacklog: 0,
            insertLatencyMs: 0,
            retryRate: 0,
            submittedBatches: 0,
            retriedBatches: 0,
            rejectedWorkers: 0,
        }, 20);
        state = controller.observe({
            insertBacklog: 0,
            insertLatencyMs: 0,
            retryRate: 0,
            submittedBatches: 0,
            retriedBatches: 0,
            rejectedWorkers: 0,
        }, 30);

        expect(state.effectiveEmbeddingConcurrency).toBe(4);
        expect(state.effectiveEmbeddingConcurrencyMin).toBe(3);
        expect(state.effectiveEmbeddingConcurrencyMax).toBe(4);
        expect(state.throttleTimeMs).toBeGreaterThan(0);
    });

    it('treats sustained BGE-M3 retry pressure as enough to reduce embedding concurrency', () => {
        const controller = new AdaptiveBackpressureController({
            config: createDefaultAdaptiveBackpressureConfig(true),
            configuredEmbeddingConcurrency: 4,
            configuredInsertConcurrency: 1,
            queueCapacity: 8,
        });

        const state = controller.observe({
            insertBacklog: 0,
            insertLatencyMs: 0,
            retryRate: 0.12,
            submittedBatches: 30,
            retriedBatches: 4,
            rejectedWorkers: 0,
        }, 0);

        expect(state.throttleReason).toBe('retry_rate');
        expect(state.pressureScore).toBe(1);
        expect(state.effectiveEmbeddingConcurrency).toBe(3);
    });

    it('creates pressure signals from accelerator snapshot counters', () => {
        const runtimeConfig = {
            mode: 'auto' as const,
            embeddingBatchSize: 100,
            insertBatchSize: 100,
            embeddingConcurrency: 2,
            insertConcurrency: 1,
            insertQueueCapacity: 2,
            maxBgeM3Workers: 1,
            vramLimitPercent: 75,
            retryBudget: 1,
            accelerateBackgroundSync: false,
            adaptiveBackpressure: createDefaultAdaptiveBackpressureConfig(true),
        };
        const runtime = new IndexingAcceleratorRuntime(runtimeConfig, true);
        runtime.recordSchedulerSnapshot({
            queuedBatches: 0,
            runningEmbeddingBatches: 0,
            queuedInsertBatches: 2,
            runningInsertBatches: 1,
        });
        runtime.recordBatchQueued({ id: 1, chunkCount: 1 });
        runtime.recordBatchRetried(1, 'embedding_timeout', true);
        runtime.updateWorkerCounts(0, 1, [{
            endpoint: 'http://127.0.0.1:8000',
            healthy: false,
            inFlight: 0,
            rejectedFailureReason: 'health',
            recoveryAttempts: 0,
            poolState: 'rejected',
        }]);

        const signals = createAdaptivePressureSignals(runtime.getSnapshot());

        expect(signals.insertBacklog).toBe(3);
        expect(signals.retryRate).toBe(1);
        expect(signals.submittedBatches).toBe(1);
        expect(signals.retriedBatches).toBe(1);
        expect(signals.rejectedWorkers).toBe(1);
        expect(signals.memoryFreePercent).toBeGreaterThan(0);
    });

    it('reports coalescing depth without treating buffered documents as insert backlog', () => {
        const runtimeConfig = {
            mode: 'auto' as const,
            embeddingBatchSize: 100,
            insertBatchSize: 100,
            embeddingConcurrency: 2,
            insertConcurrency: 1,
            insertQueueCapacity: 2,
            maxBgeM3Workers: 1,
            vramLimitPercent: 75,
            retryBudget: 1,
            accelerateBackgroundSync: false,
            adaptiveBackpressure: createDefaultAdaptiveBackpressureConfig(true),
        };
        const runtime = new IndexingAcceleratorRuntime(runtimeConfig, true);
        runtime.recordSchedulerSnapshot({
            queuedBatches: 0,
            runningEmbeddingBatches: 0,
            queuedInsertBatches: 0,
            runningInsertBatches: 0,
            queuedCoalescedDocuments: 7,
        });

        const signals = createAdaptivePressureSignals(runtime.getSnapshot());

        expect(signals.insertBacklog).toBe(0);
        expect(signals.insertQueueDepth).toBe(0);
        expect(signals.coalescingQueueDepth).toBe(7);
    });

    it('includes measured VRAM usage in adaptive pressure signals', () => {
        const runtimeConfig = {
            mode: 'auto' as const,
            embeddingBatchSize: 100,
            insertBatchSize: 100,
            embeddingConcurrency: 2,
            insertConcurrency: 1,
            insertQueueCapacity: 2,
            maxBgeM3Workers: 1,
            vramLimitPercent: 75,
            retryBudget: 1,
            accelerateBackgroundSync: false,
            adaptiveBackpressure: createDefaultAdaptiveBackpressureConfig(true),
        };
        const runtime = new IndexingAcceleratorRuntime(runtimeConfig, true);

        runtime.recordResourcePressure({ vramUsedPercent: 95 });

        const signals = createAdaptivePressureSignals(runtime.getSnapshot());
        expect(signals.vramUsedPercent).toBe(95);
        expect(evaluateAdaptivePressure(runtimeConfig.adaptiveBackpressure, signals)).toEqual({
            score: 1,
            reason: 'vram',
        });
    });

    it('parses and bounds pre-index traversal concurrency', () => {
        mockEnv({ PREINDEX_TRAVERSAL_CONCURRENCY: '4' });
        expect(getPreIndexTraversalConcurrency()).toBe(4);

        mockEnv({ PREINDEX_TRAVERSAL_CONCURRENCY: '500' });
        expect(getPreIndexTraversalConcurrency()).toBe(64);

        mockEnv({ PREINDEX_TRAVERSAL_CONCURRENCY: 'bad' });
        expect(getPreIndexTraversalConcurrency()).toBeGreaterThanOrEqual(1);

        expect(getPreIndexTraversalConcurrency(1)).toBe(1);
    });

    it('bounds async work to the configured limit', async () => {
        const limiter = new AsyncLimiter(2);
        let active = 0;
        let maxActive = 0;

        await Promise.all([0, 1, 2, 3].map((item) => limiter.run(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, item === 0 ? 20 : 5));
            active--;
        })));

        expect(maxActive).toBe(2);
    });
});

describe('resolveVectorWritePolicy', () => {
    it('keeps configured insert concurrency for parallel-safe backends', () => {
        expect(resolveVectorWritePolicy({
            backend: 'qdrant',
            configuredInsertConcurrency: 4,
            capabilities: {
                parallelWritesToSameCollection: true,
                idempotentUpsert: true,
                recommendedInsertConcurrency: 4,
                targetCoalescedDocumentCount: 200,
                maxCoalescedDocumentCount: 400,
                writeCoalescingRecommended: true,
                ambiguousWriteFailureMode: 'retry_safe',
            },
        })).toEqual(expect.objectContaining({
            backend: 'qdrant',
            configuredInsertConcurrency: 4,
            effectiveInsertConcurrency: 4,
            backendClampReason: 'none',
            coalescingEnabled: true,
            targetCoalescedDocumentCount: 200,
            maxCoalescedDocumentCount: 400,
        }));
    });

    it('clamps single-writer backends to one insert writer', () => {
        expect(resolveVectorWritePolicy({
            backend: 'lancedb',
            configuredInsertConcurrency: 4,
            capabilities: {
                parallelWritesToSameCollection: false,
                idempotentUpsert: true,
                recommendedInsertConcurrency: 1,
                targetCoalescedDocumentCount: 100,
                maxCoalescedDocumentCount: 300,
                writeCoalescingRecommended: true,
                ambiguousWriteFailureMode: 'fail_fast',
            },
        })).toEqual(expect.objectContaining({
            backend: 'lancedb',
            configuredInsertConcurrency: 4,
            effectiveInsertConcurrency: 1,
            backendClampReason: 'single_writer_collection',
            coalescingEnabled: true,
        }));
    });

    it('uses conservative single-writer behavior for unknown capabilities', () => {
        expect(resolveVectorWritePolicy({
            backend: 'unknown',
            configuredInsertConcurrency: 4,
            capabilities: undefined,
        })).toEqual(expect.objectContaining({
            backend: 'unknown',
            effectiveInsertConcurrency: 1,
            backendClampReason: 'unknown_capabilities',
            coalescingEnabled: false,
        }));
    });
});
