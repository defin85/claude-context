import { envManager } from './utils/env-manager';
import type { PreIndexTraversalDiagnostics } from './sync/preindex-traversal';
import * as os from 'node:os';

export type IndexingAcceleratorMode = 'off' | 'auto';
export type PreIndexPhase = 'idle' | 'traversal' | 'complete';
export type EmbeddingWorkerFailureReason =
    | 'startup'
    | 'health'
    | 'metadata'
    | 'embedding_timeout'
    | 'embedding_error'
    | 'cancellation'
    | 'unknown';

export type WorkerLifecycleEvent = 'rejected' | 'recovered' | 'recovery_failed';

export interface EmbeddingWorkerFailureSummary {
    startup: number;
    health: number;
    metadata: number;
    embedding_timeout: number;
    embedding_error: number;
    cancellation: number;
    unknown: number;
}

export interface WorkerLifecycleSummary {
    rejected: number;
    recovered: number;
    recoveryFailed: number;
    byReason: EmbeddingWorkerFailureSummary;
}

export type AdaptiveThrottleReason =
    | 'none'
    | 'insert_backlog'
    | 'insert_latency'
    | 'retry_rate'
    | 'worker_rejection'
    | 'memory'
    | 'vram';

export interface AdaptiveBackpressureConfig {
    enabled: boolean;
    minEmbeddingConcurrency: number;
    highPressureThreshold: number;
    lowPressureThreshold: number;
    healthySampleCount: number;
    cooldownMs: number;
    insertBacklogThreshold: number;
    insertBacklogMinBatches: number;
    insertLatencyMsThreshold: number;
    retryRateThreshold: number;
    retryRateMinBatches: number;
    rejectedWorkersThreshold: number;
    memoryFreePercentThreshold: number;
    vramUsageLimitPercent: number;
}

export interface IndexingAcceleratorConfig {
    mode: IndexingAcceleratorMode;
    embeddingConcurrency: number;
    insertConcurrency: number;
    insertQueueCapacity: number;
    maxBgeM3Workers: number;
    vramLimitPercent: number;
    retryBudget: number;
    accelerateBackgroundSync: boolean;
    adaptiveBackpressure: AdaptiveBackpressureConfig;
}

export interface IndexingAcceleratorSnapshot {
    mode: IndexingAcceleratorMode;
    active: boolean;
    fallbackReason?: string;
    embeddingConcurrency: number;
    insertConcurrency: number;
    insertQueueCapacity: number;
    adaptiveBackpressureEnabled: boolean;
    configuredEmbeddingConcurrency: number;
    configuredInsertConcurrency: number;
    effectiveEmbeddingConcurrency: number;
    effectiveInsertConcurrency: number;
    adaptivePressureScore: number;
    adaptiveThrottleReason: AdaptiveThrottleReason;
    adaptiveThrottleTimeMs: number;
    adaptiveThrottleEvents: number;
    adaptiveEffectiveEmbeddingConcurrencyMin: number;
    adaptiveEffectiveEmbeddingConcurrencyMax: number;
    adaptivePressureSignals?: AdaptivePressureSignals;
    maxBgeM3Workers: number;
    vramLimitPercent: number;
    retryBudget: number;
    accelerateBackgroundSync: boolean;
    inFlightEmbeddingBatches: number;
    inFlightInsertBatches: number;
    queuedBatches?: number;
    runningEmbeddingBatches?: number;
    queuedInsertBatches?: number;
    runningInsertBatches?: number;
    completedInsertBatches: number;
    failedInsertBatches: number;
    backpressureWaitMs?: number;
    submittedBatches: number;
    completedBatches: number;
    failedBatches: number;
    retriedBatches: number;
    retryReasons: EmbeddingWorkerFailureSummary;
    retrySafeFailures: number;
    retryUnsafeFailures: number;
    workerLifecycle: WorkerLifecycleSummary;
    activeWorkers?: number;
    rejectedWorkers?: number;
    workers?: IndexingAcceleratorWorkerSnapshot[];
    resourcePressure?: IndexingAcceleratorResourcePressure;
    codeChunkLimit?: number;
    limitReached?: boolean;
    limitReachedChunks?: number;
    limitReachedProcessedFiles?: number;
    batches: IndexingBatchSnapshot[];
    scanningMs: number;
    preIndexActive: boolean;
    preIndexPhase: PreIndexPhase;
    preIndexScanMs: number;
    preIndexHashMs: number;
    preIndexFileListMs: number;
    preIndexTotalMs: number;
    preIndexSelectedFileCount: number;
    preIndexHashedFileCount: number;
    preIndexDiagnostics?: PreIndexTraversalDiagnostics;
    splittingMs: number;
    embeddingMs: number;
    insertMs: number;
}

