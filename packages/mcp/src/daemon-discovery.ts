import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getErrorCode, getErrorMessage } from './utils.js';
import type { WorkloadLaneSnapshot, WorkloadSnapshot } from './workload-manager.js';

export const DAEMON_CLIENT_CONFIG_FORMAT_VERSION = 'v1';
export const DAEMON_CLIENT_COMPATIBILITY_VERSION = 1;

export interface DaemonClientConfigFile {
    formatVersion: typeof DAEMON_CLIENT_CONFIG_FORMAT_VERSION;
    compatibilityVersion: number;
    runtimeId: string;
    pid: number;
    serverName: string;
    serverVersion: string;
    host: string;
    port: number;
    endpointPath: string;
    endpointUrl: string;
    transport: 'streamable-http';
    bearerToken: string;
    tokenSha256: string;
    allowedRoots: string[];
    startedAt: string;
    lastUpdated: string;
    runtimeStatusFilePath: string;
    snapshotFilePath: string;
}

interface DaemonClientConfigManagerOptions {
    runtimeId: string;
    serverName: string;
    serverVersion: string;
    compatibilityVersion?: number;
    host: string;
    port: number;
    endpointPath: string;
    allowedRoots: string[];
    bearerToken: string;
    tokenSha256: string;
    runtimeStatusFilePath: string;
    snapshotFilePath: string;
}

interface ReadDaemonClientConfigOptions {
    expectedCompatibilityVersion?: number;
    requireLivePid?: boolean;
}

export interface DaemonRegistryRuntimeSummary {
    registryPath: string;
    runtimeId: string;
    pid: number;
    endpointUrl: string;
    lastUpdated: string;
    startedAt: string;
    allowedRoots: string[];
    runtimeStatusFilePath: string;
    snapshotFilePath: string;
    healthy: boolean;
    statusReason?: string;
    knownCodebases?: Array<{ path: string; status: string }>;
    workload?: WorkloadSnapshot;
    sync?: {
        outcome?: string;
        reason?: string;
    };
}

export interface DaemonOperatorStatus {
    discovery: Omit<DaemonClientConfigFile, 'bearerToken'> | null;
    runtimes: DaemonRegistryRuntimeSummary[];
}

interface DaemonRegistryFile {
    runtimeId: string;
    pid: number;
    endpointUrl: string;
    allowedRoots: string[];
    startedAt: string;
    lastUpdated: string;
    runtimeStatusFilePath: string;
    snapshotFilePath: string;
}

function getDaemonStateRoot(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'daemon');
}

export function getDaemonClientConfigPath(): string {
    return path.join(getDaemonStateRoot(), 'client-config.json');
}

function getDaemonRegistryDirectoryPath(): string {
    return path.join(getDaemonStateRoot(), 'registry');
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (getErrorCode(error) === 'EPERM') {
            return true;
        }
        return false;
    }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
}

