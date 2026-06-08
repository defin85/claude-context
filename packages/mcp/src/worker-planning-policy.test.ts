import assert from 'node:assert/strict';
import test from 'node:test';
import type { IndexingAcceleratorSnapshot } from '@zilliz/claude-context-core';
import type { DaemonOperatorStatus } from './daemon-discovery.js';
import {
    createDaemonStatusResult,
    createWorkerPlanningPolicy,
    GET_DAEMON_STATUS_TOOL_DESCRIPTION,
    WORKER_PLANNING_POLICY_TEXT,
} from './worker-planning-policy.js';

function createOperatorStatus(): DaemonOperatorStatus {
    return {
        discovery: null,
        runtimes: [{
            registryPath: '/state/registry/runtime.json',
            runtimeId: 'runtime-1',
            pid: 123,
            endpointUrl: 'http://127.0.0.1:39393/mcp',
            lastUpdated: new Date(0).toISOString(),
            startedAt: new Date(0).toISOString(),
            allowedRoots: ['/repo'],
            runtimeStatusFilePath: '/state/runtime.json',
            snapshotFilePath: '/state/snapshot.json',
            healthy: true,
            knownCodebases: [{ path: '/repo', status: 'indexed' }],
            workload: {
                indexing: {
                    activeCount: 0,
                    queuedCount: 0,
                },
            },
            sync: {
                outcome: 'completed',
                reason: 'idle',
            },
        }],
    };
}

function createAcceleratorSnapshot(): IndexingAcceleratorSnapshot {
    return {
        mode: 'auto',
        active: false,
        fallbackReason: 'background sync acceleration disabled',
        embeddingConcurrency: 1,
        insertConcurrency: 1,
        maxBgeM3Workers: 2,
        vramLimitPercent: 75,
        retryBudget: 1,
        accelerateBackgroundSync: false,
        inFlightEmbeddingBatches: 0,
        inFlightInsertBatches: 0,
        submittedBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        retriedBatches: 0,
        retryReasons: {
            startup: 0,
            health: 0,
            metadata: 0,
            embedding_timeout: 0,
            embedding_error: 0,
            cancellation: 0,
            unknown: 0,
        },
        retrySafeFailures: 0,
        retryUnsafeFailures: 0,
        workerLifecycle: {
            rejected: 0,
            recovered: 0,
            recoveryFailed: 0,
            byReason: {
                startup: 0,
                health: 0,
                metadata: 0,
                embedding_timeout: 0,
                embedding_error: 0,
                cancellation: 0,
                unknown: 0,
            },
        },
        activeWorkers: 2,
        rejectedWorkers: 0,
        workers: [{
            endpoint: 'http://127.0.0.1:8000',
            healthy: true,
            inFlight: 0,
            recoveryAttempts: 0,
            poolState: 'accepted',
        }],
        batches: [],
        scanningMs: 0,
        preIndexActive: false,
        preIndexPhase: 'idle',
        preIndexScanMs: 0,
        preIndexHashMs: 0,
        preIndexFileListMs: 0,
        preIndexTotalMs: 0,
        preIndexSelectedFileCount: 0,
        preIndexHashedFileCount: 0,
        splittingMs: 0,
        embeddingMs: 0,
        insertMs: 0,
    };
}

const managedBgeM3Workers = {
    primaryEndpoint: 'http://127.0.0.1:8000',
    configuredEndpoints: [],
    totalPoolEndpoints: ['http://127.0.0.1:8000', 'http://127.0.0.1:8001'],
    managedEndpoints: ['http://127.0.0.1:8001'],
    plannedEndpoints: ['http://127.0.0.1:8001'],
    runningWorkers: [],
    vramPlanning: {
        profileKey: 'BAAI/bge-m3|full|fp16|cuda|systemd',
        totalMiB: 16311,
        usedBeforeMiB: 3431,
        budgetMiB: 12233,
        freeBudgetMiB: 7778,
        safetyMarginMiB: 1024,
        estimatedWorkerMiB: 2048,
        calibrationSource: 'default' as const,
        managedWorkerLimit: 1,
        plannedWorkers: 1,
        startedWorkers: 1,
    },
};

function getTextContent(result: ReturnType<typeof createDaemonStatusResult>): string {
    const firstContent = result.content[0];
    assert.equal(firstContent.type, 'text');
    assert.equal(typeof firstContent.text, 'string');
    return firstContent.text;
}

