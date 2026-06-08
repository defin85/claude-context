import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
        acceleratorInsertQueueCapacity: 2,
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
        acceleratorWorkerVramSafetyMarginMiB: 1024,
        bgeM3SidecarPython: 'python3',
        bgeM3SidecarScript: '/repo/python/bge_m3_sidecar.py',
        bgeM3UseFp16: true,
        ...overrides,
    };
}

async function createTempCalibrationPath(): Promise<string> {
    return path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bge-vram-calibration-')), 'calibration.json');
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

test('managed worker manager plans endpoints at request time without starting workers before requested', async () => {
    let started = 0;
    let stopped = 0;
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 2,
        acceleratorWorkerVramSafetyMarginMiB: 500,
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
        calibrationPath: await createTempCalibrationPath(),
    });

    assert.deepEqual(manager.endpoints, []);
    assert.equal(started, 0);

    await manager.ensureStarted('test');
    assert.deepEqual(manager.endpoints, ['http://127.0.0.1:8001']);
    assert.equal(started, 1);
    assert.equal(manager.workers.length, 1);
    assert.deepEqual(manager.getSnapshot().primaryEndpoint, 'http://127.0.0.1:8000');
    assert.deepEqual(manager.getSnapshot().managedEndpoints, ['http://127.0.0.1:8001']);
    assert.deepEqual(manager.getSnapshot().totalPoolEndpoints, [
        'http://127.0.0.1:8000',
        'http://127.0.0.1:8001',
    ]);

    manager.scheduleStopWhenIdle('test idle', () => true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stopped, 1);
    assert.equal(manager.workers.length, 0);
});

test('managed worker manager keeps running workers when runtime VRAM rises after startup', async () => {
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
        calibrationPath: await createTempCalibrationPath(),
    });

    await manager.ensureStarted('test');
    assert.equal(manager.workers.length, 1);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stopped, 0);
    assert.equal(manager.workers.length, 1);
    assert.equal(manager.getSnapshot().runningWorkers.length, 1);
    assert.doesNotMatch(manager.fallbackReason || '', /runtime VRAM pressure/i);
});

test('managed worker manager uses VRAM budget and primary endpoint capacity when planning workers', async () => {
    let started = 0;
    const vramReadings = [
        { usedMiB: 1000, totalMiB: 10000, percentUsed: 10 },
        { usedMiB: 3000, totalMiB: 10000, percentUsed: 30 },
        { usedMiB: 5000, totalMiB: 10000, percentUsed: 50 },
    ];
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 3,
        acceleratorWorkerVramSafetyMarginMiB: 500,
    }), {
        isSystemdUserAvailable: async () => true,
        isPortAvailable: async () => true,
        readVram: async () => vramReadings.shift() || { usedMiB: 5000, totalMiB: 10000, percentUsed: 50 },
        startWorker: async (_config, port) => {
            started++;
            return { endpoint: `http://127.0.0.1:${port}`, port };
        },
        calibrationPath: path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bge-vram-plan-')), 'calibration.json'),
    });

    await manager.ensureStarted('test');

    assert.equal(started, 2);
    assert.deepEqual(manager.endpoints, ['http://127.0.0.1:8001', 'http://127.0.0.1:8002']);
    assert.equal(manager.getSnapshot().vramPlanning?.managedWorkerLimit, 2);
    assert.equal(manager.getSnapshot().vramPlanning?.startedWorkers, 2);
});

test('managed worker manager fails closed when VRAM metrics are unavailable', async () => {
    let started = 0;
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 3,
        acceleratorAllowUnmeasuredVram: false,
    }), {
        isSystemdUserAvailable: async () => true,
        isPortAvailable: async () => true,
        readVram: async () => undefined,
        startWorker: async (_config, port) => {
            started++;
            return { endpoint: `http://127.0.0.1:${port}`, port };
        },
        calibrationPath: await createTempCalibrationPath(),
    });

    await manager.ensureStarted('test');

    assert.equal(started, 0);
    assert.match(manager.fallbackReason || '', /VRAM metrics unavailable/);
    assert.equal(manager.getSnapshot().vramPlanning?.plannedWorkers, 0);
});

test('managed worker manager reuses matching calibration and persists measured worker deltas', async () => {
    const calibrationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bge-vram-calibration-'));
    const calibrationPath = path.join(calibrationDir, 'calibration.json');
    const profileKey = 'BAAI/bge-m3|full|fp16|default-device|systemd';
    await fs.writeFile(calibrationPath, JSON.stringify({
        formatVersion: 1,
        profiles: {
            [profileKey]: {
                profileKey,
                workerMiB: 5000,
                measuredAt: new Date(0).toISOString(),
                samples: 1,
            },
        },
    }), 'utf-8');
    const vramReadings = [
        { usedMiB: 1000, totalMiB: 10000, percentUsed: 10 },
        { usedMiB: 2600, totalMiB: 10000, percentUsed: 26 },
    ];
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 2,
        acceleratorWorkerVramSafetyMarginMiB: 500,
    }), {
        isSystemdUserAvailable: async () => true,
        isPortAvailable: async () => true,
        readVram: async () => vramReadings.shift() || { usedMiB: 2600, totalMiB: 10000, percentUsed: 26 },
        startWorker: async (_config, port) => ({ endpoint: `http://127.0.0.1:${port}`, port }),
        calibrationPath,
    });

    await manager.ensureStarted('test');

    assert.equal(manager.workers.length, 1);
    assert.equal(manager.getSnapshot().vramPlanning?.calibrationSource, 'measured');
    const persisted = JSON.parse(await fs.readFile(calibrationPath, 'utf-8'));
    assert.equal(persisted.profiles[profileKey].workerMiB, 1600);
    assert.equal(persisted.profiles[profileKey].samples, 2);
});

test('managed worker manager ignores implausibly small calibration values and measured deltas', async () => {
    const calibrationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bge-vram-calibration-'));
    const calibrationPath = path.join(calibrationDir, 'calibration.json');
    const profileKey = 'BAAI/bge-m3|full|fp16|default-device|systemd';
    await fs.writeFile(calibrationPath, JSON.stringify({
        formatVersion: 1,
        profiles: {
            [profileKey]: {
                profileKey,
                workerMiB: 1,
                measuredAt: new Date(0).toISOString(),
                samples: 1,
            },
        },
    }), 'utf-8');
    const vramReadings = [
        { usedMiB: 1000, totalMiB: 10000, percentUsed: 10 },
        { usedMiB: 1001, totalMiB: 10000, percentUsed: 10.01 },
    ];
    const manager = await createManagedBgeM3WorkerManager(createConfig({
        acceleratorMaxBgeM3Workers: 2,
        acceleratorWorkerVramSafetyMarginMiB: 500,
    }), {
        isSystemdUserAvailable: async () => true,
        isPortAvailable: async () => true,
        readVram: async () => vramReadings.shift() || { usedMiB: 1001, totalMiB: 10000, percentUsed: 10.01 },
        startWorker: async (_config, port) => ({ endpoint: `http://127.0.0.1:${port}`, port }),
        calibrationPath,
    });

    await manager.ensureStarted('test');

    assert.equal(manager.workers.length, 1);
    assert.equal(manager.getSnapshot().vramPlanning?.estimatedWorkerMiB, 2048);
    assert.equal(manager.getSnapshot().vramPlanning?.calibrationSource, 'default');
    const persisted = JSON.parse(await fs.readFile(calibrationPath, 'utf-8'));
    assert.equal(persisted.profiles[profileKey].workerMiB, 1);
    assert.equal(persisted.profiles[profileKey].samples, 1);
});