function buildDaemonConfigTempPath(filePath: string): string {
    return `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
}

function sanitizeDaemonClientConfig(config: DaemonClientConfigFile | null): Omit<DaemonClientConfigFile, 'bearerToken'> | null {
    if (!config) {
        return null;
    }

    const sanitized: Partial<DaemonClientConfigFile> = { ...config };
    delete sanitized.bearerToken;
    return sanitized as Omit<DaemonClientConfigFile, 'bearerToken'>;
}

function sanitizeWorkloadLaneSnapshot(lane: WorkloadLaneSnapshot | undefined): WorkloadLaneSnapshot | undefined {
    if (!lane) {
        return undefined;
    }

    return {
        maxConcurrency: lane.maxConcurrency,
        activeCount: lane.activeCount,
        queuedCount: lane.queuedCount,
        activeJobs: (lane.activeJobs || []).map((job) => ({ ...job })),
        queuedJobs: (lane.queuedJobs || []).map((job, index) => ({
            ...job,
            queuePosition: job.queuePosition ?? index + 1
        }))
    };
}

export function sanitizeDaemonWorkloadSnapshot(workload: WorkloadSnapshot | undefined): WorkloadSnapshot | undefined {
    if (!workload) {
        return undefined;
    }

    return {
        mode: workload.mode,
        indexing: sanitizeWorkloadLaneSnapshot(workload.indexing) || {
            maxConcurrency: 0,
            activeCount: 0,
            queuedCount: 0,
            activeJobs: [],
            queuedJobs: []
        },
        search: sanitizeWorkloadLaneSnapshot(workload.search) || {
            maxConcurrency: 0,
            activeCount: 0,
            queuedCount: 0,
            activeJobs: [],
            queuedJobs: []
        }
    };
}

export class DaemonClientConfigManager {
    private readonly runtimeId: string;
    private readonly serverName: string;
    private readonly serverVersion: string;
    private readonly compatibilityVersion: number;
    private readonly host: string;
    private readonly port: number;
    private readonly endpointPath: string;
    private allowedRoots: string[];
    private readonly bearerToken: string;
    private readonly tokenSha256: string;
    private readonly runtimeStatusFilePath: string;
    private readonly snapshotFilePath: string;
    private readonly startedAt: string;
    private readonly configFilePath: string;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options: DaemonClientConfigManagerOptions) {
        this.runtimeId = options.runtimeId;
        this.serverName = options.serverName;
        this.serverVersion = options.serverVersion;
        this.compatibilityVersion = options.compatibilityVersion ?? DAEMON_CLIENT_COMPATIBILITY_VERSION;
        this.host = options.host;
        this.port = options.port;
        this.endpointPath = options.endpointPath;
        this.allowedRoots = [...options.allowedRoots];
        this.bearerToken = options.bearerToken;
        this.tokenSha256 = options.tokenSha256;
        this.runtimeStatusFilePath = options.runtimeStatusFilePath;
        this.snapshotFilePath = options.snapshotFilePath;
        this.startedAt = new Date().toISOString();
        this.configFilePath = getDaemonClientConfigPath();
    }

    public getConfigFilePath(): string {
        return this.configFilePath;
    }

    public setAllowedRoots(allowedRoots: string[]): void {
        this.allowedRoots = [...allowedRoots];
    }

    public async refresh(): Promise<void> {
        const payload: DaemonClientConfigFile = {
            formatVersion: DAEMON_CLIENT_CONFIG_FORMAT_VERSION,
            compatibilityVersion: this.compatibilityVersion,
            runtimeId: this.runtimeId,
            pid: process.pid,
            serverName: this.serverName,
            serverVersion: this.serverVersion,
            host: this.host,
            port: this.port,
            endpointPath: this.endpointPath,
            endpointUrl: `http://${this.host}:${this.port}${this.endpointPath}`,
            transport: 'streamable-http',
            bearerToken: this.bearerToken,
            tokenSha256: this.tokenSha256,
            allowedRoots: [...this.allowedRoots],
            startedAt: this.startedAt,
            lastUpdated: new Date().toISOString(),
            runtimeStatusFilePath: this.runtimeStatusFilePath,
            snapshotFilePath: this.snapshotFilePath
        };

        await fs.promises.mkdir(path.dirname(this.configFilePath), { recursive: true, mode: 0o700 });
        const tempPath = buildDaemonConfigTempPath(this.configFilePath);
        await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
        await fs.promises.rename(tempPath, this.configFilePath);
    }

    public startHeartbeat(intervalMs: number = 30_000): void {
        if (this.heartbeatTimer) {
            return;
        }

        this.heartbeatTimer = setInterval(() => {
            void this.refresh().catch((error) => {
                console.error('[DAEMON-DISCOVERY] Failed to refresh daemon client config:', getErrorMessage(error));
            });
        }, intervalMs);
        this.heartbeatTimer.unref?.();
    }

    public stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return;
        }

        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    public async remove(): Promise<void> {
        this.stopHeartbeat();

        try {
            const currentPayload = await readJsonFile<DaemonClientConfigFile>(this.configFilePath);
            if (currentPayload.runtimeId !== this.runtimeId) {
                return;
            }
        } catch (error) {
            if (getErrorCode(error) === 'ENOENT') {
                return;
            }
        }

        try {
            await fs.promises.unlink(this.configFilePath);
        } catch (error) {
            if (getErrorCode(error) !== 'ENOENT') {
                throw error;
            }
        }
    }
}

