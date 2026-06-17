import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStopManagedWorkersAfterCancellation } from './workload-cancellation-policy.js';

test('queued-only indexing cancellation must not stop managed workers used by active jobs', () => {
    assert.equal(shouldStopManagedWorkersAfterCancellation({
        queued: [{ id: 'queued-zup', type: 'interactive-index', codebasePath: '/repo/demo-zup-1c' }],
        active: [],
    }), false);
});

test('active indexing cancellation stops managed workers for the cancelled active job', () => {
    assert.equal(shouldStopManagedWorkersAfterCancellation({
        queued: [],
        active: [{ id: 'active-bp', type: 'interactive-index', codebasePath: '/repo/demo-bp30-1c' }],
    }), true);
});
