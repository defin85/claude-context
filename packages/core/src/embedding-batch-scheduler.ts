import {
    IndexingAcceleratorRuntime,
    IndexingBatchMetadata,
} from './indexing-accelerator';

export interface EmbeddingBatchSchedulerOptions {
    embeddingConcurrency: number;
    insertConcurrency: number;
    queueCapacity?: number;
    runtime: IndexingAcceleratorRuntime;
    abortSignal?: AbortSignal;
    onProgress?: () => void;
}

export interface EmbeddingBatchSchedulerSubmitOptions<T> {
    metadata: IndexingBatchMetadata;
    runEmbedding: () => Promise<T>;
    runInsert: (embeddingResult: T) => Promise<void>;
}

export interface EmbeddingBatchSchedulerSubmitHandle {
    completion: Promise<void>;
}

interface QueuedBatch<T> extends EmbeddingBatchSchedulerSubmitOptions<T> {
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class EmbeddingBatchScheduler {
    private readonly embeddingConcurrency: number;
    private readonly insertConcurrency: number;
    private readonly queueCapacity: number;
    private readonly queue: QueuedBatch<unknown>[] = [];
    private readonly completionPromises = new Set<Promise<void>>();
    private readonly capacityWaiters: Array<() => void> = [];
    private runningEmbedding = 0;
    private runningInsert = 0;
    private cancelledError?: Error;

    constructor(private readonly options: EmbeddingBatchSchedulerOptions) {
        this.embeddingConcurrency = Math.max(1, options.embeddingConcurrency);
        this.insertConcurrency = Math.max(1, options.insertConcurrency);
        this.queueCapacity = options.queueCapacity ?? getDefaultEmbeddingBatchQueueCapacity(
            this.embeddingConcurrency,
        );
        options.abortSignal?.addEventListener('abort', () => {
            this.cancel(this.getAbortError());
        }, { once: true });
        this.publish();
    }

    async submit<T>(options: EmbeddingBatchSchedulerSubmitOptions<T>): Promise<EmbeddingBatchSchedulerSubmitHandle> {
        this.throwIfCancelled();
        await this.waitForCapacity();
        this.throwIfCancelled();

        let resolveCompletion!: () => void;
        let rejectCompletion!: (error: unknown) => void;
        const completion = new Promise<void>((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        });
        this.completionPromises.add(completion);
        completion.finally(() => {
            this.completionPromises.delete(completion);
            this.notifyCapacityWaiters();
            this.publish();
        }).catch(() => {
            // The original completion promise is returned to the caller; this
            // observer only keeps scheduler bookkeeping from creating an
            // unhandled rejection.
        });

        this.options.runtime.recordBatchQueued(options.metadata);
        this.queue.push({
            ...options,
            resolve: resolveCompletion,
            reject: rejectCompletion,
        } as QueuedBatch<unknown>);
        this.publish();
        this.scheduleEmbedding();

        return { completion };
    }

    async drain(): Promise<void> {
        await Promise.all([...this.completionPromises]);
    }

    async cancel(reason?: Error): Promise<void> {
        this.cancelledError = reason ?? this.cancelledError ?? new Error('Queued indexing batch cancelled.');
        while (this.queue.length > 0) {
            const queued = this.queue.shift();
            if (!queued) {
                continue;
            }
            this.options.runtime.recordBatchCancelled(queued.metadata.id);
            queued.reject(this.cancelledError);
        }
        this.notifyCapacityWaiters();
        this.publish();
        await Promise.allSettled([...this.completionPromises]);
    }

    getSnapshot(): {
        queuedBatches: number;
        runningEmbeddingBatches: number;
        runningInsertBatches: number;
        backpressureWaitMs: number;
    } {
        return {
            queuedBatches: this.queue.length,
            runningEmbeddingBatches: this.runningEmbedding,
            runningInsertBatches: this.runningInsert,
            backpressureWaitMs: this.options.runtime.getSnapshot().backpressureWaitMs ?? 0,
        };
    }

    private async waitForCapacity(): Promise<void> {
        const startedAt = Date.now();
        while (this.getQueuedAndRunningEmbeddingCount() >= this.queueCapacity) {
            this.throwIfCancelled();
            await new Promise<void>((resolve) => {
                this.capacityWaiters.push(resolve);
            });
        }
        const waitedMs = Date.now() - startedAt;
        if (waitedMs > 0) {
            this.options.runtime.recordBackpressureWait(waitedMs);
            this.publish();
        }
    }

    private scheduleEmbedding(): void {
        while (
            !this.cancelledError &&
            this.runningEmbedding < this.embeddingConcurrency &&
            this.queue.length > 0
        ) {
            const item = this.queue.shift();
            if (!item) {
                return;
            }
            this.runningEmbedding++;
            this.options.runtime.recordBatchRunningEmbedding(item.metadata.id);
            this.publish();
            void this.runEmbedding(item);
        }
    }

    private async runEmbedding<T>(item: QueuedBatch<T>): Promise<void> {
        try {
            const embeddingResult = await item.runEmbedding();
            this.runningEmbedding = Math.max(0, this.runningEmbedding - 1);
            this.notifyCapacityWaiters();
            this.publish();
            this.scheduleEmbedding();
            await this.runInsert(item, embeddingResult);
        } catch (error) {
            this.runningEmbedding = Math.max(0, this.runningEmbedding - 1);
            this.options.runtime.recordBatchFailed(item.metadata.id);
            item.reject(error);
            this.notifyCapacityWaiters();
            this.publish();
            this.scheduleEmbedding();
        }
    }

    private async runInsert<T>(item: QueuedBatch<T>, embeddingResult: T): Promise<void> {
        await this.waitForInsertSlot();
        this.runningInsert++;
        this.options.runtime.recordBatchRunningInsert(item.metadata.id);
        this.publish();
        try {
            await item.runInsert(embeddingResult);
            this.options.runtime.recordBatchCompleted(item.metadata.id);
            item.resolve();
        } catch (error) {
            this.options.runtime.recordBatchFailed(item.metadata.id);
            item.reject(error);
        } finally {
            this.runningInsert = Math.max(0, this.runningInsert - 1);
            this.publish();
            this.scheduleEmbedding();
        }
    }

    private async waitForInsertSlot(): Promise<void> {
        while (this.runningInsert >= this.insertConcurrency) {
            this.throwIfCancelled();
            await new Promise<void>((resolve) => {
                const retry = () => {
                    if (this.runningInsert < this.insertConcurrency) {
                        resolve();
                    } else {
                        setTimeout(retry, 1);
                    }
                };
                setTimeout(retry, 1);
            });
        }
    }

    private getQueuedAndRunningEmbeddingCount(): number {
        return this.queue.length + this.runningEmbedding;
    }

    private notifyCapacityWaiters(): void {
        while (
            this.capacityWaiters.length > 0 &&
            this.getQueuedAndRunningEmbeddingCount() < this.queueCapacity
        ) {
            this.capacityWaiters.shift()?.();
        }
    }

    private publish(): void {
        this.options.runtime.recordSchedulerSnapshot({
            queuedBatches: this.queue.length,
            runningEmbeddingBatches: this.runningEmbedding,
            runningInsertBatches: this.runningInsert,
        });
        this.options.onProgress?.();
    }

    private throwIfCancelled(): void {
        if (this.cancelledError) {
            throw this.cancelledError;
        }
        if (this.options.abortSignal?.aborted) {
            throw this.getAbortError();
        }
    }

    private getAbortError(): Error {
        const reason = this.options.abortSignal?.reason;
        if (reason instanceof Error) {
            return reason;
        }
        if (typeof reason === 'string' && reason.trim().length > 0) {
            return new Error(reason);
        }
        return new Error('Queued indexing batch cancelled.');
    }
}

export function getDefaultEmbeddingBatchQueueCapacity(embeddingConcurrency: number): number {
    return Math.max(embeddingConcurrency, embeddingConcurrency * 2);
}