test('worker planning policy exposes daemon ownership and worker launch directive', () => {
    const policy = createWorkerPlanningPolicy();

    assert.equal(policy.owner, 'daemon');
    assert.equal(policy.managedWorkerProvider, 'BGE_M3');
    assert.equal(policy.agentDirective, 'submit_indexing_workloads_only');
    assert.equal(policy.doNotStartWorkersDirectly, true);
});

test('worker planning policy exposes canonical status field paths', () => {
    const policy = createWorkerPlanningPolicy();

    assert.equal(policy.statusFields.queue, 'runtimes[].workload');
    assert.equal(policy.statusFields.workers, 'accelerator.workers');
    assert.equal(policy.statusFields.managedWorkers, 'managedBgeM3Workers');
    assert.equal(policy.statusFields.vramPlan, 'managedBgeM3Workers.vramPlanning');
    assert.deepEqual(policy.statusFields.fallbackReasons, [
        'accelerator.fallbackReason',
        'managedBgeM3Workers.fallbackReason',
        'managedBgeM3Workers.vramPlanning.stopReason',
        'runtimes[].sync.reason',
    ]);
});

test('worker planning policy exposes calibration scope and profile key fields', () => {
    const policy = createWorkerPlanningPolicy();

    assert.equal(policy.planningScope, 'host_gpu');
    assert.equal(policy.calibrationScope, 'host_profile');
    assert.deepEqual(policy.profileKeyFields, ['model', 'mode', 'precision', 'device', 'lifecycle']);
    assert.equal(policy.calibrationPath, '~/.context/mcp/bge-m3-worker-vram.json');
});

test('worker planning policy exposes recommended agent flow', () => {
    const policy = createWorkerPlanningPolicy();

    assert.ok(policy.recommendedAgentFlow.includes('call get_daemon_status before indexing'));
    assert.ok(policy.recommendedAgentFlow.includes('call index_codebase for allowed repo paths'));
    assert.ok(policy.recommendedAgentFlow.includes('poll get_indexing_status or get_daemon_status'));
    assert.ok(policy.recommendedAgentFlow.includes('do not start sidecars, child processes, or systemd worker units directly'));
    assert.ok(policy.recommendedAgentFlow.includes('if fallbackReason or stopReason is present, report it instead of overriding daemon policy'));
});

test('daemon status result includes helper policy output and preserves existing status shapes', () => {
    const operatorStatus = createOperatorStatus();
    const accelerator = createAcceleratorSnapshot();
    const result = createDaemonStatusResult(operatorStatus, accelerator, managedBgeM3Workers);

    assert.deepEqual(result.structuredContent.workerPlanningPolicy, createWorkerPlanningPolicy());
    assert.deepEqual(result.structuredContent.discovery, operatorStatus.discovery);
    assert.deepEqual(result.structuredContent.runtimes, operatorStatus.runtimes);
    assert.deepEqual(result.structuredContent.accelerator, accelerator);
    assert.deepEqual(result.structuredContent.managedBgeM3Workers, managedBgeM3Workers);
});

test('daemon status text includes human-readable worker planning directive', () => {
    const result = createDaemonStatusResult(createOperatorStatus(), undefined, undefined);
    const text = getTextContent(result);

    assert.match(text, /Worker planning policy: daemon-owned/);
    assert.match(text, /must submit indexing workloads only/);
    assert.match(text, /must not start BGE-M3 workers directly/);
    assert.equal(text.includes(WORKER_PLANNING_POLICY_TEXT), true);
});

test('worker planning policy payload does not include secret-bearing keys', () => {
    const policy = createWorkerPlanningPolicy();
    const seenKeys = new Set<string>();
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item);
            }
            return;
        }
        if (!value || typeof value !== 'object') {
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            seenKeys.add(key);
            visit(child);
        }
    };

    visit(policy);

    for (const forbiddenKey of ['token', 'bearerToken', 'apiKey', 'password', 'secret', 'commandLine', 'process']) {
        assert.equal(seenKeys.has(forbiddenKey), false);
    }
});

test('daemon status tool description advertises worker planning policy discovery', () => {
    assert.match(GET_DAEMON_STATUS_TOOL_DESCRIPTION, /worker planning policy/);
    assert.match(GET_DAEMON_STATUS_TOOL_DESCRIPTION, /daemon runtime metadata/);
    assert.doesNotMatch(GET_DAEMON_STATUS_TOOL_DESCRIPTION, /start workers directly/i);
});