export interface AdaptivePressureSignals {
    insertBacklog: number;
    insertLatencyMs: number;
    retryRate: number;
    submittedBatches: number;
    retriedBatches: number;
    rejectedWorkers: number;
    memoryFreePercent?: number;
    vramUsedPercent?: number;
}

export interface IndexingAcceleratorResourcePressure {
    vramUsedPercent?: number;
}

export interface AdaptiveBackpressureDecision {
    enabled: boolean;
    configuredEmbeddingConcurrency: number;
    effectiveEmbeddingConcurrency: number;
    configuredInsertConcurrency: number;
    effectiveInsertConcurrency: number;
    pressureScore: number;
    throttleReason: AdaptiveThrottleReason;
    throttleTimeMs: number;
    throttleEvents: number;
    effectiveEmbeddingConcurrencyMin: number;
    effectiveEmbeddingConcurrencyMax: number;
    signals: AdaptivePressureSignals;
}

export interface AdaptiveBackpressureControllerState extends AdaptiveBackpressureDecision {
    effectiveQueueCapacity: number;
}

export interface IndexingAcceleratorWorkerSnapshot {
    endpoint: string;
    healthy: boolean;
    inFlight: number;
    rejectedReason?: string;
    rejectedFailureReason?: EmbeddingWorkerFailureReason;
    rejectedRetrySafe?: boolean;
    lastFailureAt?: string;
    lastSuccessAt?: string;
    recoveryAttempts: number;
    lastRecoveryAttemptAt?: string;
    poolState: 'accepted' | 'rejected' | 'recovering';
}

export interface IndexingBatchMetadata {
    id: number;
    chunkCount: number;
    firstFile?: string;
    lastFile?: string;
}

export interface IndexingBatchSnapshot extends IndexingBatchMetadata {
    attempts: number;
    state: 'queued' | 'running' | 'running_embedding' | 'queued_insert' | 'running_insert' | 'completed' | 'failed' | 'cancelled';
}

export class IndexingAcceleratorRuntime {
    private snapshot: IndexingAcceleratorSnapshot;
    private readonly batches = new Map<number, IndexingBatchSnapshot>();

    constructor(config: IndexingAcceleratorConfig, active: boolean, fallbackReason?: string) {
        this.snapshot = {
            mode: config.mode,
            active,
            fallbackReason,
            embeddingConcurrency: active ? config.embeddingConcurrency : 1,
            insertConcurrency: active ? config.insertConcurrency : 1,
            insertQueueCapacity: active ? config.insertQueueCapacity : 1,
            adaptiveBackpressureEnabled: active ? config.adaptiveBackpressure.enabled : false,
            configuredEmbeddingConcurrency: active ? config.embeddingConcurrency : 1,
            configuredInsertConcurrency: active ? config.insertConcurrency : 1,
            effectiveEmbeddingConcurrency: active ? config.embeddingConcurrency : 1,
            effectiveInsertConcurrency: active ? config.insertConcurrency : 1,
            adaptivePressureScore: 0,
            adaptiveThrottleReason: 'none',
            adaptiveThrottleTimeMs: 0,
            adaptiveThrottleEvents: 0,
            adaptiveEffectiveEmbeddingConcurrencyMin: active ? config.embeddingConcurrency : 1,
            adaptiveEffectiveEmbeddingConcurrencyMax: active ? config.embeddingConcurrency : 1,
            adaptivePressureSignals: undefined,
            maxBgeM3Workers: config.maxBgeM3Workers,
            vramLimitPercent: config.vramLimitPercent,
            retryBudget: config.retryBudget,
            accelerateBackgroundSync: config.accelerateBackgroundSync,
            inFlightEmbeddingBatches: 0,
            inFlightInsertBatches: 0,
            queuedBatches: 0,
            runningEmbeddingBatches: 0,
            queuedInsertBatches: 0,
            runningInsertBatches: 0,
            completedInsertBatches: 0,
            failedInsertBatches: 0,
            backpressureWaitMs: 0,
            submittedBatches: 0,
            completedBatches: 0,
            failedBatches: 0,
            retriedBatches: 0,
            retryReasons: createEmptyFailureSummary(),
            retrySafeFailures: 0,
            retryUnsafeFailures: 0,
            workerLifecycle: {
                rejected: 0,
                recovered: 0,
                recoveryFailed: 0,
                byReason: createEmptyFailureSummary(),
            },
            activeWorkers: undefined,
            rejectedWorkers: undefined,
            workers: undefined,
            resourcePressure: undefined,
            codeChunkLimit: undefined,
            limitReached: undefined,
            limitReachedChunks: undefined,
            limitReachedProcessedFiles: undefined,
            batches: [],
            scanningMs: 0,
            preIndexActive: false,
            preIndexPhase: 'idle',
            preIndexScanMs: 0,
            preIndexHashMs: 0,
            preIndexFileListMs: 0,
            preIndexTotalMs: 0,
            preIndexSelectedFileCount: 0,
            preIndexHashedFileCount: 0,
            preIndexDiagnostics: undefined,
            splittingMs: 0,
            embeddingMs: 0,
            insertMs: 0,
        };
    }

