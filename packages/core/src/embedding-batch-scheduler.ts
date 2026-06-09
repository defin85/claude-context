import {
    AdaptiveBackpressureController,
    AdaptiveBackpressureConfig,
    IndexingAcceleratorResourcePressure,
    createAdaptivePressureSignals,
    createDefaultAdaptiveBackpressureConfig,
    IndexingAcceleratorRuntime,
    IndexingBatchMetadata,
} from './indexing-accelerator';

export interface EmbeddingBatchSchedulerOptions {
    embeddingConcurrency: number;
    insertConcurrency: number;
    queueCapacity?: number;
    insertQueueCapacity?: number;
    adaptiveBackpressure?: AdaptiveBackpressureConfig;
    runtime: IndexingAcceleratorRuntime;
    abortSignal?: AbortSignal;
    resourcePressureProvider?: () => IndexingAcceleratorResourcePressure | undefined;
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

interface QueuedInsert<T> {
    item: QueuedBatch<T>;
    embeddingResult: T;
}

export class EmbeddingBatchScheduler {
    private readonly embeddingConcurrency: number;
    private readonly insertConcurrency: number;
    private readonly queueCapacity: number;
    private readonly insertQueueCapacity: number;
    private readonly adaptiveController: AdaptiveBackpressureController;
    private readonly queue: QueuedBatch<unknown>[] = [];
    private readonly insertQueue: QueuedInsert<unknown>[] = [];
    private readonly completionPromises = new Set<Promise<void>>();
    private readonly capacityWaiters: Array<() => void> = [];
    private readonly insertCapacityWaiters: Array<() => void> = [];
    private runningEmbedding = 0;
    private runningInsert = 0;
    private pendingAdmissions = 0;
    private cancelledError?: Error;
    private terminalInsertError?: unknown;

    constructor(private readonly options: EmbeddingBatchSchedulerOptions) {
        this.embeddingConcurrency = Math.max(1, options.embeddingConcurrency);
        this.insertConcurrency = Math.max(1, options.insertConcurrency);
        this.queueCapacity = options.queueCapacity ?? getDefaultEmbeddingBatchQueueCapacity(
            this.embeddingConcurrency,
        );
        this.insertQueueCapacity = Math.max(
            1,
            options.insertQueueCapacity ?? getDefaultInsertQueueCapacity(this.insertConcurrency),
        );
        const runtimeSnapshot = options.runtime.getSnapshot();
        const adaptiveDefaults = createDefaultAdaptiveBackpressureConfig(
            runtimeSnapshot.adaptiveBackpressureEnabled,
        );
        this.adaptiveController = new AdaptiveBackpressureController({
            config: options.adaptiveBackpressure ?? adaptiveDefaults,
            configuredEmbeddingConcurrency: this.embeddingConcurrency,
            configuredInsertConcurrency: this.insertConcurrency,
            queueCapacity: this.queueCapacity,
        });
        options.abortSignal?.addEventListener('abort', () => {
            this.cancel(this.getAbortError());
        }, { once: true });
        this.publish();
    }

    async submit<T>(options: EmbeddingBatchSchedulerSubmitOptions<T>): Promise<EmbeddingBatchSchedulerSubmitHandle> {
        this.throwIfClosed();
        await this.waitForCapacityAndReserve();
        try {
            this.throwIfClosed();
        } catch (error) {
            this.releaseAdmissionReservation();
            throw error;
        }

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
        this.releaseAdmissionReservation();
        this.notifyCapacityWaiters();
        this.publish();
        this.scheduleEmbedding();

        return { completion };
    }

    async drain(): Promise<void> {
        const results = await Promise.allSettled([...this.completionPromises]);
        if (this.terminalInsertError) {
            throw this.terminalInsertError;
        }
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (rejected) {
            throw rejected.reason;
        }
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
        while (this.insertQueue.length > 0) {
            const queuedInsert = this.insertQueue.shift();
            if (!queuedInsert) {
                continue;
            }
            this.options.runtime.recordBatchCancelled(queuedInsert.item.metadata.id);
            queuedInsert.item.reject(this.cancelledError);
        }
        this.notifyCapacityWaiters();
        this.notifyInsertCapacityWaiters();
        this.publish();
        await Promise.allSettled([...this.completionPromises]);
    }

