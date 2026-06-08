import { EmbeddingBatchScheduler } from './embedding-batch-scheduler';
import {
    IndexingAcceleratorConfig,
    IndexingAcceleratorRuntime,
} from './indexing-accelerator';

function createRuntime(): IndexingAcceleratorRuntime {
    const config: IndexingAcceleratorConfig = {
        mode: 'auto',
        embeddingConcurrency: 2,
        insertConcurrency: 1,
        maxBgeM3Workers: 2,
        vramLimitPercent: 75,
        retryBudget: 1,
        accelerateBackgroundSync: false,
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
        expect(snapshot.batches.find((batch) => batch.id === 1)?.state).toBe('failed');
        expect(snapshot.runningEmbeddingBatches).toBe(0);
        expect(snapshot.runningInsertBatches).toBe(0);
    });
});