    getSnapshot(): IndexingAcceleratorSnapshot {
        return {
            ...this.snapshot,
            preIndexDiagnostics: this.snapshot.preIndexDiagnostics
                ? {
                    ...this.snapshot.preIndexDiagnostics,
                    unsupportedFilesByExtension: {
                        ...this.snapshot.preIndexDiagnostics.unsupportedFilesByExtension,
                    },
                    timings: { ...this.snapshot.preIndexDiagnostics.timings },
                }
                : undefined,
            workers: this.snapshot.workers?.map((worker) => ({ ...worker })),
            retryReasons: { ...this.snapshot.retryReasons },
            workerLifecycle: {
                ...this.snapshot.workerLifecycle,
                byReason: { ...this.snapshot.workerLifecycle.byReason },
            },
            adaptivePressureSignals: this.snapshot.adaptivePressureSignals
                ? { ...this.snapshot.adaptivePressureSignals }
                : undefined,
            resourcePressure: this.snapshot.resourcePressure
                ? { ...this.snapshot.resourcePressure }
                : undefined,
            batches: [...this.batches.values()].map((batch) => ({ ...batch })),
        };
    }

    recordScan(durationMs: number): void {
        this.snapshot.scanningMs += durationMs;
    }

    recordPreIndexStart(): void {
        this.snapshot.preIndexActive = true;
        this.snapshot.preIndexPhase = 'traversal';
        this.snapshot.preIndexScanMs = 0;
        this.snapshot.preIndexHashMs = 0;
        this.snapshot.preIndexFileListMs = 0;
        this.snapshot.preIndexTotalMs = 0;
        this.snapshot.preIndexSelectedFileCount = 0;
        this.snapshot.preIndexHashedFileCount = 0;
        this.snapshot.preIndexDiagnostics = undefined;
    }

    recordPreIndex(metrics: {
        scanMs: number;
        hashMs: number;
        fileListMs: number;
        totalMs: number;
        selectedFileCount: number;
        hashedFileCount: number;
        diagnostics?: PreIndexTraversalDiagnostics;
    }): void {
        this.snapshot.preIndexActive = false;
        this.snapshot.preIndexPhase = 'complete';
        this.snapshot.preIndexScanMs += metrics.scanMs;
        this.snapshot.preIndexHashMs += metrics.hashMs;
        this.snapshot.preIndexFileListMs += metrics.fileListMs;
        this.snapshot.preIndexTotalMs += metrics.totalMs;
        this.snapshot.preIndexSelectedFileCount = metrics.selectedFileCount;
        this.snapshot.preIndexHashedFileCount = metrics.hashedFileCount;
        this.snapshot.preIndexDiagnostics = metrics.diagnostics;
    }

    recordSplit(durationMs: number): void {
        this.snapshot.splittingMs += durationMs;
    }

    recordBatchSubmitted(metadata: IndexingBatchMetadata): void {
        this.snapshot.submittedBatches++;
        this.batches.set(metadata.id, {
            ...metadata,
            attempts: 1,
            state: 'running',
        });
    }

    recordBatchQueued(metadata: IndexingBatchMetadata): void {
        this.snapshot.submittedBatches++;
        this.batches.set(metadata.id, {
            ...metadata,
            attempts: 1,
            state: 'queued',
        });
    }

