import { envManager } from './utils/env-manager';
import type { PreIndexTraversalDiagnostics } from './sync/preindex-traversal';

export type IndexingAcceleratorMode = 'off' | 'auto';
export type PreIndexPhase = 'idle' | 'traversal' | 'complete';

export interface IndexingAcceleratorConfig {
    mode: IndexingAcceleratorMode;
    embeddingConcurrency: number;
    insertConcurrency: number;
    maxBgeM3Workers: number;
    vramLimitPercent: number;
    retryBudget: number;
    accelerateBackgroundSync: boolean;
}

export interface IndexingAcceleratorSnapshot {
    mode: IndexingAcceleratorMode;
    active: boolean;
    fallbackReason?: string;
    embeddingConcurrency: number;
    insertConcurrency: number;
    maxBgeM3Workers: number;
    vramLimitPercent: number;
    retryBudget: number;
    accelerateBackgroundSync: boolean;
    inFlightEmbeddingBatches: number;
    inFlightInsertBatches: number;
    queuedBatches?: number;
    runningEmbeddingBatches?: number;
    runningInsertBatches?: number;
    backpressureWaitMs?: number;
    submittedBatches: number;
    completedBatches: number;
    failedBatches: number;
    retriedBatches: number;
    activeWorkers?: number;
    rejectedWorkers?: number;
    workers?: IndexingAcceleratorWorkerSnapshot[];
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

export interface IndexingAcceleratorWorkerSnapshot {
    endpoint: string;
    healthy: boolean;
    inFlight: number;
    rejectedReason?: string;
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
    state: 'queued' | 'running' | 'running_embedding' | 'running_insert' | 'completed' | 'failed' | 'cancelled';
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
            maxBgeM3Workers: config.maxBgeM3Workers,
            vramLimitPercent: config.vramLimitPercent,
            retryBudget: config.retryBudget,
            accelerateBackgroundSync: config.accelerateBackgroundSync,
            inFlightEmbeddingBatches: 0,
            inFlightInsertBatches: 0,
            queuedBatches: 0,
            runningEmbeddingBatches: 0,
            runningInsertBatches: 0,
            backpressureWaitMs: 0,
            submittedBatches: 0,
            completedBatches: 0,
            failedBatches: 0,
            retriedBatches: 0,
            activeWorkers: undefined,
            rejectedWorkers: undefined,
            workers: undefined,
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

    recordBatchCompleted(batchId?: number): void {
        this.snapshot.completedBatches++;
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'completed';
            }
        }
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

    recordBatchCancelled(batchId?: number): void {
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.state = 'cancelled';
            }
        }
    }

    recordBatchRetried(batchId?: number): void {
        this.snapshot.retriedBatches++;
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.attempts++;
            }
        }
    }

    updateWorkerCounts(
        activeWorkers: number,
        rejectedWorkers: number,
        workers?: IndexingAcceleratorWorkerSnapshot[],
    ): void {
        this.snapshot.activeWorkers = activeWorkers;
        this.snapshot.rejectedWorkers = rejectedWorkers;
        this.snapshot.workers = workers?.map((worker) => ({ ...worker }));
    }

    recordChunkLimit(codeChunkLimit: number): void {
        this.snapshot.codeChunkLimit = codeChunkLimit;
        this.snapshot.limitReached = false;
    }

    recordSchedulerSnapshot(metrics: {
        queuedBatches: number;
        runningEmbeddingBatches: number;
        runningInsertBatches: number;
    }): void {
        this.snapshot.queuedBatches = metrics.queuedBatches;
        this.snapshot.runningEmbeddingBatches = metrics.runningEmbeddingBatches;
        this.snapshot.runningInsertBatches = metrics.runningInsertBatches;
    }

    recordBackpressureWait(durationMs: number): void {
        this.snapshot.backpressureWaitMs = (this.snapshot.backpressureWaitMs ?? 0) + durationMs;
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

    return {
        mode,
        embeddingConcurrency: parsePositiveInteger('INDEX_EMBEDDING_CONCURRENCY', mode === 'auto' ? 2 : 1),
        insertConcurrency: parsePositiveInteger('INDEX_INSERT_CONCURRENCY', mode === 'auto' ? 2 : 1),
        maxBgeM3Workers: parsePositiveInteger('BGE_M3_ACCELERATOR_MAX_WORKERS', 1),
        vramLimitPercent: parsePercent('BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT', 75),
        retryBudget: parsePositiveInteger('INDEX_ACCELERATOR_RETRY_BUDGET', 1),
        accelerateBackgroundSync: parseBoolean('INDEX_ACCELERATE_BACKGROUND_SYNC', false),
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
