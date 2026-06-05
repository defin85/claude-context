import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ContextMcpConfig } from './config.js';

const DEFAULT_BGE_M3_WORKER_VRAM_ESTIMATE_MIB = 2048;
const MIN_VALID_BGE_M3_WORKER_VRAM_DELTA_MIB = 256;
const CALIBRATION_CACHE_PATH = path.join(os.homedir(), '.context', 'mcp', 'bge-m3-worker-vram.json');

export interface ManagedBgeM3Worker {
    endpoint: string;
    port: number;
    unitName?: string;
    process?: ChildProcess;
}

export interface ManagedBgeM3WorkerManager {
    endpoints: string[];
    fallbackReason?: string;
    workers: ManagedBgeM3Worker[];
    getSnapshot(): {
        primaryEndpoint?: string;
        configuredEndpoints: string[];
        totalPoolEndpoints: string[];
        managedEndpoints: string[];
        plannedEndpoints: string[];
        runningWorkers: Array<{ endpoint: string; port: number; unitName?: string; lifecycle: 'systemd' | 'child' }>;
        fallbackReason?: string;
        vramPlanning?: VramWorkerPlanningSnapshot;
    };
    ensureStarted(reason?: string): Promise<string[]>;
    scheduleStopWhenIdle(reason: string, isIdle: () => boolean): void;
    cancelScheduledStop(): void;
    stopAll(reason?: string): Promise<void>;
}

interface CommandResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

interface VramSnapshot {
    usedMiB: number;
    totalMiB: number;
    percentUsed: number;
}

export type VramCalibrationSource = 'cache' | 'default' | 'measured' | 'unmeasured';

export interface VramWorkerPlanningSnapshot {
    profileKey: string;
    totalMiB?: number;
    usedBeforeMiB?: number;
    budgetMiB?: number;
    freeBudgetMiB?: number;
    safetyMarginMiB: number;
    estimatedWorkerMiB: number;
    calibrationSource: VramCalibrationSource;
    managedWorkerLimit: number;
    plannedWorkers: number;
    startedWorkers: number;
    stopReason?: string;
}

interface VramCalibrationEntry {
    profileKey: string;
    workerMiB: number;
    measuredAt: string;
    samples: number;
}

interface VramCalibrationCache {
    formatVersion: 1;
    profiles: Record<string, VramCalibrationEntry>;
}

interface ManagedBgeM3WorkerManagerDeps {
    isSystemdUserAvailable?: () => Promise<boolean>;
    isPortAvailable?: (port: number) => Promise<boolean>;
    readVram?: () => Promise<VramSnapshot | undefined>;
    startWorker?: (config: ContextMcpConfig, port: number) => Promise<ManagedBgeM3Worker | undefined>;
    stopWorker?: (worker: ManagedBgeM3Worker) => Promise<void>;
    calibrationPath?: string;
}

function runCommand(command: string, args: string[], timeoutMs: number = 30000): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({
                exitCode: 1,
                stdout,
                stderr: error.message,
            });
        });
        child.on('close', (exitCode) => {
            clearTimeout(timer);
            resolve({ exitCode, stdout, stderr });
        });
    });
}

export function parseNvidiaSmiMemory(output: string): VramSnapshot | undefined {
    const firstLine = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)[0];
    if (!firstLine) {
        return undefined;
    }

    const [usedRaw, totalRaw] = firstLine.split(',').map((item) => Number.parseInt(item.trim(), 10));
    if (!Number.isFinite(usedRaw) || !Number.isFinite(totalRaw) || totalRaw <= 0) {
        return undefined;
    }

    return {
        usedMiB: usedRaw,
        totalMiB: totalRaw,
        percentUsed: (usedRaw / totalRaw) * 100,
    };
}

async function readVram(): Promise<VramSnapshot | undefined> {
    const result = await runCommand('nvidia-smi', [
        '--query-gpu=memory.used,memory.total',
        '--format=csv,noheader,nounits',
    ], 10000);

    if (result.exitCode !== 0) {
        return undefined;
    }

    return parseNvidiaSmiMemory(result.stdout);
}

