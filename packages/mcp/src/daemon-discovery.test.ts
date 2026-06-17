import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDaemonWorkloadSnapshot } from './daemon-discovery.js';
import { WorkloadSnapshot } from './workload-manager.js';

test('daemon workload sanitization preserves active and queued job details', () => {
    const workload: WorkloadSnapshot = {
        mode: 'daemon',
        indexing: {
            maxConcurrency: 1,
            activeCount: 1,
            queuedCount: 2,
            activeJobs: [{
                id: 'active-1',
                type: 'interactive-index',
                codebasePath: '/repo/active',
                priority: 0,
                enqueuedAt: '2026-06-17T10:00:00.000Z',
                startedAt: '2026-06-17T10:00:01.000Z',
            }],
            queuedJobs: [
                {
                    id: 'queued-1',
                    type: 'interactive-index',
                    codebasePath: '/repo/queued-1',
                    priority: 0,
                    enqueuedAt: '2026-06-17T10:00:02.000Z',
                },
                {
                    id: 'queued-2',
                    type: 'background-sync',
                    codebasePath: '/repo/queued-2',
                    priority: 100,
                    enqueuedAt: '2026-06-17T10:00:03.000Z',
                    queuePosition: 7,
                },
            ],
        },
        search: {
            maxConcurrency: 4,
            activeCount: 1,
            queuedCount: 1,
            activeJobs: [{
                id: 'search-active',
                type: 'search',
                codebasePath: '/repo/search',
                priority: 0,
                enqueuedAt: '2026-06-17T10:00:04.000Z',
                startedAt: '2026-06-17T10:00:05.000Z',
            }],
            queuedJobs: [{
                id: 'search-queued',
                type: 'search',
                codebasePath: '/repo/search',
                priority: 0,
                enqueuedAt: '2026-06-17T10:00:06.000Z',
            }],
        },
    };

    assert.deepEqual(sanitizeDaemonWorkloadSnapshot(workload), {
        mode: 'daemon',
        indexing: {
            maxConcurrency: 1,
            activeCount: 1,
            queuedCount: 2,
            activeJobs: [{
                id: 'active-1',
                type: 'interactive-index',
                codebasePath: '/repo/active',
                priority: 0,
                enqueuedAt: '2026-06-17T10:00:00.000Z',
                startedAt: '2026-06-17T10:00:01.000Z',
            }],
            queuedJobs: [
                {
                    id: 'queued-1',
                    type: 'interactive-index',
                    codebasePath: '/repo/queued-1',
                    priority: 0,
                    enqueuedAt: '2026-06-17T10:00:02.000Z',
                    queuePosition: 1,
                },
                {
                    id: 'queued-2',
                    type: 'background-sync',
                    codebasePath: '/repo/queued-2',
                    priority: 100,
                    enqueuedAt: '2026-06-17T10:00:03.000Z',
                    queuePosition: 7,
                },
            ],
        },
        search: {
            maxConcurrency: 4,
            activeCount: 1,
            queuedCount: 1,
            activeJobs: [{
                id: 'search-active',
                type: 'search',
                codebasePath: '/repo/search',
                priority: 0,
                enqueuedAt: '2026-06-17T10:00:04.000Z',
                startedAt: '2026-06-17T10:00:05.000Z',
            }],
            queuedJobs: [{
                id: 'search-queued',
                type: 'search',
                codebasePath: '/repo/search',
                priority: 0,
                enqueuedAt: '2026-06-17T10:00:06.000Z',
                queuePosition: 1,
            }],
        },
    });
});