export async function readDaemonClientConfig(
    options: ReadDaemonClientConfigOptions = {}
): Promise<DaemonClientConfigFile | null> {
    const configPath = getDaemonClientConfigPath();
    let payload: DaemonClientConfigFile;

    try {
        payload = await readJsonFile<DaemonClientConfigFile>(configPath);
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return null;
        }
        throw error;
    }

    if (payload.formatVersion !== DAEMON_CLIENT_CONFIG_FORMAT_VERSION) {
        throw new Error(
            `Unsupported daemon client config format '${payload.formatVersion}'. ` +
            `Expected '${DAEMON_CLIENT_CONFIG_FORMAT_VERSION}'.`
        );
    }

    if (
        typeof options.expectedCompatibilityVersion === 'number'
        && payload.compatibilityVersion !== options.expectedCompatibilityVersion
    ) {
        throw new Error(
            `Daemon compatibility version mismatch. ` +
            `Client expects ${options.expectedCompatibilityVersion}, daemon advertises ${payload.compatibilityVersion}.`
        );
    }

    if (options.requireLivePid !== false && !isPidAlive(payload.pid)) {
        throw new Error(
            `Discovered daemon runtime '${payload.runtimeId}' is not alive anymore (pid ${payload.pid}).`
        );
    }

    return payload;
}

export async function readDaemonOperatorStatus(): Promise<DaemonOperatorStatus> {
    const discovery = sanitizeDaemonClientConfig(
        await readDaemonClientConfig({ requireLivePid: false }).catch(() => null)
    );
    const registryDir = getDaemonRegistryDirectoryPath();
    let entries: string[] = [];

    try {
        entries = await fs.promises.readdir(registryDir);
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            throw error;
        }
    }

    const runtimes: DaemonRegistryRuntimeSummary[] = [];
    for (const entry of entries.sort()) {
        if (!entry.endsWith('.json')) {
            continue;
        }

        const registryPath = path.join(registryDir, entry);
        try {
            const registry = await readJsonFile<DaemonRegistryFile>(registryPath);
            const healthy = isPidAlive(registry.pid);
            let statusReason: string | undefined;
            let knownCodebases: Array<{ path: string; status: string }> | undefined;
            let workload: DaemonRegistryRuntimeSummary['workload'];
            let sync: DaemonRegistryRuntimeSummary['sync'];

            try {
                const runtimeStatus = await readJsonFile<{
                    reason?: string;
                    knownCodebases?: Array<{ path: string; info?: { status?: string } }>;
                    workload?: WorkloadSnapshot;
                    sync?: { outcome?: string; skipReason?: string; errorMessage?: string };
                }>(registry.runtimeStatusFilePath);
                statusReason = runtimeStatus?.reason;
                if (Array.isArray(runtimeStatus?.knownCodebases)) {
                    knownCodebases = runtimeStatus.knownCodebases.map((entry) => ({
                        path: entry.path,
                        status: entry.info?.status || 'unknown'
                    }));
                }
                workload = sanitizeDaemonWorkloadSnapshot(runtimeStatus?.workload);
                sync = runtimeStatus?.sync
                    ? {
                        outcome: runtimeStatus.sync.outcome,
                        reason: runtimeStatus.sync.skipReason || runtimeStatus.sync.errorMessage
                    }
                    : undefined;
            } catch (error) {
                statusReason = `runtime status unavailable: ${getErrorMessage(error)}`;
            }

            runtimes.push({
                registryPath,
                runtimeId: registry.runtimeId,
                pid: registry.pid,
                endpointUrl: registry.endpointUrl,
                lastUpdated: registry.lastUpdated,
                startedAt: registry.startedAt,
                allowedRoots: [...(registry.allowedRoots || [])],
                runtimeStatusFilePath: registry.runtimeStatusFilePath,
                snapshotFilePath: registry.snapshotFilePath,
                healthy,
                statusReason,
                knownCodebases,
                workload,
                sync
            });
        } catch (error) {
            runtimes.push({
                registryPath,
                runtimeId: path.basename(entry, '.json'),
                pid: -1,
                endpointUrl: 'unavailable',
                lastUpdated: 'unavailable',
                startedAt: 'unavailable',
                allowedRoots: [],
                runtimeStatusFilePath: 'unavailable',
                snapshotFilePath: 'unavailable',
                healthy: false,
                statusReason: `registry unreadable: ${getErrorMessage(error)}`
            });
        }
    }

    return {
        discovery,
        runtimes
    };
}