function createWorkerProfileKey(config: ContextMcpConfig): string {
    return [
        config.embeddingModel,
        config.bgeM3Mode,
        config.bgeM3UseFp16 ? 'fp16' : 'fp32',
        config.bgeM3Device || 'default-device',
        config.acceleratorManagedWorkerLifecycle,
    ].join('|');
}

async function loadCalibrationCache(cachePath: string): Promise<VramCalibrationCache> {
    try {
        const raw = await fs.readFile(cachePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<VramCalibrationCache>;
        if (parsed.formatVersion !== 1 || !parsed.profiles || typeof parsed.profiles !== 'object') {
            return { formatVersion: 1, profiles: {} };
        }
        return {
            formatVersion: 1,
            profiles: parsed.profiles,
        };
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
            return { formatVersion: 1, profiles: {} };
        }
        console.warn(`[MCP] Failed to load BGE-M3 worker VRAM calibration: ${error instanceof Error ? error.message : String(error)}`);
        return { formatVersion: 1, profiles: {} };
    }
}

async function saveCalibrationCache(cachePath: string, cache: VramCalibrationCache): Promise<void> {
    try {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
    } catch (error) {
        console.warn(`[MCP] Failed to save BGE-M3 worker VRAM calibration: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function getCalibratedEstimate(cache: VramCalibrationCache, profileKey: string): {
    workerMiB: number;
    source: VramCalibrationSource;
} {
    const entry = cache.profiles[profileKey];
    if (entry && Number.isFinite(entry.workerMiB) && entry.workerMiB >= MIN_VALID_BGE_M3_WORKER_VRAM_DELTA_MIB) {
        return {
            workerMiB: Math.ceil(entry.workerMiB),
            source: 'cache',
        };
    }

    return {
        workerMiB: DEFAULT_BGE_M3_WORKER_VRAM_ESTIMATE_MIB,
        source: 'default',
    };
}

function updateCalibration(cache: VramCalibrationCache, profileKey: string, measuredWorkerMiB: number): boolean {
    if (!Number.isFinite(measuredWorkerMiB) || measuredWorkerMiB < MIN_VALID_BGE_M3_WORKER_VRAM_DELTA_MIB) {
        return false;
    }
    const rounded = Math.ceil(measuredWorkerMiB);
    const existing = cache.profiles[profileKey];
    cache.profiles[profileKey] = {
        profileKey,
        workerMiB: rounded,
        measuredAt: new Date().toISOString(),
        samples: (existing?.samples || 0) + 1,
    };
    return true;
}

async function isSystemdUserAvailable(): Promise<boolean> {
    const result = await runCommand('systemctl', ['--user', 'is-system-running'], 10000);
    return result.exitCode === 0 || result.stdout.trim() === 'degraded';
}

async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

async function waitForHealth(endpoint: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${endpoint}/health`);
            if (response.ok) {
                return true;
            }
        } catch {
            // Worker is still starting.
        }
        await delay(1000);
    }
    return false;
}

export function buildSystemdRunArgs(config: ContextMcpConfig, port: number, unitName: string): string[] {
    const args = [
        '--user',
        '--unit',
        unitName,
        '--collect',
        '--property',
        'Restart=no',
        '--setenv',
        `BGE_M3_MODEL=${config.embeddingModel}`,
        '--setenv',
        `BGE_M3_MODE=${config.bgeM3Mode}`,
        '--setenv',
        `BGE_M3_USE_FP16=${config.bgeM3UseFp16 ? 'true' : 'false'}`,
    ];

    if (config.bgeM3Device) {
        args.push('--setenv', `BGE_M3_DEVICE=${config.bgeM3Device}`);
    }

    args.push(
        config.bgeM3SidecarPython,
        config.bgeM3SidecarScript,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--model',
        config.embeddingModel,
        '--mode',
        config.bgeM3Mode,
    );

    if (!config.bgeM3UseFp16) {
        args.push('--no-fp16');
    }

    if (config.bgeM3Device) {
        args.push('--device', config.bgeM3Device);
    }

    return args;
}

async function stopSystemdUnit(unitName: string): Promise<void> {
    await runCommand('systemctl', ['--user', 'stop', unitName], 30000);
}