    recordBatchRunningEmbedding(batchId?: number): void {
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'running_embedding';
            }
        }
    }

    recordBatchRunningInsert(batchId?: number): void {
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'running_insert';
            }
        }
    }

    recordBatchQueuedInsert(batchId?: number): void {
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'queued_insert';
            }
        }
    }

    recordBatchCompleted(batchId?: number): void {
        this.snapshot.completedBatches++;
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'completed';
            }
        }
    }

    recordInsertCompleted(): void {
        this.snapshot.completedInsertBatches++;
    }

    recordBatchFailed(batchId?: number): void {
        this.snapshot.failedBatches++;
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'failed';
            }
        }
    }

    recordInsertFailed(): void {
        this.snapshot.failedInsertBatches++;
    }

    recordBatchCancelled(batchId?: number): void {
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'cancelled';
            }
        }
    }

    recordBatchRetried(batchId?: number, reason: EmbeddingWorkerFailureReason = 'unknown', retrySafe: boolean = true): void {
        this.snapshot.retriedBatches++;
        this.snapshot.retryReasons[reason]++;
        if (retrySafe) {
            this.snapshot.retrySafeFailures++;
        } else {
            this.snapshot.retryUnsafeFailures++;
        }
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.attempts++;
            }
        }
    }

    recordWorkerLifecycle(event: WorkerLifecycleEvent, reason: EmbeddingWorkerFailureReason = 'unknown'): void {
        if (event === 'rejected') {
            this.snapshot.workerLifecycle.rejected++;
            this.snapshot.workerLifecycle.byReason[reason]++;
        } else if (event === 'recovered') {
            this.snapshot.workerLifecycle.recovered++;
        } else {
            this.snapshot.workerLifecycle.recoveryFailed++;
            this.snapshot.workerLifecycle.byReason[reason]++;
        }
    }

    updateWorkerCounts(
        activeWorkers: number,
        rejectedWorkers: number,
        workers?: IndexingAcceleratorWorkerSnapshot[],
    ): void {
        this.recordWorkerTransitions(workers);
        this.snapshot.activeWorkers = activeWorkers;
        this.snapshot.rejectedWorkers = rejectedWorkers;
        this.snapshot.workers = workers?.map((worker) => ({ ...worker }));
    }

    private recordWorkerTransitions(workers?: IndexingAcceleratorWorkerSnapshot[]): void {
        if (!workers) {
            return;
        }

        const previousWorkers = new Map(
            (this.snapshot.workers || []).map((worker) => [worker.endpoint, worker]),
        );
        for (const worker of workers) {
            const previous = previousWorkers.get(worker.endpoint);
            const previousState = previous?.poolState;
            if (worker.poolState === 'rejected' && previousState !== 'rejected') {
                this.recordWorkerLifecycle('rejected', worker.rejectedFailureReason || 'unknown');
            } else if (worker.poolState === 'accepted' && previousState === 'rejected') {
                this.recordWorkerLifecycle('recovered');
            } else if (
                worker.poolState === 'rejected' &&
                previousState === 'recovering' &&
                worker.lastRecoveryAttemptAt !== previous?.lastRecoveryAttemptAt
            ) {
                this.recordWorkerLifecycle('recovery_failed', worker.rejectedFailureReason || 'unknown');
            }
        }
    }

    recordChunkLimit(codeChunkLimit: number): void {
        this.snapshot.codeChunkLimit = codeChunkLimit;
        this.snapshot.limitReached = false;
    }

    recordSchedulerSnapshot(metrics: {
        queuedBatches: number;
        runningEmbeddingBatches: number;
        queuedInsertBatches: number;
        runningInsertBatches: number;
    }): void {
        this.snapshot.queuedBatches = metrics.queuedBatches;
        this.snapshot.runningEmbeddingBatches = metrics.runningEmbeddingBatches;
        this.snapshot.queuedInsertBatches = metrics.queuedInsertBatches;
        this.snapshot.runningInsertBatches = metrics.runningInsertBatches;
    }

    recordAdaptiveBackpressure(decision: AdaptiveBackpressureDecision): void {
        this.snapshot.adaptiveBackpressureEnabled = decision.enabled;
        this.snapshot.configuredEmbeddingConcurrency = decision.configuredEmbeddingConcurrency;
        this.snapshot.configuredInsertConcurrency = decision.configuredInsertConcurrency;
        this.snapshot.effectiveEmbeddingConcurrency = decision.effectiveEmbeddingConcurrency;
        this.snapshot.effectiveInsertConcurrency = decision.effectiveInsertConcurrency;
        this.snapshot.adaptivePressureScore = decision.pressureScore;
        this.snapshot.adaptiveThrottleReason = decision.throttleReason;
        this.snapshot.adaptiveThrottleTimeMs = decision.throttleTimeMs;
        this.snapshot.adaptiveThrottleEvents = decision.throttleEvents;
        this.snapshot.adaptiveEffectiveEmbeddingConcurrencyMin = decision.effectiveEmbeddingConcurrencyMin;
        this.snapshot.adaptiveEffectiveEmbeddingConcurrencyMax = decision.effectiveEmbeddingConcurrencyMax;
        this.snapshot.adaptivePressureSignals = { ...decision.signals };
    }

    recordBackpressureWait(durationMs: number): void {
        this.snapshot.backpressureWaitMs = (this.snapshot.backpressureWaitMs ?? 0) + durationMs;
    }

    recordResourcePressure(pressure: IndexingAcceleratorResourcePressure): void {
        this.snapshot.resourcePressure = {
            ...this.snapshot.resourcePressure,
            ...pressure,
        };
    }

    recordLimitReached(metrics: { totalChunks: number; processedFiles: number }): void {
        this.snapshot.limitReached = true;
        this.snapshot.limitReachedChunks = metrics.totalChunks;
        this.snapshot.limitReachedProcessedFiles = metrics.processedFiles;
    }

    async trackEmbedding<T>(run: () => Promise<T>): Promise<T> {
        this.snapshot.inFlightEmbeddingBatches++;
        const startedAt = Date.now();
        try {
            return await run();
        } finally {
            this.snapshot.embeddingMs += Date.now() - startedAt;
            this.snapshot.inFlightEmbeddingBatches = Math.max(0, this.snapshot.inFlightEmbeddingBatches - 1);
        }
    }

    async trackInsert<T>(run: () => Promise<T>): Promise<T> {
        this.snapshot.inFlightInsertBatches++;
        const startedAt = Date.now();
        try {
            return await run();
        } finally {
            this.snapshot.insertMs += Date.now() - startedAt;
            this.snapshot.inFlightInsertBatches = Math.max(0, this.snapshot.inFlightInsertBatches - 1);
        }
    }
}

