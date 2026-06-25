import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodebaseInfo } from './config.js';
import { SnapshotManager } from './snapshot.js';
import { McpRuntimeMode } from './access-policy.js';
import { WorkloadSnapshot } from './workload-manager.js';

type RuntimeSyncOutcome = 'idle' | 'running' | 'skipped' | 'completed' | 'failed';

export interface RuntimeSyncCodebaseResult {
    path: string;
    outcome: 'synced' | 'unchanged' | 'skipped' | 'failed';
    reason?: string;
    added?: number;
    removed?: number;
    modified?: number;
    durationMs?: number;
}

interface RuntimeSyncState {
    outcome: RuntimeSyncOutcome;
    lastStartedAt?: string;
    lastFinishedAt?: string;
    skipReason?: string;
    errorMessage?: string;
    totals?: {
        added: number;
        removed: number;
        modified: number;
    };
    codebaseResults?: RuntimeSyncCodebaseResult[];
}

interface RuntimeStatusFile {
    runtimeId: string;
    pid: number;
    mode: McpRuntimeMode;
    workspacePath: string;
    cwd: string;
    nodeVersion: string;
    startedAt: string;
    lastUpdated: string;
    reason: string;
    snapshotFilePath: string;
    daemon?: {
        transport: 'streamable-http';
        host: string;
        port: number;
        endpointPath: string;
        allowedRoots: string[];
        tokenSha256: string;
    };
    workload?: WorkloadSnapshot;
    knownCodebases: Array<{
        path: string;
        info: CodebaseInfo;
    }>;
    sync: RuntimeSyncState;
}

interface RuntimeStatusManagerOptions {
    runtimeId: string;
    workspacePath: string;
    snapshotManager: SnapshotManager;
    mode?: McpRuntimeMode;
    daemon?: {
        host: string;
        port: number;
        endpointPath: string;
        allowedRoots: string[];
        tokenSha256: string;
    };
}

export class RuntimeStatusManager {
    private readonly runtimeId: string;
    private readonly workspacePath: string;
    private readonly snapshotManager: SnapshotManager;
    private readonly mode: McpRuntimeMode;
    private readonly startedAt: string;
    private readonly runtimeStatusFilePath: string;
    private daemonInfo?: {
        host: string;
        port: number;
        endpointPath: string;
        allowedRoots: string[];
        tokenSha256: string;
    };
    private syncState: RuntimeSyncState = { outcome: 'idle' };
    private workloadState?: WorkloadSnapshot;

    constructor(options: RuntimeStatusManagerOptions) {
        this.runtimeId = options.runtimeId;
        this.workspacePath = path.resolve(options.workspacePath);
        this.snapshotManager = options.snapshotManager;
        this.mode = options.mode || 'stdio';
        this.startedAt = new Date().toISOString();
        this.runtimeStatusFilePath = path.join(os.homedir(), '.context', 'mcp', 'runtime', `${process.pid}.json`);
        this.daemonInfo = options.daemon;
    }

    public getRuntimeStatusFilePath(): string {
        return this.runtimeStatusFilePath;
    }

    public setDaemonAllowedRoots(allowedRoots: string[]): void {
        if (this.daemonInfo) {
            this.daemonInfo.allowedRoots = [...allowedRoots];
        }
    }

    public async refresh(reason: string): Promise<void> {
        await this.writeStatus(reason);
    }

    public async markSyncStarted(): Promise<void> {
        this.syncState = {
            outcome: 'running',
            lastStartedAt: new Date().toISOString(),
            lastFinishedAt: this.syncState.lastFinishedAt
        };
        await this.writeStatus('sync-started');
    }

    public async markSyncSkipped(skipReason: string): Promise<void> {
        this.syncState = {
            outcome: 'skipped',
            lastStartedAt: new Date().toISOString(),
            lastFinishedAt: new Date().toISOString(),
            skipReason
        };
        await this.writeStatus('sync-skipped');
    }

    public async markSyncCompleted(
        totals: { added: number; removed: number; modified: number },
        codebaseResults: RuntimeSyncCodebaseResult[]
    ): Promise<void> {
        this.syncState = {
            outcome: 'completed',
            lastStartedAt: this.syncState.lastStartedAt,
            lastFinishedAt: new Date().toISOString(),
            totals,
            codebaseResults
        };
        await this.writeStatus('sync-completed');
    }

    public async markSyncFailed(errorMessage: string, codebaseResults: RuntimeSyncCodebaseResult[] = []): Promise<void> {
        this.syncState = {
            outcome: 'failed',
            lastStartedAt: this.syncState.lastStartedAt,
            lastFinishedAt: new Date().toISOString(),
            errorMessage,
            codebaseResults
        };
        await this.writeStatus('sync-failed');
    }

    public async updateWorkloadState(workloadState: WorkloadSnapshot, reason: string): Promise<void> {
        this.workloadState = workloadState;
        await this.writeStatus(reason);
    }

    private buildStatus(reason: string): RuntimeStatusFile {
        const allCodebaseInfo = this.snapshotManager.getAllCodebaseInfo();
        const knownCodebases = Object.entries(allCodebaseInfo)
            .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
            .map(([codebasePath, info]) => ({
                path: codebasePath,
                info
            }));

        return {
            runtimeId: this.runtimeId,
            pid: process.pid,
            mode: this.mode,
            workspacePath: this.workspacePath,
            cwd: process.cwd(),
            nodeVersion: process.version,
            startedAt: this.startedAt,
            lastUpdated: new Date().toISOString(),
            reason,
            snapshotFilePath: this.snapshotManager.getSnapshotFilePath(),
            ...(this.daemonInfo ? {
                daemon: {
                    transport: 'streamable-http' as const,
                    host: this.daemonInfo.host,
                    port: this.daemonInfo.port,
                    endpointPath: this.daemonInfo.endpointPath,
                    allowedRoots: [...this.daemonInfo.allowedRoots],
                    tokenSha256: this.daemonInfo.tokenSha256
                }
            } : {}),
            ...(this.workloadState ? { workload: this.workloadState } : {}),
            knownCodebases,
            sync: this.syncState
        };
    }

    private async writeStatus(reason: string): Promise<void> {
        const statusDir = path.dirname(this.runtimeStatusFilePath);
        await fs.promises.mkdir(statusDir, { recursive: true });

        const payload = this.buildStatus(reason);
        const tempPath = `${this.runtimeStatusFilePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;

        await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2));
        await fs.promises.rename(tempPath, this.runtimeStatusFilePath);
    }
}