async function startSystemdWorker(config: ContextMcpConfig, port: number): Promise<ManagedBgeM3Worker | undefined> {
    const unitName = `claude-context-bge-m3-worker-${port}.service`;
    const result = await runCommand('systemd-run', buildSystemdRunArgs(config, port, unitName), 30000);
    if (result.exitCode !== 0) {
        console.warn(`[MCP] Failed to start managed BGE-M3 worker ${unitName}: ${result.stderr || result.stdout}`);
        return undefined;
    }

    const endpoint = `http://127.0.0.1:${port}`;
    if (!await waitForHealth(endpoint, config.acceleratorWorkerStartTimeoutMs)) {
        console.warn(`[MCP] Managed BGE-M3 worker ${unitName} did not become healthy before timeout.`);
        await stopSystemdUnit(unitName);
        return undefined;
    }

    return { endpoint, port, unitName };
}

async function startChildWorker(config: ContextMcpConfig, port: number): Promise<ManagedBgeM3Worker | undefined> {
    const args = [
        config.bgeM3SidecarScript,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--model',
        config.embeddingModel,
        '--mode',
        config.bgeM3Mode,
        ...(config.bgeM3UseFp16 ? [] : ['--no-fp16']),
        ...(config.bgeM3Device ? ['--device', config.bgeM3Device] : []),
    ];
    const child = spawn(config.bgeM3SidecarPython, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
            ...process.env,
            BGE_M3_MODEL: config.embeddingModel,
            BGE_M3_MODE: config.bgeM3Mode,
            BGE_M3_USE_FP16: config.bgeM3UseFp16 ? 'true' : 'false',
            ...(config.bgeM3Device ? { BGE_M3_DEVICE: config.bgeM3Device } : {}),
        },
    });
    child.stderr?.on('data', (chunk) => {
        console.warn(`[MCP] managed BGE-M3 child worker ${port}: ${chunk.toString().trim()}`);
    });

    const endpoint = `http://127.0.0.1:${port}`;
    if (!await waitForHealth(endpoint, config.acceleratorWorkerStartTimeoutMs)) {
        console.warn(`[MCP] Managed BGE-M3 child worker on port ${port} did not become healthy before timeout.`);
        child.kill('SIGTERM');
        return undefined;
    }

    return { endpoint, port, process: child };
}

async function stopWorker(worker: ManagedBgeM3Worker): Promise<void> {
    if (worker.unitName) {
        await stopSystemdUnit(worker.unitName);
    }
    if (worker.process && !worker.process.killed) {
        worker.process.kill('SIGTERM');
    }
}

