import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkloadManager } from './workload-manager.js';

test('workload manager snapshot includes queue position for queued jobs', async () => {
    const manager = new WorkloadManager({
        mode: 'daemon',
        maxIndexingConcurrency: 1,
    });
    let releaseActive!: () => void;

    manager.enqueueInteractiveIndexing('/repo/active', () => new Promise<void>((resolve) => {
        releaseActive = resolve;
    }));
    manager.enqueueInteractiveIndexing('/repo/queued-1', async () => undefined);
    manager.enqueueInteractiveIndexing('/repo/queued-2', async () => undefined);

    await new Promise((resolve) => setImmediate(resolve));

    const snapshot = manager.getSnapshot();
    assert.equal(snapshot.indexing.activeCount, 1);
    assert.equal(snapshot.indexing.queuedCount, 2);
    assert.deepEqual(snapshot.indexing.queuedJobs.map((job) => ({
        codebasePath: job.codebasePath,
        queuePosition: job.queuePosition,
    })), [
        { codebasePath: '/repo/queued-1', queuePosition: 1 },
        { codebasePath: '/repo/queued-2', queuePosition: 2 },
    ]);

    releaseActive();
});
