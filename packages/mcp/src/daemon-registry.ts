import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getErrorCode, getErrorMessage } from './utils.js';

interface DaemonRegistryManagerOptions {
    runtimeId: string;
    host: string;
    port: number;
    endpointPath: string;
    allowedRoots: string[];
    tokenSha256: string;
    runtimeStatusFilePath: string;
    snapshotFilePath: string;
}

interface DaemonRegistryFile {
    formatVersion: 'v1';
    runtimeId: string;
    pid: number;
    host: string;
    port: number;
    endpointPath: string;
    endpointUrl: string;
    transport: 'streamable-http';
    auth: {
        type: 'bearer';
        tokenSha256: string;
    };
    allowedRoots: string[];
    startedAt: string;
    lastUpdated: string;
    runtimeStatusFilePath: string;
    snapshotFilePath: string;
}

export class DaemonRegistryManager {
    private readonly runtimeId: string;
    private readonly host: string;
    private readonly port: number;
    private readonly endpointPath: string;
    private readonly allowedRoots: string[];
    private readonly tokenSha256: string;
    private readonly runtimeStatusFilePath: string;
    private readonly snapshotFilePath: string;
    private readonly registryFilePath: string;
    private readonly startedAt: string;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options: DaemonRegistryManagerOptions) {
        this.runtimeId = options.runtimeId;
        this.host = options.host;
        this.port = options.port;
        this.endpointPath = options.endpointPath;
        this.allowedRoots = [...options.allowedRoots];
        this.tokenSha256 = options.tokenSha256;
        this.runtimeStatusFilePath = options.runtimeStatusFilePath;
        this.snapshotFilePath = options.snapshotFilePath;
        this.startedAt = new Date().toISOString();
        this.registryFilePath = path.join(
            os.homedir(),
            '.context',
            'mcp',
            'daemon',
            'registry',
            `${this.runtimeId}.json`
        );
    }

    public getRegistryFilePath(): string {
        return this.registryFilePath;
    }

    public async refresh(): Promise<void> {
        const payload: DaemonRegistryFile = {
            formatVersion: 'v1',
            runtimeId: this.runtimeId,
            pid: process.pid,
            host: this.host,
            port: this.port,
            endpointPath: this.endpointPath,
            endpointUrl: `http://${this.host}:${this.port}${this.endpointPath}`,
            transport: 'streamable-http',
            auth: {
                type: 'bearer',
                tokenSha256: this.tokenSha256
            },
            allowedRoots: [...this.allowedRoots],
            startedAt: this.startedAt,
            lastUpdated: new Date().toISOString(),
            runtimeStatusFilePath: this.runtimeStatusFilePath,
            snapshotFilePath: this.snapshotFilePath
        };

        await fs.promises.mkdir(path.dirname(this.registryFilePath), { recursive: true });

        const tempPath = `${this.registryFilePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
        await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2));
        await fs.promises.rename(tempPath, this.registryFilePath);
    }

    public startHeartbeat(intervalMs: number = 30_000): void {
        if (this.heartbeatTimer) {
            return;
        }

        this.heartbeatTimer = setInterval(() => {
            void this.refresh().catch((error) => {
                console.error('[DAEMON-REGISTRY] Failed to refresh registry:', getErrorMessage(error));
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
            await fs.promises.unlink(this.registryFilePath);
        } catch (error) {
            if (getErrorCode(error) !== 'ENOENT') {
                throw error;
            }
        }
    }
}
