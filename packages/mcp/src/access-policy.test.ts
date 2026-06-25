import assert from 'node:assert/strict';
import test from 'node:test';
import { CodebaseAccessPolicy } from './access-policy.js';

test('daemon access policy can replace allowed roots at runtime', () => {
    const policy = new CodebaseAccessPolicy({ mode: 'daemon', allowedRoots: ['/repo/a'] });

    assert.equal(policy.evaluateCodebasePath('/repo/b/file.ts').allowed, false);

    policy.setAllowedRoots(['/repo/a', '/repo/b']);

    assert.equal(policy.evaluateCodebasePath('/repo/b/file.ts').allowed, true);
    assert.deepEqual(policy.getAllowedRoots(), ['/repo/a', '/repo/b']);
});