export class AdaptiveBackpressureController {
    private effectiveEmbeddingConcurrency: number;
    private healthySamples = 0;
    private throttleTimeMs = 0;
    private throttleEvents = 0;
    private lastObservedAt?: number;
    private lastDecreaseAt = 0;
    private minObserved: number;
    private maxObserved: number;
    private lastDecision?: AdaptiveBackpressureDecision;

    constructor(
        private readonly options: {
            config: AdaptiveBackpressureConfig;
            configuredEmbeddingConcurrency: number;
            configuredInsertConcurrency: number;
            queueCapacity: number;
        },
    ) {
        this.effectiveEmbeddingConcurrency = Math.max(1, options.configuredEmbeddingConcurrency);
        this.minObserved = this.effectiveEmbeddingConcurrency;
        this.maxObserved = this.effectiveEmbeddingConcurrency;
    }

    observe(signals: AdaptivePressureSignals, now: number = Date.now()): AdaptiveBackpressureControllerState {
        const hardMaximum = Math.max(1, this.options.configuredEmbeddingConcurrency);
        const minimum = Math.max(
            1,
            Math.min(this.options.config.minEmbeddingConcurrency, hardMaximum),
        );
        const evaluation = evaluateAdaptivePressure(this.options.config, signals);

        if (this.options.config.enabled) {
            if (evaluation.score >= this.options.config.highPressureThreshold) {
                const next = Math.max(minimum, this.effectiveEmbeddingConcurrency - 1);
                if (next < this.effectiveEmbeddingConcurrency) {
                    this.throttleEvents++;
                    this.lastDecreaseAt = now;
                }
                this.effectiveEmbeddingConcurrency = next;
                this.healthySamples = 0;
            } else if (evaluation.score <= this.options.config.lowPressureThreshold) {
                this.healthySamples++;
                if (
                    this.effectiveEmbeddingConcurrency < hardMaximum &&
                    this.healthySamples >= this.options.config.healthySampleCount &&
                    now - this.lastDecreaseAt >= this.options.config.cooldownMs
                ) {
                    this.effectiveEmbeddingConcurrency++;
                    this.healthySamples = 0;
                }
            } else {
                this.healthySamples = 0;
            }
        } else {
            this.effectiveEmbeddingConcurrency = hardMaximum;
            this.healthySamples = 0;
        }

        this.minObserved = Math.min(this.minObserved, this.effectiveEmbeddingConcurrency);
        this.maxObserved = Math.max(this.maxObserved, this.effectiveEmbeddingConcurrency);
        if (
            this.lastObservedAt !== undefined &&
            this.options.config.enabled &&
            this.effectiveEmbeddingConcurrency < hardMaximum
        ) {
            this.throttleTimeMs += Math.max(0, now - this.lastObservedAt);
        }
        this.lastObservedAt = now;

        this.lastDecision = {
            enabled: this.options.config.enabled,
            configuredEmbeddingConcurrency: hardMaximum,
            effectiveEmbeddingConcurrency: this.effectiveEmbeddingConcurrency,
            configuredInsertConcurrency: Math.max(1, this.options.configuredInsertConcurrency),
            effectiveInsertConcurrency: Math.max(1, this.options.configuredInsertConcurrency),
            pressureScore: evaluation.score,
            throttleReason: this.options.config.enabled ? evaluation.reason : 'none',
            throttleTimeMs: this.throttleTimeMs,
            throttleEvents: this.throttleEvents,
            effectiveEmbeddingConcurrencyMin: this.minObserved,
            effectiveEmbeddingConcurrencyMax: this.maxObserved,
            signals,
        };

        return {
            ...this.lastDecision,
            effectiveQueueCapacity: this.getEffectiveQueueCapacity(),
        };
    }

