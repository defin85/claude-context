import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { SnapshotManager } from './snapshot.js';

test('indexing snapshot keeps detailed progress reporting payload', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-progress-'));
    const codebasePath = path.join(workspacePath, 'repo');
    await fs.mkdir(codebasePath);

    const manager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    const ownership = await manager.acquireIndexingOwnership(codebasePath);
    assert.equal(ownership.acquired, true);

    manager.setCodebaseIndexing(codebasePath, 98, {
        phase: 'Processing embedding batches (1405/1423, 4 embedding in-flight, 1 insert in-flight)...',
        current: 1405,
        total: 1423,
        percentage: 98,
    });

    const info = manager.getCodebaseInfo(codebasePath);
    assert.equal(info?.status, 'indexing');
    assert.deepEqual(info.progressDetails, {
        phase: 'Processing embedding batches (1405/1423, 4 embedding in-flight, 1 insert in-flight)...',
        current: 1405,
        total: 1423,
        percentage: 98,
    });

    manager.setCodebaseIndexing(codebasePath, 99);
    const updatedInfo = manager.getCodebaseInfo(codebasePath);
    assert.equal(updatedInfo?.status, 'indexing');
    assert.equal(updatedInfo.indexingPercentage, 99);
    assert.equal(updatedInfo.progressDetails?.current, 1405);

    await manager.saveCodebaseSnapshot('test-progress-details');

    const reloadedManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    await reloadedManager.loadCodebaseSnapshot();

    const reloadedInfo = reloadedManager.getCodebaseInfo(codebasePath);
    assert.equal(reloadedInfo?.status, 'indexing');
    assert.equal(reloadedInfo.indexingPercentage, 99);
    assert.equal(reloadedInfo.progressDetails?.phase, 'Processing embedding batches (1405/1423, 4 embedding in-flight, 1 insert in-flight)...');
    assert.equal(reloadedInfo.progressDetails?.total, 1423);
});
