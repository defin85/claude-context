import { spawn, ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ContextMcpConfig } from './config.js';

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

interface ManagedBgeM3WorkerManagerDeps {
    isSystemdUserAvailable?: () => Promise<boolean>;
    isPortAvailable?: (port: number) => Promise<boolean>;
    readVram?: () => Promise<VramSnapshot | undefined>;
    startWorker?: (config: ContextMcpConfig, port: number) => Promise<ManagedBgeM3Worker | undefined>;
    stopWorker?: (worker: ManagedBgeM3Worker) => Promise<void>;
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
    let startPromise: Promise<string[]> | undefined;
    let stopDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    let idleFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let pressureTimer: ReturnType<typeof setInterval> | undefined;

    const readVramSnapshot = deps.readVram || readVram;
    const checkSystemdUserAvailable = deps.isSystemdUserAvailable || isSystemdUserAvailable;
    const checkPortAvailable = deps.isPortAvailable || isPortAvailable;
    const stopManagedWorker = deps.stopWorker || stopWorker;
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
        if (!config.acceleratorManagedBgeM3Workers || plannedEndpoints.length === 0) {
            return [];
        }
        if (workers.length > 0) {
            return plannedEndpoints;
        }

        console.log(`[MCP] Starting managed BGE-M3 worker(s)${reason ? `: ${reason}` : ''}.`);
        for (const endpoint of plannedEndpoints) {
            const port = Number(new URL(endpoint).port);
            if (!await checkPortAvailable(port)) {
                console.warn(`[MCP] Skipping managed BGE-M3 worker port ${port}: port is already in use.`);
                continue;
            }

            const beforeVram = await readVramSnapshot();
            if (!beforeVram && !config.acceleratorAllowUnmeasuredVram) {
                fallbackReason = 'VRAM metrics unavailable';
                break;
            }
            if (beforeVram && beforeVram.percentUsed >= config.acceleratorVramLimitPercent) {
                fallbackReason = `VRAM usage ${beforeVram.percentUsed.toFixed(1)}% is at or above limit ${config.acceleratorVramLimitPercent}%`;
                break;
            }

            const worker = await startManagedWorker(config, port);
            if (!worker) {
                fallbackReason = fallbackReason || `managed worker on port ${port} failed to start`;
                break;
            }

            const afterVram = await readVramSnapshot();
            if (afterVram && afterVram.percentUsed > config.acceleratorVramLimitPercent) {
                fallbackReason = `VRAM usage ${afterVram.percentUsed.toFixed(1)}% exceeded limit ${config.acceleratorVramLimitPercent}% after worker startup`;
                await stopManagedWorker(worker);
                break;
            }

            workers.push(worker);
            console.log(`[MCP] Managed BGE-M3 worker ready at ${worker.endpoint}${worker.unitName ? ` (${worker.unitName})` : ''}.`);
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

    const existingWorkerCount = 1 + config.bgeM3WorkerEndpoints.length;
    const desiredManagedWorkers = Math.max(0, config.acceleratorMaxBgeM3Workers - existingWorkerCount);
    if (desiredManagedWorkers <= 0) {
        fallbackReason = 'max BGE-M3 workers already satisfied by primary/configured endpoints';
        return manager;
    }

    if (config.acceleratorManagedWorkerLifecycle === 'systemd' && !await checkSystemdUserAvailable()) {
        fallbackReason = 'systemd --user is unavailable';
        return manager;
    }

    for (let index = 0; index < desiredManagedWorkers; index++) {
        const port = config.acceleratorManagedWorkerStartPort + index;
        plannedEndpoints.push(`http://127.0.0.1:${port}`);
    }

    return manager;
}