    getCurrentState(): AdaptiveBackpressureControllerState {
        if (!this.lastDecision) {
            return this.observe({
                insertBacklog: 0,
                insertLatencyMs: 0,
                retryRate: 0,
                submittedBatches: 0,
                retriedBatches: 0,
                rejectedWorkers: 0,
                memoryFreePercent: getMemoryFreePercent(),
            });
        }
        return {
            ...this.lastDecision,
            signals: { ...this.lastDecision.signals },
            effectiveQueueCapacity: this.getEffectiveQueueCapacity(),
        };
    }

    private getEffectiveQueueCapacity(): number {
        if (!this.options.config.enabled) {
            return this.options.queueCapacity;
        }
        return Math.max(
            this.effectiveEmbeddingConcurrency,
            Math.min(this.options.queueCapacity, this.effectiveEmbeddingConcurrency * 2),
        );
    }
}

export function evaluateAdaptivePressure(
    config: AdaptiveBackpressureConfig,
    signals: AdaptivePressureSignals,
): { score: number; reason: AdaptiveThrottleReason } {
    const candidates: Array<{ reason: AdaptiveThrottleReason; score: number }> = [
        {
            reason: 'insert_backlog',
            score: signals.submittedBatches >= config.insertBacklogMinBatches
                ? ratio(signals.insertBacklog, config.insertBacklogThreshold)
                : 0,
        },
        {
            reason: 'insert_latency',
            score: ratio(signals.insertLatencyMs, config.insertLatencyMsThreshold),
        },
        {
            reason: 'retry_rate',
            score: signals.submittedBatches >= config.retryRateMinBatches
                ? ratio(signals.retryRate, config.retryRateThreshold)
                : 0,
        },
        {
            reason: 'worker_rejection',
            score: ratio(signals.rejectedWorkers, config.rejectedWorkersThreshold),
        },
    ];

    if (signals.memoryFreePercent !== undefined) {
        candidates.push({
            reason: 'memory',
            score: ratio(config.memoryFreePercentThreshold, signals.memoryFreePercent),
        });
    }
    if (signals.vramUsedPercent !== undefined) {
        candidates.push({
            reason: 'vram',
            score: ratio(signals.vramUsedPercent, config.vramUsageLimitPercent),
        });
    }

    const winner = candidates.reduce((best, candidate) => (
        candidate.score > best.score ? candidate : best
    ), { reason: 'none' as AdaptiveThrottleReason, score: 0 });

    if (winner.score <= 0) {
        return { score: 0, reason: 'none' };
    }
    return {
        score: Number(Math.min(1, winner.score).toFixed(4)),
        reason: winner.reason,
    };
}

export function createAdaptivePressureSignals(snapshot: IndexingAcceleratorSnapshot): AdaptivePressureSignals {
    const completedInsertBatches = snapshot.completedInsertBatches || 0;
    const submittedBatches = snapshot.submittedBatches || 0;
    return {
        insertBacklog: (snapshot.queuedInsertBatches || 0) + (snapshot.runningInsertBatches || 0),
        insertLatencyMs: completedInsertBatches > 0
            ? Math.round((snapshot.insertMs || 0) / completedInsertBatches)
            : 0,
        retryRate: submittedBatches > 0 ? (snapshot.retriedBatches || 0) / submittedBatches : 0,
        submittedBatches,
        retriedBatches: snapshot.retriedBatches || 0,
        rejectedWorkers: snapshot.rejectedWorkers || 0,
        memoryFreePercent: getMemoryFreePercent(),
        vramUsedPercent: snapshot.resourcePressure?.vramUsedPercent,
    };
}

