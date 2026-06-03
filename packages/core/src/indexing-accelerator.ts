import { envManager } from './utils/env-manager';

export type IndexingAcceleratorMode = 'off' | 'auto';

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
    submittedBatches: number;
    completedBatches: number;
    failedBatches: number;
    retriedBatches: number;
    activeWorkers?: number;
    rejectedWorkers?: number;
    batches: IndexingBatchSnapshot[];
    scanningMs: number;
    splittingMs: number;
    embeddingMs: number;
    insertMs: number;
}

export interface IndexingBatchMetadata {
    id: number;
    chunkCount: number;
    firstFile?: string;
    lastFile?: string;
}

export interface IndexingBatchSnapshot extends IndexingBatchMetadata {
    attempts: number;
    state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
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
            submittedBatches: 0,
            completedBatches: 0,
            failedBatches: 0,
            retriedBatches: 0,
            activeWorkers: undefined,
            rejectedWorkers: undefined,
            batches: [],
            scanningMs: 0,
            splittingMs: 0,
            embeddingMs: 0,
            insertMs: 0,
        };
    }

    getSnapshot(): IndexingAcceleratorSnapshot {
        return {
            ...this.snapshot,
            batches: [...this.batches.values()].map((batch) => ({ ...batch })),
        };
    }

    recordScan(durationMs: number): void {
        this.snapshot.scanningMs += durationMs;
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

    recordBatchRetried(batchId?: number): void {
        this.snapshot.retriedBatches++;
        if (batchId !== undefined) {
            const batch = this.batches.get(batchId);
            if (batch) {
                batch.attempts++;
            }
        }
    }

    updateWorkerCounts(activeWorkers: number, rejectedWorkers: number): void {
        this.snapshot.activeWorkers = activeWorkers;
        this.snapshot.rejectedWorkers = rejectedWorkers;
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
        insertConcurrency: parsePositiveInteger('INDEX_INSERT_CONCURRENCY', 1),
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
