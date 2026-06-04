import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSystemdRunArgs, createManagedBgeM3WorkerManager, parseNvidiaSmiMemory } from './bge-m3-managed-workers.js';
import { ContextMcpConfig } from './config.js';

function createConfig(overrides: Partial<ContextMcpConfig> = {}): ContextMcpConfig {
    return {
        name: 'test',
        version: '1.0.0',
        embeddingProvider: 'BGE_M3',
        embeddingModel: 'BAAI/bge-m3',
        bgeM3Endpoint: 'http://127.0.0.1:8000',
        bgeM3WorkerEndpoints: [],
        bgeM3Mode: 'full',
        bgeM3CandidateLimit: 100,
        bgeM3StoreColbert: true,
        acceleratorMode: 'auto',
        acceleratorEmbeddingConcurrency: 2,
        acceleratorInsertConcurrency: 1,
        acceleratorMaxBgeM3Workers: 3,
        acceleratorVramLimitPercent: 75,
        acceleratorRetryBudget: 1,
        acceleratorBackgroundSync: false,
        acceleratorManagedBgeM3Workers: true,
        acceleratorManagedWorkerLifecycle: 'systemd',
        acceleratorManagedWorkerStartPort: 8001,
        acceleratorAllowUnmeasuredVram: false,
        acceleratorWorkerStartTimeoutMs: 1000,
        acceleratorWorkerStopDebounceMs: 10,
        acceleratorWorkerIdleTimeoutMs: 100,
        acceleratorWorkerPressureCheckMs: 1000,
        bgeM3SidecarPython: 'python3',
        bgeM3SidecarScript: '/repo/python/bge_m3_sidecar.py',
        bgeM3UseFp16: true,
        ...overrides,
    };
}

test('parseNvidiaSmiMemory parses first GPU memory usage', () => {
    assert.deepEqual(parseNvidiaSmiMemory('12000, 24564\n100, 200\n'), {
        usedMiB: 12000,
        totalMiB: 24564,
        percentUsed: 12000 / 24564 * 100,
    });
    assert.equal(parseNvidiaSmiMemory(''), undefined);
    assert.equal(parseNvidiaSmiMemory('bad'), undefined);
});

test('buildSystemdRunArgs creates a transient user service command without secrets', () => {
    const args = buildSystemdRunArgs(createConfig({
        bgeM3Device: 'cuda',
        bgeM3UseFp16: false,
    }), 8001, 'claude-context-bge-m3-worker-8001.service');

    assert.deepEqual(args.slice(0, 8), [
        '--user',
        '--unit',
        'claude-context-bge-m3-worker-8001.service',
        '--collect',
        '--property',
        'Restart=no',
        '--setenv',
        'BGE_M3_MODEL=BAAI/bge-m3',
    ]);
    assert.ok(args.includes('BGE_M3_DEVICE=cuda'));
    assert.ok(args.includes('/repo/python/bge_m3_sidecar.py'));
    assert.ok(args.includes('--no-fp16'));
    assert.ok(args.includes('--device'));
    assert.ok(args.includes('cuda'));
    assert.equal(args.includes('MILVUS_TOKEN'), false);
});

test('managed worker manager exposes planned endpoints without starting workers until requested', async () => {
    let started = 0;
    let stopped = 0;
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 2,
    }), {
        isSystemdUserAvailable: async () => true,
        isPortAvailable: async () => true,
        readVram: async () => ({ usedMiB: 1000, totalMiB: 10000, percentUsed: 10 }),
        startWorker: async (_config, port) => {
            started++;
            return { endpoint: `http://127.0.0.1:${port}`, port, unitName: `worker-${port}.service` };
        },
        stopWorker: async () => {
            stopped++;
        },
    });

    assert.deepEqual(manager.endpoints, ['http://127.0.0.1:8001']);
    assert.equal(started, 0);

    await manager.ensureStarted('test');
    assert.equal(started, 1);
    assert.equal(manager.workers.length, 1);

    manager.scheduleStopWhenIdle('test idle', () => true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stopped, 1);
    assert.equal(manager.workers.length, 0);
});

test('managed worker manager retires workers when runtime VRAM pressure exceeds the configured limit', async () => {
    let reads = 0;
    let stopped = 0;
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 2,
        acceleratorWorkerPressureCheckMs: 10,
    }), {
        isSystemdUserAvailable: async () => true,
        isPortAvailable: async () => true,
        readVram: async () => {
            reads++;
            return reads <= 2
                ? { usedMiB: 1000, totalMiB: 10000, percentUsed: 10 }
                : { usedMiB: 9000, totalMiB: 10000, percentUsed: 90 };
        },
        startWorker: async (_config, port) => ({ endpoint: `http://127.0.0.1:${port}`, port }),
        stopWorker: async () => {
            stopped++;
        },
    });

    await manager.ensureStarted('test');
    assert.equal(manager.workers.length, 1);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stopped, 1);
    assert.equal(manager.workers.length, 0);
    assert.match(manager.fallbackReason || '', /exceeded limit/);
});