export function createEmptyFailureSummary(): EmbeddingWorkerFailureSummary {
    return {
        startup: 0,
        health: 0,
        metadata: 0,
        embedding_timeout: 0,
        embedding_error: 0,
        cancellation: 0,
        unknown: 0,
    };
}

export function createDefaultAdaptiveBackpressureConfig(active: boolean): AdaptiveBackpressureConfig {
    return {
        enabled: active,
        minEmbeddingConcurrency: 1,
        highPressureThreshold: 1,
        lowPressureThreshold: 0.5,
        healthySampleCount: 3,
        cooldownMs: 5000,
        insertBacklogThreshold: 2,
        insertBacklogMinBatches: 30,
        insertLatencyMsThreshold: 30000,
        retryRateThreshold: 0.5,
        retryRateMinBatches: 10,
        rejectedWorkersThreshold: 1,
        memoryFreePercentThreshold: 3,
        vramUsageLimitPercent: 90,
    };
}

export class AsyncLimiter {
    private active = 0;
    private readonly queue: Array<{
        start: () => void;
        reject: (error: Error) => void;
        abortListener?: () => void;
    }> = [];

    constructor(private readonly limit: number) {}

    async run<T>(task: () => Promise<T>, abortSignal?: AbortSignal): Promise<T> {
        if (abortSignal?.aborted) {
            throw this.getAbortError(abortSignal);
        }

        if (this.active >= this.limit) {
            await new Promise<void>((resolve, reject) => {
                const queued = {
                    start: resolve,
                    reject,
                    abortListener: undefined as (() => void) | undefined,
                };
                queued.abortListener = () => {
                    const index = this.queue.indexOf(queued);
                    if (index >= 0) {
                        this.queue.splice(index, 1);
                    }
                    reject(this.getAbortError(abortSignal));
                };
                abortSignal?.addEventListener('abort', queued.abortListener, { once: true });
                this.queue.push(queued);
            });
            if (abortSignal?.aborted) {
                throw this.getAbortError(abortSignal);
            }
        }

        this.active++;
        try {
            return await task();
        } finally {
            this.active--;
            const next = this.queue.shift();
            if (next) {
                if (next.abortListener) {
                    abortSignal?.removeEventListener('abort', next.abortListener);
                }
                next.start();
            }
        }
    }

    private getAbortError(abortSignal?: AbortSignal): Error {
        const reason = abortSignal?.reason;
        if (reason instanceof Error) {
            return reason;
        }
        if (typeof reason === 'string' && reason.trim().length > 0) {
            return new Error(reason);
        }
        return new Error('Queued indexing batch cancelled.');
    }
}

function parsePositiveInteger(name: string, fallback: number): number {
    const rawValue = envManager.get(name);
    if (!rawValue || rawValue.toLowerCase() === 'auto') {
        return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }

    console.warn(`[Context] ⚠️ Ignoring invalid ${name}='${rawValue}'. Expected a positive integer.`);
    return fallback;
}

function parsePercent(name: string, fallback: number): number {
    const parsed = parsePositiveInteger(name, fallback);
    return Math.max(1, Math.min(100, parsed));
}

function parseBoolean(name: string, fallback: boolean): boolean {
    const rawValue = envManager.get(name);
    if (!rawValue) {
        return fallback;
    }

    const normalized = rawValue.toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    console.warn(`[Context] ⚠️ Ignoring invalid ${name}='${rawValue}'. Expected true or false.`);
    return fallback;
}

