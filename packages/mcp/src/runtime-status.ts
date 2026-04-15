import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodebaseInfo } from './config.js';
import { SnapshotManager } from './snapshot.js';

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
    workspacePath: string;
    cwd: string;
    nodeVersion: string;
    startedAt: string;
    lastUpdated: string;
    reason: string;
    snapshotFilePath: string;
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
}

export class RuntimeStatusManager {
    private readonly runtimeId: string;
    private readonly workspacePath: string;
    private readonly snapshotManager: SnapshotManager;
    private readonly startedAt: string;
    private readonly runtimeStatusFilePath: string;
    private syncState: RuntimeSyncState = { outcome: 'idle' };

    constructor(options: RuntimeStatusManagerOptions) {
        this.runtimeId = options.runtimeId;
        this.workspacePath = path.resolve(options.workspacePath);
        this.snapshotManager = options.snapshotManager;
        this.startedAt = new Date().toISOString();
        this.runtimeStatusFilePath = path.join(os.homedir(), '.context', 'mcp', 'runtime', `${process.pid}.json`);
    }

    public getRuntimeStatusFilePath(): string {
        return this.runtimeStatusFilePath;
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
            workspacePath: this.workspacePath,
            cwd: process.cwd(),
            nodeVersion: process.version,
            startedAt: this.startedAt,
            lastUpdated: new Date().toISOString(),
            reason,
            snapshotFilePath: this.snapshotManager.getSnapshotFilePath(),
            knownCodebases,
            sync: this.syncState
        };
    }

    private async writeStatus(reason: string): Promise<void> {
        const statusDir = path.dirname(this.runtimeStatusFilePath);
        await fs.promises.mkdir(statusDir, { recursive: true });

        const payload = this.buildStatus(reason);
        const tempPath = `${this.runtimeStatusFilePath}.${process.pid}.${Date.now()}.tmp`;

        await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2));
        await fs.promises.rename(tempPath, this.runtimeStatusFilePath);
    }
}