    getSnapshot(): {
        queuedBatches: number;
        runningEmbeddingBatches: number;
        queuedInsertBatches: number;
        runningInsertBatches: number;
        backpressureWaitMs: number;
        effectiveEmbeddingConcurrency: number;
        adaptivePressureScore: number;
        adaptiveThrottleReason: string;
        adaptiveThrottleTimeMs: number;
    } {
        const adaptiveState = this.getAdaptiveState();
        return {
            queuedBatches: this.queue.length,
            runningEmbeddingBatches: this.runningEmbedding,
            queuedInsertBatches: this.insertQueue.length,
            runningInsertBatches: this.runningInsert,
            backpressureWaitMs: this.options.runtime.getSnapshot().backpressureWaitMs ?? 0,
            effectiveEmbeddingConcurrency: adaptiveState.effectiveEmbeddingConcurrency,
            adaptivePressureScore: adaptiveState.pressureScore,
            adaptiveThrottleReason: adaptiveState.throttleReason,
            adaptiveThrottleTimeMs: adaptiveState.throttleTimeMs,
        };
    }

    private async waitForCapacityAndReserve(): Promise<void> {
        const startedAt = Date.now();
        while (this.getReservedEmbeddingCount() >= this.getEffectiveQueueCapacity()) {
            this.throwIfClosed();
            await new Promise<void>((resolve) => {
                this.capacityWaiters.push(resolve);
            });
        }
        this.throwIfClosed();
        this.pendingAdmissions++;
        const waitedMs = Date.now() - startedAt;
        if (waitedMs > 0) {
            this.options.runtime.recordBackpressureWait(waitedMs);
            this.publish();
        }
    }

    private scheduleEmbedding(): void {
        while (
            !this.cancelledError &&
            !this.terminalInsertError &&
            this.runningEmbedding < this.getEffectiveEmbeddingConcurrency() &&
            this.queue.length > 0 &&
            this.hasInsertBacklogCapacity()
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
            if (this.terminalInsertError) {
                this.options.runtime.recordBatchFailed(item.metadata.id);
                item.reject(this.terminalInsertError);
                this.notifyCapacityWaiters();
                this.publish();
                return;
            }
            this.notifyCapacityWaiters();
            this.publish();
            this.scheduleEmbedding();
            await this.enqueueInsert(item, embeddingResult);
        } catch (error) {
            this.runningEmbedding = Math.max(0, this.runningEmbedding - 1);
            const failure = this.terminalInsertError ?? error;
            this.options.runtime.recordBatchFailed(item.metadata.id);
            item.reject(failure);
            this.notifyCapacityWaiters();
            this.publish();
            this.scheduleEmbedding();
        }
    }

    private async enqueueInsert<T>(item: QueuedBatch<T>, embeddingResult: T): Promise<void> {
        try {
            this.throwIfTerminalInsertFailure();
            await this.waitForInsertQueueCapacity();
            this.throwIfTerminalInsertFailure();
        } catch (error) {
            this.options.runtime.recordBatchFailed(item.metadata.id);
            item.reject(error);
            this.notifyCapacityWaiters();
            this.publish();
            return;
        }
        this.insertQueue.push({ item, embeddingResult } as QueuedInsert<unknown>);
        this.options.runtime.recordBatchQueuedInsert(item.metadata.id);
        this.publish();
        this.scheduleInsert();
    }

    private scheduleInsert(): void {
        while (
            !this.terminalInsertError &&
            this.runningInsert < this.insertConcurrency &&
            this.insertQueue.length > 0
        ) {
            const queuedInsert = this.insertQueue.shift();
            if (!queuedInsert) {
                return;
            }
            void this.runInsert(queuedInsert);
        }
    }

    private async runInsert<T>(queuedInsert: QueuedInsert<T>): Promise<void> {
        const { item, embeddingResult } = queuedInsert;
        this.runningInsert++;
        this.options.runtime.recordBatchRunningInsert(item.metadata.id);
        this.notifyInsertCapacityWaiters();
        this.publish();
        try {
            await item.runInsert(embeddingResult);
            this.options.runtime.recordInsertCompleted();
            this.options.runtime.recordBatchCompleted(item.metadata.id);
            item.resolve();
        } catch (error) {
            this.options.runtime.recordInsertFailed();
            this.options.runtime.recordBatchFailed(item.metadata.id);
            const failure = this.recordTerminalInsertFailure(error);
            item.reject(failure);
        } finally {
            this.runningInsert = Math.max(0, this.runningInsert - 1);
            this.notifyInsertCapacityWaiters();
            this.notifyCapacityWaiters();
            this.publish();
            this.scheduleInsert();
            this.scheduleEmbedding();
        }
    }