export function getIndexingAcceleratorConfig(): IndexingAcceleratorConfig {
    const rawMode = envManager.get('INDEX_ACCELERATOR_MODE') || envManager.get('BGE_M3_ACCELERATOR') || 'off';
    const mode: IndexingAcceleratorMode = rawMode === 'auto' ? 'auto' : 'off';
    if (rawMode !== 'auto' && rawMode !== 'off') {
        console.warn(`[Context] ⚠️ Ignoring invalid accelerator mode '${rawMode}'. Expected 'off' or 'auto'.`);
    }

    const adaptiveDefaults = createDefaultAdaptiveBackpressureConfig(mode === 'auto');

    return {
        mode,
        embeddingConcurrency: parsePositiveInteger('INDEX_EMBEDDING_CONCURRENCY', mode === 'auto' ? 2 : 1),
        insertConcurrency: parsePositiveInteger('INDEX_INSERT_CONCURRENCY', 1),
        insertQueueCapacity: parsePositiveInteger('INDEX_INSERT_QUEUE_CAPACITY', 2),
        maxBgeM3Workers: parsePositiveInteger('BGE_M3_ACCELERATOR_MAX_WORKERS', 1),
        vramLimitPercent: parsePercent('BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT', 75),
        retryBudget: parsePositiveInteger('INDEX_ACCELERATOR_RETRY_BUDGET', 1),
        accelerateBackgroundSync: parseBoolean('INDEX_ACCELERATE_BACKGROUND_SYNC', false),
        adaptiveBackpressure: {
            enabled: parseBoolean('INDEX_ADAPTIVE_BACKPRESSURE', adaptiveDefaults.enabled),
            minEmbeddingConcurrency: parsePositiveInteger('INDEX_ADAPTIVE_MIN_EMBEDDING_CONCURRENCY', adaptiveDefaults.minEmbeddingConcurrency),
            highPressureThreshold: parsePositiveNumber('INDEX_ADAPTIVE_HIGH_PRESSURE_THRESHOLD', adaptiveDefaults.highPressureThreshold),
            lowPressureThreshold: parsePositiveNumber('INDEX_ADAPTIVE_LOW_PRESSURE_THRESHOLD', adaptiveDefaults.lowPressureThreshold),
            healthySampleCount: parsePositiveInteger('INDEX_ADAPTIVE_HEALTHY_SAMPLE_COUNT', adaptiveDefaults.healthySampleCount),
            cooldownMs: parsePositiveInteger('INDEX_ADAPTIVE_COOLDOWN_MS', adaptiveDefaults.cooldownMs),
            insertBacklogThreshold: parsePositiveInteger('INDEX_ADAPTIVE_INSERT_BACKLOG_THRESHOLD', adaptiveDefaults.insertBacklogThreshold),
            insertBacklogMinBatches: parsePositiveInteger('INDEX_ADAPTIVE_INSERT_BACKLOG_MIN_BATCHES', adaptiveDefaults.insertBacklogMinBatches),
            insertLatencyMsThreshold: parsePositiveInteger('INDEX_ADAPTIVE_INSERT_LATENCY_MS_THRESHOLD', adaptiveDefaults.insertLatencyMsThreshold),
            retryRateThreshold: parsePositiveNumber('INDEX_ADAPTIVE_RETRY_RATE_THRESHOLD', adaptiveDefaults.retryRateThreshold),
            retryRateMinBatches: parsePositiveInteger('INDEX_ADAPTIVE_RETRY_RATE_MIN_BATCHES', adaptiveDefaults.retryRateMinBatches),
            rejectedWorkersThreshold: parsePositiveInteger('INDEX_ADAPTIVE_REJECTED_WORKERS_THRESHOLD', adaptiveDefaults.rejectedWorkersThreshold),
            memoryFreePercentThreshold: parsePercent('INDEX_ADAPTIVE_MEMORY_FREE_PERCENT_THRESHOLD', adaptiveDefaults.memoryFreePercentThreshold),
            vramUsageLimitPercent: parsePercent('INDEX_ADAPTIVE_VRAM_USAGE_LIMIT_PERCENT', adaptiveDefaults.vramUsageLimitPercent),
        },
    };
}

export function shouldAccelerateIndexing(
    config: IndexingAcceleratorConfig,
    options: { isInitialOrForce: boolean; isBackgroundSync: boolean },
): { active: boolean; fallbackReason?: string } {
    if (config.mode === 'off') {
        return { active: false, fallbackReason: 'accelerator disabled' };
    }
    if (options.isBackgroundSync && !config.accelerateBackgroundSync) {
        return { active: false, fallbackReason: 'background sync acceleration disabled' };
    }
    if (!options.isInitialOrForce && !options.isBackgroundSync) {
        return { active: false, fallbackReason: 'not an initial or force indexing run' };
    }
    if (config.embeddingConcurrency <= 1 && config.insertConcurrency <= 1) {
        return { active: false, fallbackReason: 'accelerator concurrency is 1' };
    }
    return { active: true };
}

function parsePositiveNumber(name: string, fallback: number): number {
    const rawValue = envManager.get(name);
    if (!rawValue || rawValue.toLowerCase() === 'auto') {
        return fallback;
    }

    const parsed = Number.parseFloat(rawValue);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }

    console.warn(`[Context] ⚠️ Ignoring invalid ${name}='${rawValue}'. Expected a positive number.`);
    return fallback;
}

function ratio(value: number, threshold: number): number {
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(threshold) || threshold <= 0) {
        return 0;
    }
    return value / threshold;
}

function getMemoryFreePercent(): number | undefined {
    const total = os.totalmem();
    if (!Number.isFinite(total) || total <= 0) {
        return undefined;
    }
    return Number((os.freemem() / total * 100).toFixed(2));
}
