import { EmbeddingBatchScheduler } from './embedding-batch-scheduler';
import {
    createDefaultAdaptiveBackpressureConfig,
    IndexingAcceleratorConfig,
    IndexingAcceleratorRuntime,
} from './indexing-accelerator';

function createRuntime(): IndexingAcceleratorRuntime {
    const config: IndexingAcceleratorConfig = {
        mode: 'auto',
        embeddingBatchSize: 100,
        insertBatchSize: 100,
        embeddingConcurrency: 2,
        insertConcurrency: 1,
        insertQueueCapacity: 2,
        maxBgeM3Workers: 2,
        vramLimitPercent: 75,
        retryBudget: 1,
        accelerateBackgroundSync: false,
        adaptiveBackpressure: createDefaultAdaptiveBackpressureConfig(true),
    };
    return new IndexingAcceleratorRuntime(config, true);
}

function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return { promise, resolve, reject };
}

describe('EmbeddingBatchScheduler', () => {
    it('applies producer backpressure when queued plus running embedding batches reaches capacity', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            queueCapacity: 1,
        });
        const firstEmbedding = deferred<string>();
        const completions: Promise<void>[] = [];

        completions.push((await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: () => firstEmbedding.promise,
            runInsert: async () => {},
        })).completion);

        let secondSubmitResolved = false;
        const secondSubmit = scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => 'second',
            runInsert: async () => {},
        }).then((handle) => {
            secondSubmitResolved = true;
            completions.push(handle.completion);
        });

        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(secondSubmitResolved).toBe(false);
        expect(runtime.getSnapshot().backpressureWaitMs).toBe(0);

        firstEmbedding.resolve('first');
        await secondSubmit;
        await Promise.all(completions);

        const snapshot = runtime.getSnapshot();
        expect(secondSubmitResolved).toBe(true);
        expect(snapshot.submittedBatches).toBe(2);
        expect(snapshot.completedBatches).toBe(2);
        expect(snapshot.backpressureWaitMs).toBeGreaterThan(0);
    });

    it('releases embedding slots before insert slots drain', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            queueCapacity: 2,
        });
        const firstInsert = deferred<void>();
        let secondEmbeddingStarted = false;

        const firstCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: async () => 'first',
            runInsert: () => firstInsert.promise,
        })).completion;
        const secondCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => {
                secondEmbeddingStarted = true;
                return 'second';
            },
            runInsert: async () => {},
        })).completion;

        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(secondEmbeddingStarted).toBe(true);
        expect(runtime.getSnapshot().runningInsertBatches).toBe(1);

        firstInsert.resolve();
        await Promise.all([firstCompletion, secondCompletion]);
        expect(runtime.getSnapshot().completedBatches).toBe(2);
    });

    it('bounds insert backlog and reports insert scheduler counters', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            queueCapacity: 4,
            insertQueueCapacity: 1,
        });
        const firstInsert = deferred<void>();
        let thirdEmbeddingStarted = false;

        const firstCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: async () => 'first',
            runInsert: () => firstInsert.promise,
        })).completion;
        const secondCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => 'second',
            runInsert: async () => {},
        })).completion;
        const thirdHandle = await scheduler.submit({
            metadata: { id: 3, chunkCount: 1 },
            runEmbedding: async () => {
                thirdEmbeddingStarted = true;
                return 'third';
            },
            runInsert: async () => {},
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
        let snapshot = runtime.getSnapshot();
        expect(snapshot.runningInsertBatches).toBe(1);
        expect(snapshot.queuedInsertBatches).toBe(1);
        expect(snapshot.completedInsertBatches).toBe(0);
        expect(thirdEmbeddingStarted).toBe(false);

        firstInsert.resolve();
        await Promise.all([firstCompletion, secondCompletion, thirdHandle.completion]);

        snapshot = runtime.getSnapshot();
        expect(snapshot.completedBatches).toBe(3);
        expect(snapshot.completedInsertBatches).toBe(3);
        expect(snapshot.failedInsertBatches).toBe(0);
        expect(snapshot.queuedInsertBatches).toBe(0);
    });

    it('cancels queued batches and waits for active batches to settle', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            queueCapacity: 3,
        });
        const activeEmbedding = deferred<string>();

        const activeCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: () => activeEmbedding.promise,
            runInsert: async () => {},
        })).completion;
        const queuedCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => 'queued',
            runInsert: async () => {},
        })).completion;

        const cancelPromise = scheduler.cancel(new Error('cancelled by test'));
        await expect(queuedCompletion).rejects.toThrow('cancelled by test');
        activeEmbedding.resolve('active');
        await expect(activeCompletion).resolves.toBeUndefined();
        await cancelPromise;

        const snapshot = runtime.getSnapshot();
        expect(snapshot.completedBatches).toBe(1);
        expect(snapshot.batches.find((batch) => batch.id === 2)?.state).toBe('cancelled');
        expect(snapshot.queuedBatches).toBe(0);
    });

    it('cancels queued insert batches and waits for running inserts to settle', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 2,
            insertConcurrency: 1,
            queueCapacity: 4,
            insertQueueCapacity: 1,
        });
        const runningInsert = deferred<void>();

        const firstCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: async () => 'first',
            runInsert: () => runningInsert.promise,
        })).completion;
        const queuedInsertCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => 'second',
            runInsert: async () => {},
        })).completion;

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(runtime.getSnapshot().runningInsertBatches).toBe(1);
        expect(runtime.getSnapshot().queuedInsertBatches).toBe(1);

        const cancelPromise = scheduler.cancel(new Error('cancelled by test'));
        await expect(queuedInsertCompletion).rejects.toThrow('cancelled by test');
        runningInsert.resolve();
        await expect(firstCompletion).resolves.toBeUndefined();
        await cancelPromise;

        const snapshot = runtime.getSnapshot();
        expect(snapshot.completedBatches).toBe(1);
        expect(snapshot.batches.find((batch) => batch.id === 2)?.state).toBe('cancelled');
        expect(snapshot.queuedInsertBatches).toBe(0);
        expect(snapshot.runningInsertBatches).toBe(0);
    });

    it('reports queued, running embedding, running insert, completed, failed, retried, and backpressure metrics', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            queueCapacity: 2,
        });
        const activeEmbedding = deferred<string>();

        const firstCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: () => activeEmbedding.promise,
            runInsert: async () => {},
        })).completion;
        const failedCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => {
                runtime.recordBatchRetried(2, 'embedding_timeout', true);
                throw new Error('embedding failed');
            },
            runInsert: async () => {},
        })).completion;

        let snapshot = runtime.getSnapshot();
        expect(snapshot.runningEmbeddingBatches).toBe(1);
        expect(snapshot.queuedBatches).toBe(1);

        activeEmbedding.resolve('first');
        await firstCompletion;
        await expect(failedCompletion).rejects.toThrow('embedding failed');

        snapshot = runtime.getSnapshot();
        expect(snapshot.completedBatches).toBe(1);
        expect(snapshot.failedBatches).toBe(1);
        expect(snapshot.retriedBatches).toBe(1);
        expect(snapshot.retryReasons.embedding_timeout).toBe(1);
        expect(snapshot.retrySafeFailures).toBe(1);
        expect(snapshot.retryUnsafeFailures).toBe(0);
        expect(snapshot.batches.find((batch) => batch.id === 2)?.attempts).toBe(2);
        expect(snapshot.runningEmbeddingBatches).toBe(0);
        expect(snapshot.runningInsertBatches).toBe(0);
    });

    it('summarizes worker rejection and recovery transitions by reason', () => {
        const runtime = createRuntime();

        runtime.updateWorkerCounts(1, 0, [{
            endpoint: 'http://127.0.0.1:8000',
            healthy: true,
            inFlight: 0,
            recoveryAttempts: 0,
            poolState: 'accepted',
        }]);
        runtime.updateWorkerCounts(0, 1, [{
            endpoint: 'http://127.0.0.1:8000',
            healthy: false,
            inFlight: 0,
            rejectedFailureReason: 'embedding_error',
            rejectedRetrySafe: true,
            recoveryAttempts: 0,
            poolState: 'rejected',
        }]);
        runtime.updateWorkerCounts(1, 0, [{
            endpoint: 'http://127.0.0.1:8000',
            healthy: true,
            inFlight: 0,
            recoveryAttempts: 1,
            poolState: 'accepted',
        }]);

        const snapshot = runtime.getSnapshot();
        expect(snapshot.workerLifecycle.rejected).toBe(1);
        expect(snapshot.workerLifecycle.recovered).toBe(1);
        expect(snapshot.workerLifecycle.byReason.embedding_error).toBe(1);
    });

    it('counts an insert-stage failure once', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
        });

        const completion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: async () => 'embedded',
            runInsert: async () => {
                throw new Error('insert failed');
            },
        })).completion;

        await expect(completion).rejects.toThrow('insert failed');

        const snapshot = runtime.getSnapshot();
        expect(snapshot.failedBatches).toBe(1);
        expect(snapshot.failedInsertBatches).toBe(1);
        expect(snapshot.batches.find((batch) => batch.id === 1)?.state).toBe('failed');
        expect(snapshot.runningEmbeddingBatches).toBe(0);
        expect(snapshot.runningInsertBatches).toBe(0);
    });

    it('uses adaptive effective concurrency and queue capacity for producer admission', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 3,
            insertConcurrency: 1,
            queueCapacity: 6,
            insertQueueCapacity: 1,
            adaptiveBackpressure: {
                ...createDefaultAdaptiveBackpressureConfig(true),
                insertBacklogThreshold: 1,
                insertBacklogMinBatches: 0,
                insertLatencyMsThreshold: 1,
                highPressureThreshold: 1,
                lowPressureThreshold: 0.25,
                healthySampleCount: 2,
                cooldownMs: 1,
            },
        });
        const runningInsert = deferred<void>();
        let secondEmbeddingStarted = false;
        let thirdSubmitResolved = false;
        let fourthSubmitResolved = false;
        let fifthSubmitResolved = false;

        const firstCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: async () => 'first',
            runInsert: () => runningInsert.promise,
        })).completion;
        const secondCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => {
                secondEmbeddingStarted = true;
                return 'second';
            },
            runInsert: async () => {},
        })).completion;

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(secondEmbeddingStarted).toBe(true);
        expect(runtime.getSnapshot().runningInsertBatches).toBe(1);
        expect(runtime.getSnapshot().queuedInsertBatches).toBe(1);

        const thirdSubmit = scheduler.submit({
            metadata: { id: 3, chunkCount: 1 },
            runEmbedding: async () => 'third',
            runInsert: async () => {},
        }).then((handle) => {
            thirdSubmitResolved = true;
            return handle.completion;
        });
        const fourthSubmit = scheduler.submit({
            metadata: { id: 4, chunkCount: 1 },
            runEmbedding: async () => 'fourth',
            runInsert: async () => {},
        }).then((handle) => {
            fourthSubmitResolved = true;
            return handle.completion;
        });
        const fifthSubmit = scheduler.submit({
            metadata: { id: 5, chunkCount: 1 },
            runEmbedding: async () => 'fifth',
            runInsert: async () => {},
        }).then((handle) => {
            fifthSubmitResolved = true;
            return handle.completion;
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(thirdSubmitResolved).toBe(true);
        expect(fourthSubmitResolved).toBe(true);
        expect(fifthSubmitResolved).toBe(false);
        expect(runtime.getSnapshot().effectiveEmbeddingConcurrency).toBeLessThan(3);
        expect(runtime.getSnapshot().adaptiveThrottleReason).toBe('insert_backlog');

        runningInsert.resolve();
        await Promise.all([firstCompletion, secondCompletion, thirdSubmit, fourthSubmit, fifthSubmit]);

        const snapshot = runtime.getSnapshot();
        expect(snapshot.completedBatches).toBe(5);
        expect(snapshot.adaptiveThrottleEvents).toBeGreaterThan(0);
        expect(snapshot.adaptiveThrottleTimeMs).toBeGreaterThan(0);
    });

    it('keeps static capacity when adaptive backpressure is disabled', async () => {
        const runtime = createRuntime();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 2,
            insertConcurrency: 1,
            queueCapacity: 4,
            insertQueueCapacity: 1,
            adaptiveBackpressure: {
                ...createDefaultAdaptiveBackpressureConfig(true),
                enabled: false,
                insertBacklogThreshold: 1,
            },
        });
        const firstInsert = deferred<void>();
        let thirdSubmitResolved = false;

        const firstCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: async () => 'first',
            runInsert: () => firstInsert.promise,
        })).completion;
        const secondCompletion = (await scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => 'second',
            runInsert: async () => {},
        })).completion;
        const thirdSubmit = scheduler.submit({
            metadata: { id: 3, chunkCount: 1 },
            runEmbedding: async () => 'third',
            runInsert: async () => {},
        }).then((handle) => {
            thirdSubmitResolved = true;
            return handle.completion;
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(thirdSubmitResolved).toBe(true);
        expect(runtime.getSnapshot().effectiveEmbeddingConcurrency).toBe(2);
        expect(runtime.getSnapshot().adaptiveThrottleReason).toBe('none');

        firstInsert.resolve();
        await Promise.all([firstCompletion, secondCompletion, thirdSubmit]);
    });

    it('cancels producer waits created by adaptive admission', async () => {
        const runtime = createRuntime();
        const controller = new AbortController();
        const scheduler = new EmbeddingBatchScheduler({
            runtime,
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            queueCapacity: 1,
            abortSignal: controller.signal,
            adaptiveBackpressure: createDefaultAdaptiveBackpressureConfig(true),
        });
        const activeEmbedding = deferred<string>();

        const activeCompletion = (await scheduler.submit({
            metadata: { id: 1, chunkCount: 1 },
            runEmbedding: () => activeEmbedding.promise,
            runInsert: async () => {},
        })).completion;

        const blockedSubmit = scheduler.submit({
            metadata: { id: 2, chunkCount: 1 },
            runEmbedding: async () => 'blocked',
            runInsert: async () => {},
        });

        await new Promise((resolve) => setTimeout(resolve, 5));
        controller.abort(new Error('abort adaptive wait'));

        await expect(blockedSubmit).rejects.toThrow('abort adaptive wait');
        activeEmbedding.resolve('active');
        await expect(activeCompletion).resolves.toBeUndefined();
        await scheduler.cancel(new Error('cleanup'));
    });
});