    private async waitForInsertQueueCapacity(): Promise<void> {
        while (!this.hasInsertBacklogCapacity()) {
            this.throwIfTerminalInsertFailure();
            await new Promise<void>((resolve) => {
                this.insertCapacityWaiters.push(resolve);
            });
        }
        this.throwIfTerminalInsertFailure();
    }

    private getQueuedAndRunningEmbeddingCount(): number {
        return this.queue.length + this.runningEmbedding;
    }

    private getReservedEmbeddingCount(): number {
        return this.getQueuedAndRunningEmbeddingCount() + this.pendingAdmissions;
    }

    private releaseAdmissionReservation(): void {
        this.pendingAdmissions = Math.max(0, this.pendingAdmissions - 1);
        this.notifyCapacityWaiters();
    }

    private notifyCapacityWaiters(): void {
        if (this.cancelledError || this.terminalInsertError || this.options.abortSignal?.aborted) {
            while (this.capacityWaiters.length > 0) {
                this.capacityWaiters.shift()?.();
            }
            return;
        }
        while (
            this.capacityWaiters.length > 0 &&
            this.getReservedEmbeddingCount() < this.getEffectiveQueueCapacity()
        ) {
            this.capacityWaiters.shift()?.();
        }
    }

    private hasInsertBacklogCapacity(): boolean {
        return this.insertQueue.length < this.insertQueueCapacity;
    }

    private notifyInsertCapacityWaiters(): void {
        if (this.cancelledError || this.terminalInsertError || this.options.abortSignal?.aborted) {
            while (this.insertCapacityWaiters.length > 0) {
                this.insertCapacityWaiters.shift()?.();
            }
            return;
        }
        while (this.insertCapacityWaiters.length > 0 && this.hasInsertBacklogCapacity()) {
            this.insertCapacityWaiters.shift()?.();
        }
    }

    private publish(): void {
        const adaptiveState = this.observeAdaptivePressure();
        this.options.runtime.recordSchedulerSnapshot({
            queuedBatches: this.queue.length,
            runningEmbeddingBatches: this.runningEmbedding,
            queuedInsertBatches: this.insertQueue.length,
            runningInsertBatches: this.runningInsert,
        });
        this.options.runtime.recordAdaptiveBackpressure(adaptiveState);
        this.options.onProgress?.();
    }

    private observeAdaptivePressure() {
        const resourcePressure = this.options.resourcePressureProvider?.();
        if (resourcePressure) {
            this.options.runtime.recordResourcePressure(resourcePressure);
        }
        return this.adaptiveController.observe(
            createAdaptivePressureSignals(this.options.runtime.getSnapshot()),
        );
    }

    private getAdaptiveState() {
        return this.adaptiveController.getCurrentState();
    }

    private getEffectiveEmbeddingConcurrency(): number {
        return this.observeAdaptivePressure().effectiveEmbeddingConcurrency;
    }

    private getEffectiveQueueCapacity(): number {
        return this.observeAdaptivePressure().effectiveQueueCapacity;
    }

    private throwIfCancelled(): void {
        if (this.cancelledError) {
            throw this.cancelledError;
        }
        if (this.options.abortSignal?.aborted) {
            throw this.getAbortError();
        }
    }

    private throwIfClosed(): void {
        this.throwIfCancelled();
        this.throwIfTerminalInsertFailure();
    }

    private throwIfTerminalInsertFailure(): void {
        if (this.terminalInsertError) {
            throw this.terminalInsertError;
        }
    }

    private recordTerminalInsertFailure(error: unknown): unknown {
        if (!this.terminalInsertError) {
            this.terminalInsertError = error;
            this.rejectQueuedWork(error);
        }
        return this.terminalInsertError;
    }

    private rejectQueuedWork(error: unknown): void {
        while (this.queue.length > 0) {
            const queued = this.queue.shift();
            if (!queued) {
                continue;
            }
            this.options.runtime.recordBatchFailed(queued.metadata.id);
            queued.reject(error);
        }
        while (this.insertQueue.length > 0) {
            const queuedInsert = this.insertQueue.shift();
            if (!queuedInsert) {
                continue;
            }
            this.options.runtime.recordBatchFailed(queuedInsert.item.metadata.id);
            queuedInsert.item.reject(error);
        }
        this.notifyCapacityWaiters();
        this.notifyInsertCapacityWaiters();
        this.publish();
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

export function getDefaultInsertQueueCapacity(insertConcurrency: number): number {
    return Math.max(1, insertConcurrency * 2);
}