export async function createManagedBgeM3WorkerManager(
    config: ContextMcpConfig,
    deps: ManagedBgeM3WorkerManagerDeps = {}
): Promise<ManagedBgeM3WorkerManager> {
    const workers: ManagedBgeM3Worker[] = [];
    const plannedEndpoints: string[] = [];
    let fallbackReason: string | undefined;
    let vramPlanning: VramWorkerPlanningSnapshot | undefined;
    let startPromise: Promise<string[]> | undefined;
    let stopDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    let idleFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let pressureTimer: ReturnType<typeof setInterval> | undefined;

    const readVramSnapshot = deps.readVram || readVram;
    const checkSystemdUserAvailable = deps.isSystemdUserAvailable || isSystemdUserAvailable;
    const checkPortAvailable = deps.isPortAvailable || isPortAvailable;
    const stopManagedWorker = deps.stopWorker || stopWorker;
    const calibrationPath = deps.calibrationPath || CALIBRATION_CACHE_PATH;
    const startManagedWorker = deps.startWorker || (async (workerConfig, port) => workerConfig.acceleratorManagedWorkerLifecycle === 'systemd'
        ? startSystemdWorker(workerConfig, port)
        : startChildWorker(workerConfig, port));

    const clearStopTimers = () => {
        if (stopDebounceTimer) {
            clearTimeout(stopDebounceTimer);
            stopDebounceTimer = undefined;
        }
        if (idleFallbackTimer) {
            clearTimeout(idleFallbackTimer);
            idleFallbackTimer = undefined;
        }
    };

    const clearPressureTimer = () => {
        if (pressureTimer) {
            clearInterval(pressureTimer);
            pressureTimer = undefined;
        }
    };

    const startPressureMonitor = () => {
        clearPressureTimer();
        if (workers.length === 0) {
            return;
        }

        pressureTimer = setInterval(() => {
            void (async () => {
                const pressure = await readVramSnapshot();
                if (!pressure) {
                    return;
                }
                if (pressure.percentUsed <= config.acceleratorVramLimitPercent) {
                    return;
                }

                fallbackReason = `Runtime VRAM usage ${pressure.percentUsed.toFixed(1)}% exceeded limit ${config.acceleratorVramLimitPercent}%`;
                await manager.stopAll('runtime VRAM pressure exceeded');
            })().catch((error) => {
                console.warn(`[MCP] Failed to check managed BGE-M3 worker runtime pressure: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, config.acceleratorWorkerPressureCheckMs);
        pressureTimer.unref?.();
    };

    const startPlannedWorkers = async (reason?: string): Promise<string[]> => {
        if (!config.acceleratorManagedBgeM3Workers) {
            return [];
        }
        if (workers.length > 0) {
            return plannedEndpoints;
        }

        plannedEndpoints.length = 0;
        const profileKey = createWorkerProfileKey(config);
        const managedWorkerLimit = Math.max(
            0,
            config.acceleratorMaxBgeM3Workers - 1 - config.bgeM3WorkerEndpoints.length,
        );
        if (managedWorkerLimit <= 0) {
            fallbackReason = 'max BGE-M3 workers already satisfied by primary/configured endpoints';
            vramPlanning = {
                profileKey,
                safetyMarginMiB: config.acceleratorWorkerVramSafetyMarginMiB,
                estimatedWorkerMiB: DEFAULT_BGE_M3_WORKER_VRAM_ESTIMATE_MIB,
                calibrationSource: 'default',
                managedWorkerLimit,
                plannedWorkers: 0,
                startedWorkers: 0,
                stopReason: fallbackReason,
            };
            return [];
        }

        const calibration = await loadCalibrationCache(calibrationPath);
        let estimate = getCalibratedEstimate(calibration, profileKey);
        let beforeVram = await readVramSnapshot();
        if (!beforeVram && !config.acceleratorAllowUnmeasuredVram) {
            fallbackReason = 'VRAM metrics unavailable';
            vramPlanning = {
                profileKey,
                safetyMarginMiB: config.acceleratorWorkerVramSafetyMarginMiB,
                estimatedWorkerMiB: estimate.workerMiB,
                calibrationSource: estimate.source,
                managedWorkerLimit,
                plannedWorkers: 0,
                startedWorkers: 0,
                stopReason: fallbackReason,
            };
            return [];
        }

        let budgetMiB = beforeVram
            ? Math.floor(beforeVram.totalMiB * config.acceleratorVramLimitPercent / 100)
            : undefined;
        let freeBudgetMiB = beforeVram
            ? budgetMiB! - beforeVram.usedMiB - config.acceleratorWorkerVramSafetyMarginMiB
            : undefined;
        let plannedWorkers = beforeVram
            ? Math.max(0, Math.min(managedWorkerLimit, Math.floor((freeBudgetMiB || 0) / estimate.workerMiB)))
            : managedWorkerLimit;

        vramPlanning = {
            profileKey,
            totalMiB: beforeVram?.totalMiB,
            usedBeforeMiB: beforeVram?.usedMiB,
            budgetMiB,
            freeBudgetMiB,
            safetyMarginMiB: config.acceleratorWorkerVramSafetyMarginMiB,
            estimatedWorkerMiB: estimate.workerMiB,
            calibrationSource: beforeVram ? estimate.source : 'unmeasured',
            managedWorkerLimit,
            plannedWorkers,
            startedWorkers: 0,
        };

        if (beforeVram && beforeVram.percentUsed >= config.acceleratorVramLimitPercent) {
            fallbackReason = `VRAM usage ${beforeVram.percentUsed.toFixed(1)}% is at or above limit ${config.acceleratorVramLimitPercent}%`;
            vramPlanning.stopReason = fallbackReason;
            vramPlanning.plannedWorkers = 0;
            return [];
        }

        if (plannedWorkers <= 0) {
            fallbackReason = beforeVram
                ? `VRAM budget cannot fit an estimated ${estimate.workerMiB}MiB worker after ${config.acceleratorWorkerVramSafetyMarginMiB}MiB safety margin`
                : undefined;
            vramPlanning.stopReason = fallbackReason;
            console.log(`[MCP] Managed BGE-M3 worker planner selected 0 workers${fallbackReason ? `: ${fallbackReason}` : ''}.`);
            return [];
        }

        console.log(
            `[MCP] Starting up to ${plannedWorkers} managed BGE-M3 worker(s)${reason ? `: ${reason}` : ''}. ` +
            `VRAM budget=${budgetMiB ?? 'unmeasured'}MiB used=${beforeVram?.usedMiB ?? 'unmeasured'}MiB ` +
            `estimate=${estimate.workerMiB}MiB safety=${config.acceleratorWorkerVramSafetyMarginMiB}MiB source=${estimate.source}.`,
        );

        for (let index = 0; index < plannedWorkers && workers.length < managedWorkerLimit; index++) {
            const port = config.acceleratorManagedWorkerStartPort + index;
            const endpoint = `http://127.0.0.1:${port}`;
            if (!await checkPortAvailable(port)) {
                console.warn(`[MCP] Skipping managed BGE-M3 worker port ${port}: port is already in use.`);
                continue;
            }

            if (beforeVram) {
                budgetMiB = Math.floor(beforeVram.totalMiB * config.acceleratorVramLimitPercent / 100);
                freeBudgetMiB = budgetMiB - beforeVram.usedMiB - config.acceleratorWorkerVramSafetyMarginMiB;
                if (beforeVram.percentUsed >= config.acceleratorVramLimitPercent || freeBudgetMiB < estimate.workerMiB) {
                    fallbackReason = `VRAM budget cannot fit another estimated ${estimate.workerMiB}MiB worker`;
                    vramPlanning.stopReason = fallbackReason;
                    break;
                }
            }

            const workerVramBefore = beforeVram;
            const worker = await startManagedWorker(config, port);
            if (!worker) {
                fallbackReason = fallbackReason || `managed worker on port ${port} failed to start`;
                vramPlanning.stopReason = fallbackReason;
                break;
            }

            const afterVram = await readVramSnapshot();
            if (!afterVram && !config.acceleratorAllowUnmeasuredVram) {
                fallbackReason = 'VRAM metrics unavailable after worker startup';
                vramPlanning.stopReason = fallbackReason;
                await stopManagedWorker(worker);
                break;
            }

            if (afterVram && afterVram.percentUsed > config.acceleratorVramLimitPercent) {
                fallbackReason = `VRAM usage ${afterVram.percentUsed.toFixed(1)}% exceeded limit ${config.acceleratorVramLimitPercent}% after worker startup`;
                vramPlanning.stopReason = fallbackReason;
                await stopManagedWorker(worker);
                break;
            }

            workers.push(worker);
            plannedEndpoints.push(worker.endpoint);
            vramPlanning.startedWorkers = workers.length;
            console.log(`[MCP] Managed BGE-M3 worker ready at ${worker.endpoint}${worker.unitName ? ` (${worker.unitName})` : ''}.`);

            if (workerVramBefore && afterVram) {
                const measuredWorkerMiB = Math.max(1, afterVram.usedMiB - workerVramBefore.usedMiB);
                if (updateCalibration(calibration, profileKey, measuredWorkerMiB)) {
                    await saveCalibrationCache(calibrationPath, calibration);
                    estimate = {
                        workerMiB: Math.ceil(measuredWorkerMiB),
                        source: 'measured',
                    };
                } else {
                    console.warn(
                        `[MCP] Ignoring implausibly small BGE-M3 worker VRAM delta (${measuredWorkerMiB}MiB); ` +
                        `keeping ${estimate.source} estimate ${estimate.workerMiB}MiB.`,
                    );
                }
                beforeVram = afterVram;
                budgetMiB = Math.floor(afterVram.totalMiB * config.acceleratorVramLimitPercent / 100);
                freeBudgetMiB = budgetMiB - afterVram.usedMiB - config.acceleratorWorkerVramSafetyMarginMiB;
                const remainingCapacity = managedWorkerLimit - workers.length;
                const additionalWorkers = Math.max(0, Math.min(remainingCapacity, Math.floor(freeBudgetMiB / estimate.workerMiB)));
                plannedWorkers = workers.length + additionalWorkers;
                vramPlanning.totalMiB = afterVram.totalMiB;
                vramPlanning.budgetMiB = budgetMiB;
                vramPlanning.freeBudgetMiB = freeBudgetMiB;
                vramPlanning.estimatedWorkerMiB = Math.ceil(estimate.workerMiB);
                vramPlanning.calibrationSource = estimate.source;
                vramPlanning.plannedWorkers = Math.max(vramPlanning.plannedWorkers, plannedWorkers);
            }
        }

        startPressureMonitor();
        return plannedEndpoints;
    };

    const manager: ManagedBgeM3WorkerManager = {
        endpoints: plannedEndpoints,
        workers,
        get fallbackReason() {
            return fallbackReason;
        },
        getSnapshot() {
            const configuredEndpoints = [...new Set(config.bgeM3WorkerEndpoints)];
            const managedEndpoints = [...plannedEndpoints];
            return {
                primaryEndpoint: config.bgeM3Endpoint,
                configuredEndpoints,
                totalPoolEndpoints: [
                    ...new Set([
                        config.bgeM3Endpoint,
                        ...configuredEndpoints,
                        ...managedEndpoints,
                    ].filter((endpoint): endpoint is string => Boolean(endpoint))),
                ],
                managedEndpoints,
                plannedEndpoints: managedEndpoints,
                runningWorkers: workers.map((worker) => ({
                    endpoint: worker.endpoint,
                    port: worker.port,
                    unitName: worker.unitName,
                    lifecycle: config.acceleratorManagedWorkerLifecycle,
                })),
                fallbackReason,
                vramPlanning: vramPlanning ? { ...vramPlanning } : undefined,
            };
        },
        async ensureStarted(reason?: string): Promise<string[]> {
            clearStopTimers();
            if (!startPromise) {
                startPromise = startPlannedWorkers(reason).finally(() => {
                    startPromise = undefined;
                });
            }
            return startPromise;
        },
        scheduleStopWhenIdle(reason: string, isIdle: () => boolean): void {
            if (workers.length === 0) {
                return;
            }
            clearStopTimers();
            const stopIfIdle = () => {
                if (!isIdle()) {
                    return;
                }
                void manager.stopAll(reason).catch((error) => {
                    console.warn(`[MCP] Failed to stop idle managed BGE-M3 workers: ${error instanceof Error ? error.message : String(error)}`);
                });
            };
            stopDebounceTimer = setTimeout(stopIfIdle, config.acceleratorWorkerStopDebounceMs);
            idleFallbackTimer = setTimeout(stopIfIdle, config.acceleratorWorkerIdleTimeoutMs);
        },
        cancelScheduledStop(): void {
            clearStopTimers();
        },
        async stopAll(reason?: string): Promise<void> {
            clearStopTimers();
            clearPressureTimer();
            if (workers.length === 0) {
                return;
            }
            console.log(`[MCP] Stopping ${workers.length} managed BGE-M3 worker(s)${reason ? `: ${reason}` : ''}.`);
            await Promise.allSettled(workers.map(stopManagedWorker));
            workers.length = 0;
        },
    };

    if (!config.acceleratorManagedBgeM3Workers) {
        return manager;
    }
    if (config.embeddingProvider !== 'BGE_M3' || config.bgeM3Mode !== 'full') {
        fallbackReason = 'managed workers require BGE-M3 full mode';
        return manager;
    }
    if (config.acceleratorMode !== 'auto') {
        fallbackReason = 'accelerator mode is not auto';
        return manager;
    }

    if (config.acceleratorManagedWorkerLifecycle === 'systemd' && !await checkSystemdUserAvailable()) {
        fallbackReason = 'systemd --user is unavailable';
        return manager;
    }

    return manager;
}
