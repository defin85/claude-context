import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {
    CodebaseSnapshot,
    CodebaseSnapshotV1,
    CodebaseSnapshotV2,
    CodebaseInfo,
    CodebaseInfoIndexing,
    CodebaseInfoIndexed,
    CodebaseInfoIndexFailed,
    IndexingOwnerInfo,
    IndexingProgressDetails
} from "./config.js";
import {
    getErrorCode,
    getErrorMessage,
    normalizeCodebasePath as normalizeTrackedCodebasePath
} from "./utils.js";

type SnapshotScope = 'workspace' | 'global' | 'daemon';

interface SnapshotManagerOptions {
    workspacePath?: string;
    scope?: SnapshotScope;
    saveDebounceMs?: number;
    runtimeId?: string;
    clientSessionId?: string;
}

type SnapshotSourceFormat = 'none' | 'v1' | 'v2' | 'corrupt';

interface SnapshotReadResult {
    snapshot: CodebaseSnapshotV2 | null;
    sourceFormat: SnapshotSourceFormat;
}

interface SnapshotMutationResult<T> {
    result: T;
    changed: boolean;
}

export interface IndexingOwnershipClaimResult {
    acquired: boolean;
    reason: 'claimed' | 'already-owned' | 'reclaimed-stale-owner' | 'blocked-live-owner';
    currentOwner?: IndexingOwnerInfo;
    previousInfo?: CodebaseInfo;
}

export interface IndexingOwnershipInspectionResult {
    state: 'not-indexing' | 'owned-by-current-runtime' | 'blocked-live-owner' | 'stale-owner';
    currentOwner?: IndexingOwnerInfo;
    info?: CodebaseInfo;
    staleReason?: string;
}

export class SnapshotManager {
    private snapshotFilePath: string;
    private lockFilePath: string;
    private legacySnapshotFilePath: string;
    private scope: SnapshotScope;
    private workspacePath: string;
    private indexedCodebases: string[] = [];
    private indexingCodebases: Map<string, number> = new Map(); // Map of codebase path to progress percentage
    private codebaseFileCount: Map<string, number> = new Map(); // Map of codebase path to indexed file count
    private codebaseInfoMap: Map<string, CodebaseInfo> = new Map(); // Map of codebase path to complete info
    private pendingDeletes: Map<string, string> = new Map(); // Durable delete tombstones keyed by normalized codebase path
    private readonly lockAcquireTimeoutMs: number;
    private readonly lockRetryIntervalMs: number;
    private readonly lockRetryJitterMs: number;
    private readonly lockStaleMs: number;
    private readonly saveDebounceMs: number;
    private readonly runtimeId: string;
    private readonly clientSessionId?: string;
    private readonly ownerStaleMs: number;
    private readonly ownerHeartbeatIntervalMs: number;
    private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingSaveReason: string | null = null;
    private saveQueue: Promise<unknown> = Promise.resolve();
    private lockWaitMsTotal = 0;
    private lockRetryCountTotal = 0;
    private lockTimeoutCount = 0;

    constructor(options: SnapshotManagerOptions = {}) {
        this.workspacePath = path.resolve(options.workspacePath || process.cwd());
        this.scope = options.scope || this.resolveSnapshotScope();
        this.lockAcquireTimeoutMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_TIMEOUT_MS, 15000);
        this.lockRetryIntervalMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_RETRY_MS, 50);
        this.lockRetryJitterMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_JITTER_MS, 40);
        this.lockStaleMs = this.parsePositiveNumber(process.env.MCP_SNAPSHOT_LOCK_STALE_MS, 120000);
        this.saveDebounceMs = this.parsePositiveNumber(
            process.env.MCP_SNAPSHOT_SAVE_DEBOUNCE_MS,
            options.saveDebounceMs ?? 2000
        );
        this.runtimeId = options.runtimeId || crypto.randomUUID();
        this.clientSessionId = options.clientSessionId;
        this.ownerStaleMs = this.parsePositiveNumber(process.env.MCP_INDEXING_OWNER_STALE_MS, 5 * 60 * 1000);
        this.ownerHeartbeatIntervalMs = this.parsePositiveNumber(process.env.MCP_INDEXING_OWNER_HEARTBEAT_MS, 30 * 1000);
        this.legacySnapshotFilePath = path.join(os.homedir(), '.context', 'mcp-codebase-snapshot.json');
        this.snapshotFilePath = this.resolveSnapshotPath();
        this.lockFilePath = `${this.snapshotFilePath}.lock`;

        console.log(
            `[SNAPSHOT-DEBUG] Snapshot scope='${this.scope}', workspace='${this.workspacePath}', file='${this.snapshotFilePath}'`
        );
    }

    private parsePositiveNumber(rawValue: string | undefined, fallback: number): number {
        if (!rawValue) {
            return fallback;
        }

        const value = Number(rawValue);
        if (Number.isFinite(value) && value > 0) {
            return value;
        }

        return fallback;
    }

    private resolveSnapshotScope(): SnapshotScope {
        const rawScope = (process.env.MCP_SNAPSHOT_SCOPE || 'workspace').toLowerCase();
        if (rawScope === 'daemon') {
            return 'daemon';
        }
        return rawScope === 'global' ? 'global' : 'workspace';
    }

    private resolveSnapshotPath(): string {
        if (this.scope === 'global') {
            return this.legacySnapshotFilePath;
        }

        if (this.scope === 'daemon') {
            return path.join(os.homedir(), '.context', 'mcp', 'daemon', 'mcp-codebase-snapshot.json');
        }

        const workspaceHash = crypto
            .createHash('sha256')
            .update(this.workspacePath)
            .digest('hex')
            .slice(0, 16);

        return path.join(os.homedir(), '.context', 'mcp', workspaceHash, 'mcp-codebase-snapshot.json');
    }

    private normalizeCodebasePath(codebasePath: string): string {
        return normalizeTrackedCodebasePath(codebasePath);
    }

    public getRuntimeId(): string {
        return this.runtimeId;
    }

    public getOwnershipHeartbeatIntervalMs(): number {
        return this.ownerHeartbeatIntervalMs;
    }

    public getSnapshotFilePath(): string {
        return this.snapshotFilePath;
    }

    private hasKnownIndexStats(info: CodebaseInfo): info is CodebaseInfoIndexed & { indexedFiles: number; totalChunks: number } {
        return info.status === 'indexed'
            && info.statsState !== 'unknown'
            && typeof info.indexedFiles === 'number'
            && typeof info.totalChunks === 'number';
    }

    private buildOwnerInfo(existingOwner?: IndexingOwnerInfo): IndexingOwnerInfo {
        const now = new Date().toISOString();
        return {
            runtimeId: this.runtimeId,
            pid: process.pid,
            startedAt: existingOwner?.startedAt || now,
            heartbeatAt: now,
            ...(this.clientSessionId ? { clientSessionId: this.clientSessionId } : {})
        };
    }

    private isCurrentRuntimeOwner(info: CodebaseInfo): info is CodebaseInfoIndexing {
        return info.status === 'indexing'
            && info.owner?.runtimeId === this.runtimeId
            && info.owner?.pid === process.pid;
    }

    private isPidAlive(pid: number | undefined): boolean {
        if (!Number.isInteger(pid) || pid === undefined || pid <= 0) {
            return false;
        }

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

    private getOwnerHeartbeatAgeMs(owner: IndexingOwnerInfo | undefined): number {
        if (!owner?.heartbeatAt) {
            return Number.POSITIVE_INFINITY;
        }

        const heartbeatAt = Date.parse(owner.heartbeatAt);
        if (Number.isNaN(heartbeatAt)) {
            return Number.POSITIVE_INFINITY;
        }

        return Date.now() - heartbeatAt;
    }

    private isLiveIndexingOwner(info: CodebaseInfoIndexing): boolean {
        if (!info.owner) {
            return false;
        }

        if (!this.isPidAlive(info.owner.pid)) {
            return false;
        }

        return this.getOwnerHeartbeatAgeMs(info.owner) <= this.ownerStaleMs;
    }

    private getIndexingOwnerStaleReason(info: CodebaseInfoIndexing): string {
        if (!info.owner) {
            return 'missing owner metadata';
        }

        if (!this.isPidAlive(info.owner.pid)) {
            return `owner pid ${info.owner.pid} is not alive`;
        }

        const heartbeatAgeMs = this.getOwnerHeartbeatAgeMs(info.owner);
        if (heartbeatAgeMs > this.ownerStaleMs) {
            return `owner heartbeat stale (${heartbeatAgeMs}ms > ${this.ownerStaleMs}ms)`;
        }

        return 'owner is live';
    }

    private formatOwner(owner: IndexingOwnerInfo | undefined): string {
        if (!owner) {
            return 'unknown owner';
        }

        return `runtime=${owner.runtimeId} pid=${owner.pid} heartbeat=${owner.heartbeatAt}`;
    }

    private normalizeProgressDetails(progressDetails: IndexingProgressDetails | undefined): IndexingProgressDetails | undefined {
        if (!progressDetails) {
            return undefined;
        }

        const current = Number.isFinite(progressDetails.current) ? progressDetails.current : 0;
        const total = Number.isFinite(progressDetails.total) ? progressDetails.total : 0;
        const percentage = Number.isFinite(progressDetails.percentage) ? progressDetails.percentage : 0;

        return {
            phase: progressDetails.phase || 'Indexing',
            current,
            total,
            percentage
        };
    }

    private createInterruptedIndexingFailure(info: CodebaseInfoIndexing, reason: string): CodebaseInfoIndexFailed {
        return {
            status: 'indexfailed',
            errorMessage: `Indexing was interrupted or abandoned (${reason}). Please run index_codebase again.`,
            lastAttemptedPercentage: info.indexingPercentage,
            lastUpdated: new Date().toISOString()
        };
    }

    private normalizeCodebaseInfo(info: CodebaseInfo): CodebaseInfo {
        if (info.status !== 'indexed') {
            return info;
        }

        const normalizedInfo: CodebaseInfoIndexed = { ...info };

        if (normalizedInfo.statsState === 'unknown') {
            delete normalizedInfo.indexedFiles;
            delete normalizedInfo.totalChunks;
            return normalizedInfo;
        }

        const hasIndexedFiles = typeof normalizedInfo.indexedFiles === 'number';
        const hasTotalChunks = typeof normalizedInfo.totalChunks === 'number';

        if (!hasIndexedFiles || !hasTotalChunks) {
            normalizedInfo.statsState = 'unknown';
            delete normalizedInfo.indexedFiles;
            delete normalizedInfo.totalChunks;
            return normalizedInfo;
        }

        if (normalizedInfo.statsState === undefined
            && normalizedInfo.indexedFiles === 0
            && normalizedInfo.totalChunks === 0) {
            normalizedInfo.statsState = 'unknown';
            delete normalizedInfo.indexedFiles;
            delete normalizedInfo.totalChunks;
            return normalizedInfo;
        }

        normalizedInfo.statsState = normalizedInfo.statsState || 'known';
        return normalizedInfo;
    }

    private formatIndexedStat(value: number | undefined): string {
        return typeof value === 'number' ? String(value) : 'unknown';
    }

    private selectPreferredCodebaseInfo(existingInfo: CodebaseInfo | undefined, candidateInfo: CodebaseInfo): CodebaseInfo {
        if (!existingInfo) {
            return candidateInfo;
        }

        return this.toTimestamp(candidateInfo.lastUpdated) >= this.toTimestamp(existingInfo.lastUpdated)
            ? candidateInfo
            : existingInfo;
    }

    private selectPreferredDeletionTimestamp(existingDeletedAt: string | undefined, candidateDeletedAt: string): string {
        if (!existingDeletedAt) {
            return candidateDeletedAt;
        }

        return this.toTimestamp(candidateDeletedAt) >= this.toTimestamp(existingDeletedAt)
            ? candidateDeletedAt
            : existingDeletedAt;
    }

    private normalizeSnapshot(snapshot: CodebaseSnapshotV2): CodebaseSnapshotV2 {
        const normalizedCodebases: Record<string, CodebaseInfo> = {};
        const normalizedDeletedCodebases: Record<string, string> = {};

        for (const [codebasePath, info] of Object.entries(snapshot.codebases || {})) {
            const normalizedPath = this.normalizeCodebasePath(codebasePath);
            const normalizedInfo = this.normalizeCodebaseInfo(info);
            if (normalizedPath !== codebasePath) {
                console.log(`[SNAPSHOT-DEBUG] Canonicalized codebase path '${codebasePath}' -> '${normalizedPath}'`);
            }
            normalizedCodebases[normalizedPath] = this.selectPreferredCodebaseInfo(
                normalizedCodebases[normalizedPath],
                normalizedInfo
            );
        }

        for (const [codebasePath, deletedAt] of Object.entries(snapshot.deletedCodebases || {})) {
            const normalizedPath = this.normalizeCodebasePath(codebasePath);
            if (normalizedPath !== codebasePath) {
                console.log(`[SNAPSHOT-DEBUG] Canonicalized deleted codebase path '${codebasePath}' -> '${normalizedPath}'`);
            }
            normalizedDeletedCodebases[normalizedPath] = this.selectPreferredDeletionTimestamp(
                normalizedDeletedCodebases[normalizedPath],
                deletedAt
            );
        }

        return {
            formatVersion: 'v2',
            codebases: normalizedCodebases,
            deletedCodebases: Object.keys(normalizedDeletedCodebases).length > 0 ? normalizedDeletedCodebases : undefined,
            lastUpdated: snapshot.lastUpdated || new Date().toISOString()
        };
    }

    private migrateLegacySnapshotIfNeeded(): void {
        if (this.scope !== 'workspace') {
            return;
        }

        if (fs.existsSync(this.snapshotFilePath)) {
            return;
        }

        const legacySnapshot = this.readSnapshotFileUnsafe(this.legacySnapshotFilePath, false);
        if (!legacySnapshot) {
            return;
        }

        const migratedSnapshot = {
            ...this.normalizeSnapshot(legacySnapshot),
            lastUpdated: new Date().toISOString()
        };
        const migratedCount = Object.keys(migratedSnapshot.codebases).length;
        if (migratedCount === 0) {
            return;
        }

        this.writeSnapshotToDiskUnsafe(migratedSnapshot, this.snapshotFilePath);
        console.log(
            `[SNAPSHOT-DEBUG] Migrated ${migratedCount} codebase(s) from legacy snapshot to workspace-scoped snapshot without path filtering`
        );
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    private async cleanupStaleLockFileIfNeeded(): Promise<void> {
        try {
            const stat = await fs.promises.stat(this.lockFilePath);
            if ((Date.now() - stat.mtimeMs) > this.lockStaleMs) {
                await fs.promises.unlink(this.lockFilePath);
                console.warn(`[SNAPSHOT-DEBUG] Removed stale snapshot lock: ${this.lockFilePath}`);
            }
        } catch (error) {
            if (getErrorCode(error) !== 'ENOENT') {
                console.warn('[SNAPSHOT-DEBUG] Failed to inspect snapshot lock file:', getErrorMessage(error));
            }
        }
    }

    private async withSnapshotLock<T>(callback: () => Promise<T>): Promise<T> {
        const lockDir = path.dirname(this.lockFilePath);
        await fs.promises.mkdir(lockDir, { recursive: true });

        const start = Date.now();
        let retryCount = 0;

        while (true) {
            let lockHandle: fs.promises.FileHandle | null = null;

            try {
                lockHandle = await fs.promises.open(this.lockFilePath, 'wx');
                await lockHandle.writeFile(`${process.pid}:${Date.now()}`);

                const lockWaitMs = Date.now() - start;
                this.lockWaitMsTotal += lockWaitMs;
                this.lockRetryCountTotal += retryCount;

                if (retryCount > 0 || lockWaitMs >= this.lockRetryIntervalMs) {
                    console.log(
                        `[SNAPSHOT-LOCK] wait_ms=${lockWaitMs} retries=${retryCount} total_wait_ms=${this.lockWaitMsTotal} total_retries=${this.lockRetryCountTotal}`
                    );
                }

                try {
                    return await callback();
                } finally {
                    if (lockHandle !== null) {
                        try {
                            await lockHandle.close();
                        } catch {
                            // Ignore close errors
                        }
                    }
                    try {
                        await fs.promises.unlink(this.lockFilePath);
                    } catch (error) {
                        if (getErrorCode(error) !== 'ENOENT') {
                            console.warn('[SNAPSHOT-DEBUG] Failed to remove snapshot lock file:', getErrorMessage(error));
                        }
                    }
                }
            } catch (error) {
                if (lockHandle !== null) {
                    try {
                        await lockHandle.close();
                    } catch {
                        // Ignore close errors
                    }
                }

                if (getErrorCode(error) !== 'EEXIST') {
                    throw error;
                }

                retryCount += 1;
                await this.cleanupStaleLockFileIfNeeded();

                if ((Date.now() - start) >= this.lockAcquireTimeoutMs) {
                    this.lockTimeoutCount += 1;
                    const waitedMs = Date.now() - start;
                    throw new Error(
                        `Timeout acquiring snapshot lock: ${this.lockFilePath} (waited ${waitedMs}ms, retries ${retryCount}, total_timeouts ${this.lockTimeoutCount})`
                    );
                }

                const jitter = this.lockRetryJitterMs > 0
                    ? Math.floor(Math.random() * this.lockRetryJitterMs)
                    : 0;

                await this.sleep(this.lockRetryIntervalMs + jitter);
            }
        }
    }

    private buildSnapshotFromMemory(): CodebaseSnapshotV2 {
        const codebases: Record<string, CodebaseInfo> = {};
        const deletedCodebases: Record<string, string> = {};

        for (const [codebasePath, info] of this.codebaseInfoMap) {
            const normalizedPath = this.normalizeCodebasePath(codebasePath);
            codebases[normalizedPath] = this.selectPreferredCodebaseInfo(codebases[normalizedPath], info);
        }

        for (const [codebasePath, deletedAt] of this.pendingDeletes) {
            const normalizedPath = this.normalizeCodebasePath(codebasePath);
            deletedCodebases[normalizedPath] = this.selectPreferredDeletionTimestamp(
                deletedCodebases[normalizedPath],
                deletedAt
            );
        }

        return {
            formatVersion: 'v2',
            codebases,
            deletedCodebases: Object.keys(deletedCodebases).length > 0 ? deletedCodebases : undefined,
            lastUpdated: new Date().toISOString()
        };
    }

    private applySnapshotToMemory(snapshot: CodebaseSnapshotV2): void {
        snapshot = this.normalizeSnapshot(snapshot);
        const indexedCodebases: string[] = [];
        const indexingCodebases = new Map<string, number>();
        const codebaseFileCount = new Map<string, number>();
        const codebaseInfoMap = new Map<string, CodebaseInfo>();
        const pendingDeletes = new Map<string, string>();

        for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
            codebaseInfoMap.set(codebasePath, info);

            if (info.status === 'indexed') {
                indexedCodebases.push(codebasePath);
                if (typeof info.indexedFiles === 'number') {
                    codebaseFileCount.set(codebasePath, info.indexedFiles);
                }
            } else if (info.status === 'indexing') {
                indexingCodebases.set(codebasePath, info.indexingPercentage || 0);
            }
        }

        for (const [codebasePath, deletedAt] of Object.entries(snapshot.deletedCodebases || {})) {
            pendingDeletes.set(codebasePath, deletedAt);
        }

        this.indexedCodebases = indexedCodebases;
        this.indexingCodebases = indexingCodebases;
        this.codebaseFileCount = codebaseFileCount;
        this.codebaseInfoMap = codebaseInfoMap;
        this.pendingDeletes = pendingDeletes;
    }

    private convertV1ToV2(snapshot: CodebaseSnapshotV1): CodebaseSnapshotV2 {
        const codebases: Record<string, CodebaseInfo> = {};
        const now = new Date().toISOString();
        const snapshotTime = snapshot.lastUpdated || now;

        for (const codebasePath of snapshot.indexedCodebases || []) {
            codebases[codebasePath] = {
                status: 'indexed',
                indexStatus: 'completed',
                statsState: 'unknown',
                lastUpdated: snapshotTime
            };
        }

        const indexingCodebases = snapshot.indexingCodebases;
        if (Array.isArray(indexingCodebases)) {
            for (const codebasePath of indexingCodebases) {
                codebases[codebasePath] = {
                    status: 'indexing',
                    indexingPercentage: 0,
                    lastUpdated: snapshotTime
                };
            }
        } else if (indexingCodebases && typeof indexingCodebases === 'object') {
            for (const [codebasePath, progress] of Object.entries(indexingCodebases)) {
                codebases[codebasePath] = {
                    status: 'indexing',
                    indexingPercentage: typeof progress === 'number' ? progress : 0,
                    lastUpdated: snapshotTime
                };
            }
        }

        return {
            formatVersion: 'v2',
            codebases,
            lastUpdated: snapshotTime
        };
    }

    private readSnapshotFileWithMetadata(snapshotPath: string, rotateCorruptFile: boolean): SnapshotReadResult {
        if (!fs.existsSync(snapshotPath)) {
            return { snapshot: null, sourceFormat: 'none' };
        }

        try {
            const snapshotData = fs.readFileSync(snapshotPath, 'utf8');
            const snapshot: CodebaseSnapshot = JSON.parse(snapshotData);

            if (this.isV2Format(snapshot)) {
                return {
                    snapshot: this.normalizeSnapshot(snapshot),
                    sourceFormat: 'v2'
                };
            }

            return {
                snapshot: this.normalizeSnapshot(this.convertV1ToV2(snapshot)),
                sourceFormat: 'v1'
            };
        } catch (error) {
            console.warn('[SNAPSHOT-DEBUG] Failed to parse snapshot from disk:', getErrorMessage(error));
            if (!rotateCorruptFile) {
                return { snapshot: null, sourceFormat: 'corrupt' };
            }

            try {
                const corruptedPath = `${snapshotPath}.corrupt.${Date.now()}`;
                fs.renameSync(snapshotPath, corruptedPath);
                console.warn(`[SNAPSHOT-DEBUG] Corrupted snapshot moved to: ${corruptedPath}`);
            } catch (rotateError) {
                if (getErrorCode(rotateError) !== 'ENOENT') {
                    console.warn('[SNAPSHOT-DEBUG] Failed to rotate corrupted snapshot file:', getErrorMessage(rotateError));
                }
            }
            return { snapshot: null, sourceFormat: 'corrupt' };
        }
    }

    private readSnapshotFileUnsafe(snapshotPath: string, rotateCorruptFile: boolean): CodebaseSnapshotV2 | null {
        return this.readSnapshotFileWithMetadata(snapshotPath, rotateCorruptFile).snapshot;
    }

    private readSnapshotFromDiskUnsafe(): CodebaseSnapshotV2 | null {
        return this.readSnapshotFileUnsafe(this.snapshotFilePath, true);
    }

    private readSnapshotFromDiskWithMetadata(): SnapshotReadResult {
        return this.readSnapshotFileWithMetadata(this.snapshotFilePath, true);
    }

    private writeSnapshotToDiskUnsafe(snapshot: CodebaseSnapshotV2, snapshotPath: string = this.snapshotFilePath): void {
        const snapshotDir = path.dirname(snapshotPath);
        if (!fs.existsSync(snapshotDir)) {
            fs.mkdirSync(snapshotDir, { recursive: true });
            console.log('[SNAPSHOT-DEBUG] Created snapshot directory:', snapshotDir);
        }

        const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
            fs.renameSync(tempPath, snapshotPath);
        } catch (error) {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch {
                // Ignore temp file cleanup errors
            }
            throw error;
        }
    }

    private toTimestamp(value: string | undefined): number {
        if (!value) {
            return 0;
        }

        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    private createComparableCodebaseInfo(info: CodebaseInfo): Record<string, unknown> {
        if (info.status === 'indexed') {
            return {
                status: info.status,
                indexStatus: info.indexStatus,
                statsState: info.statsState || 'known',
                indexedFiles: info.indexedFiles,
                totalChunks: info.totalChunks,
                lastUpdated: info.lastUpdated
            };
        }

        if (info.status === 'indexing') {
            return {
                status: info.status,
                indexingPercentage: info.indexingPercentage,
                progressDetails: info.progressDetails,
                owner: info.owner,
                lastUpdated: info.lastUpdated
            };
        }

        return {
            status: info.status,
            errorMessage: info.errorMessage,
            lastAttemptedPercentage: info.lastAttemptedPercentage,
            lastUpdated: info.lastUpdated
        };
    }

    private getComparableSnapshotSignature(snapshot: CodebaseSnapshotV2): string {
        const normalizedSnapshot = this.normalizeSnapshot(snapshot);
        const comparableCodebases: Record<string, Record<string, unknown>> = {};
        const comparableDeletedCodebases: Record<string, string> = {};

        for (const codebasePath of Object.keys(normalizedSnapshot.codebases).sort()) {
            comparableCodebases[codebasePath] = this.createComparableCodebaseInfo(normalizedSnapshot.codebases[codebasePath]);
        }

        for (const codebasePath of Object.keys(normalizedSnapshot.deletedCodebases || {}).sort()) {
            comparableDeletedCodebases[codebasePath] = normalizedSnapshot.deletedCodebases![codebasePath];
        }

        return JSON.stringify({
            formatVersion: 'v2',
            codebases: comparableCodebases,
            deletedCodebases: comparableDeletedCodebases
        });
    }

    private shouldPersistLoadedSnapshot(snapshot: CodebaseSnapshotV2, sourceFormat: SnapshotSourceFormat): boolean {
        if (sourceFormat !== 'v2') {
            return true;
        }

        return this.getComparableSnapshotSignature(snapshot) !== this.getComparableSnapshotSignature(this.buildSnapshotFromMemory());
    }

    private mergeSnapshots(existingSnapshot: CodebaseSnapshotV2 | null, localSnapshot: CodebaseSnapshotV2): CodebaseSnapshotV2 {
        const mergedCodebases: Record<string, CodebaseInfo> = {};
        const mergedDeletedCodebases: Record<string, string> = {};

        if (existingSnapshot) {
            const normalizedExistingSnapshot = this.normalizeSnapshot(existingSnapshot);
            for (const [codebasePath, info] of Object.entries(normalizedExistingSnapshot.codebases)) {
                mergedCodebases[codebasePath] = this.selectPreferredCodebaseInfo(mergedCodebases[codebasePath], info);
            }
            for (const [codebasePath, deletedAt] of Object.entries(normalizedExistingSnapshot.deletedCodebases || {})) {
                mergedDeletedCodebases[codebasePath] = this.selectPreferredDeletionTimestamp(
                    mergedDeletedCodebases[codebasePath],
                    deletedAt
                );
            }
        }

        const normalizedLocalSnapshot = this.normalizeSnapshot(localSnapshot);

        for (const [codebasePath, deletedAt] of Object.entries(normalizedLocalSnapshot.deletedCodebases || {})) {
            mergedDeletedCodebases[codebasePath] = this.selectPreferredDeletionTimestamp(
                mergedDeletedCodebases[codebasePath],
                deletedAt
            );
        }

        for (const [codebasePath, localInfo] of Object.entries(normalizedLocalSnapshot.codebases)) {
            const existingInfo = mergedCodebases[codebasePath];
            if (!existingInfo || this.toTimestamp(localInfo.lastUpdated) >= this.toTimestamp(existingInfo.lastUpdated)) {
                mergedCodebases[codebasePath] = localInfo;
            }
        }

        for (const [codebasePath, deletedAt] of Object.entries(mergedDeletedCodebases)) {
            const currentInfo = mergedCodebases[codebasePath];
            if (!currentInfo || this.toTimestamp(deletedAt) >= this.toTimestamp(currentInfo.lastUpdated)) {
                delete mergedCodebases[codebasePath];
            } else {
                delete mergedDeletedCodebases[codebasePath];
            }
        }

        return {
            formatVersion: 'v2',
            codebases: mergedCodebases,
            deletedCodebases: Object.keys(mergedDeletedCodebases).length > 0 ? mergedDeletedCodebases : undefined,
            lastUpdated: new Date().toISOString()
        };
    }

    private markCodebaseDeleted(codebasePath: string): void {
        this.pendingDeletes.set(this.normalizeCodebasePath(codebasePath), new Date().toISOString());
    }

    private clearPendingSaveTimer(): void {
        if (this.pendingSaveTimer) {
            clearTimeout(this.pendingSaveTimer);
            this.pendingSaveTimer = null;
        }
        this.pendingSaveReason = null;
    }

    private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
        const queuedOperation = this.saveQueue
            .catch(() => {
                // Keep queue alive even if prior operation failed.
            })
            .then(operation);

        this.saveQueue = queuedOperation
            .then(() => undefined)
            .catch(() => undefined);

        return queuedOperation;
    }

    private enqueueSave(reason: string): Promise<void> {
        return this.enqueueOperation(async () => {
            await this.performSaveCodebaseSnapshot(reason);
        });
    }

    private inspectSnapshotWithLock<T>(
        reason: string,
        inspector: (snapshot: CodebaseSnapshotV2) => Promise<T> | T
    ): Promise<T> {
        return this.enqueueOperation(async () => {
            console.log(`[SNAPSHOT-DEBUG] Inspecting codebase snapshot (reason=${reason})`);

            return this.withSnapshotLock(async () => {
                const existingSnapshot = this.readSnapshotFromDiskUnsafe();
                const localSnapshot = this.buildSnapshotFromMemory();
                const workingSnapshot = this.mergeSnapshots(existingSnapshot, localSnapshot);
                const normalizedSnapshot = this.normalizeSnapshot(workingSnapshot);

                this.applySnapshotToMemory(normalizedSnapshot);
                return inspector(normalizedSnapshot);
            });
        });
    }

    public scheduleSaveCodebaseSnapshot(reason: string = 'scheduled', delayMs: number = this.saveDebounceMs): void {
        this.pendingSaveReason = reason;

        if (delayMs <= 0) {
            const immediateReason = this.pendingSaveReason || 'scheduled-immediate';
            this.pendingSaveReason = null;
            void this.enqueueSave(immediateReason).catch((error) => {
                console.error('[SNAPSHOT-DEBUG] Error during immediate scheduled snapshot save:', getErrorMessage(error));
            });
            return;
        }

        if (this.pendingSaveTimer) {
            return;
        }

        this.pendingSaveTimer = setTimeout(() => {
            const scheduledReason = this.pendingSaveReason || 'scheduled';
            this.pendingSaveReason = null;
            this.pendingSaveTimer = null;
            void this.enqueueSave(scheduledReason).catch((error) => {
                console.error('[SNAPSHOT-DEBUG] Error during scheduled snapshot save:', getErrorMessage(error));
            });
        }, delayMs);
    }

    public async flushScheduledSave(): Promise<void> {
        if (this.pendingSaveTimer) {
            clearTimeout(this.pendingSaveTimer);
            this.pendingSaveTimer = null;
            const reason = this.pendingSaveReason || 'scheduled-flush';
            this.pendingSaveReason = null;
            await this.enqueueSave(reason);
            return;
        }

        await this.saveQueue;
    }

    private createEmptySnapshot(): CodebaseSnapshotV2 {
        return {
            formatVersion: 'v2',
            codebases: {},
            deletedCodebases: undefined,
            lastUpdated: new Date().toISOString()
        };
    }

    private async mutateSnapshotWithLock<T>(
        reason: string,
        mutator: (snapshot: CodebaseSnapshotV2) => Promise<SnapshotMutationResult<T>> | SnapshotMutationResult<T>
    ): Promise<T> {
        this.clearPendingSaveTimer();

        return this.enqueueOperation(async () => {
            console.log(`[SNAPSHOT-DEBUG] Mutating codebase snapshot (reason=${reason})`);

            return this.withSnapshotLock(async () => {
                const existingSnapshot = this.readSnapshotFromDiskUnsafe();
                const localSnapshot = this.buildSnapshotFromMemory();
                const workingSnapshot = this.mergeSnapshots(existingSnapshot, localSnapshot);
                const { result, changed } = await mutator(workingSnapshot);
                const normalizedSnapshot = this.normalizeSnapshot(workingSnapshot);

                if (changed) {
                    this.writeSnapshotToDiskUnsafe(normalizedSnapshot);
                }

                this.applySnapshotToMemory(normalizedSnapshot);
                return result;
            });
        });
    }

    /**
     * Check if snapshot is v2 format
     */
    private isV2Format(snapshot: unknown): snapshot is CodebaseSnapshotV2 {
        return typeof snapshot === 'object'
            && snapshot !== null
            && (snapshot as { formatVersion?: unknown }).formatVersion === 'v2';
    }

    /**
     * Convert v1 format to internal state
     */
    private loadV1Format(snapshot: CodebaseSnapshotV1): void {
        console.log('[SNAPSHOT-DEBUG] Loading v1 format snapshot');

        // Validate that the codebases still exist
        const validCodebases: string[] = [];
        for (const codebasePath of snapshot.indexedCodebases) {
            if (fs.existsSync(codebasePath)) {
                validCodebases.push(codebasePath);
                console.log(`[SNAPSHOT-DEBUG] Validated codebase: ${codebasePath}`);
            } else {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
            }
        }

        // Handle indexing codebases - treat them as not indexed since they were interrupted
        let indexingCodebasesList: string[] = [];
        if (Array.isArray(snapshot.indexingCodebases)) {
            // Legacy format: string[]
            indexingCodebasesList = snapshot.indexingCodebases;
            console.log(`[SNAPSHOT-DEBUG] Found legacy indexingCodebases array format with ${indexingCodebasesList.length} entries`);
        } else if (snapshot.indexingCodebases && typeof snapshot.indexingCodebases === 'object') {
            // New format: Record<string, number>
            indexingCodebasesList = Object.keys(snapshot.indexingCodebases);
            console.log(`[SNAPSHOT-DEBUG] Found new indexingCodebases object format with ${indexingCodebasesList.length} entries`);
        }

        for (const codebasePath of indexingCodebasesList) {
            if (fs.existsSync(codebasePath)) {
                console.warn(`[SNAPSHOT-DEBUG] Found interrupted indexing codebase: ${codebasePath}. Treating as not indexed.`);
                // Don't add to validIndexingCodebases - treat as not indexed
            } else {
                console.warn(`[SNAPSHOT-DEBUG] Interrupted indexing codebase no longer exists: ${codebasePath}`);
            }
        }

        // Restore state - only fully indexed codebases
        this.indexedCodebases = validCodebases;
        this.indexingCodebases = new Map(); // Reset indexing codebases since they were interrupted
        this.codebaseFileCount = new Map(); // No file count info in v1 format
        this.pendingDeletes = new Map();

        // Populate codebaseInfoMap for v1 indexed codebases (with minimal info)
        this.codebaseInfoMap = new Map();
        const now = new Date().toISOString();
        for (const codebasePath of validCodebases) {
            const info: CodebaseInfoIndexed = {
                status: 'indexed',
                indexStatus: 'completed',
                statsState: 'unknown',
                lastUpdated: now
            };
            this.codebaseInfoMap.set(codebasePath, info);
        }
    }

    /**
 * Convert v2 format to internal state
 */
    private loadV2Format(snapshot: CodebaseSnapshotV2): void {
        console.log('[SNAPSHOT-DEBUG] Loading v2 format snapshot');

        const validIndexedCodebases: string[] = [];
        const validIndexingCodebases = new Map<string, number>();
        const validFileCount = new Map<string, number>();
        const validCodebaseInfoMap = new Map<string, CodebaseInfo>();
        const validPendingDeletes = new Map<string, string>();

        for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
            if (!fs.existsSync(codebasePath)) {
                console.warn(`[SNAPSHOT-DEBUG] Codebase no longer exists, removing: ${codebasePath}`);
                continue;
            }

            if (info.status === 'indexed') {
                // Store the complete info for indexed codebases
                validCodebaseInfoMap.set(codebasePath, info);
                validIndexedCodebases.push(codebasePath);
                if (typeof info.indexedFiles === 'number') {
                    validFileCount.set(codebasePath, info.indexedFiles);
                }
                console.log(
                    `[SNAPSHOT-DEBUG] Validated indexed codebase: ${codebasePath} ` +
                    `(${this.formatIndexedStat(info.indexedFiles)} files, ${this.formatIndexedStat(info.totalChunks)} chunks)`
                );
            } else if (info.status === 'indexing') {
                if (this.isLiveIndexingOwner(info)) {
                    validCodebaseInfoMap.set(codebasePath, info);
                    validIndexingCodebases.set(codebasePath, info.indexingPercentage || 0);
                    console.log(
                        `[SNAPSHOT-DEBUG] Preserving live indexing owner for ${codebasePath}: ${this.formatOwner(info.owner)}`
                    );
                } else {
                    const staleReason = this.getIndexingOwnerStaleReason(info);
                    console.warn(
                        `[SNAPSHOT-DEBUG] Found stale indexing codebase: ${codebasePath} (${info.indexingPercentage || 0}%). ` +
                        `Recovering as failed status. Reason: ${staleReason}`
                    );
                    validCodebaseInfoMap.set(codebasePath, this.createInterruptedIndexingFailure(info, staleReason));
                }
            } else if (info.status === 'indexfailed') {
                validCodebaseInfoMap.set(codebasePath, info);
                console.warn(`[SNAPSHOT-DEBUG] Found failed indexing codebase: ${codebasePath}. Error: ${info.errorMessage}`);
            }
        }

        // Restore state
        this.indexedCodebases = validIndexedCodebases;
        this.indexingCodebases = validIndexingCodebases;
        this.codebaseFileCount = validFileCount;
        this.codebaseInfoMap = validCodebaseInfoMap;
        for (const [codebasePath, deletedAt] of Object.entries(snapshot.deletedCodebases || {})) {
            validPendingDeletes.set(codebasePath, deletedAt);
        }
        this.pendingDeletes = validPendingDeletes;
    }

    public getIndexedCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return [];
            }

            return Object.entries(snapshot.codebases)
                .filter(([_, info]) => info.status === 'indexed')
                .map(([codebasePath, _]) => codebasePath);
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexed codebases from file:`, error);
            // Fallback to memory if file reading fails
            return [...this.indexedCodebases];
        }
    }

    public getIndexingCodebases(): string[] {
        // Read from JSON file to ensure consistency and persistence
        try {
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return [];
            }

            return Object.entries(snapshot.codebases)
                .filter(([_, info]) => info.status === 'indexing')
                .map(([codebasePath, _]) => codebasePath);
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading indexing codebases from file:`, error);
            // Fallback to memory if file reading fails
            return Array.from(this.indexingCodebases.keys());
        }
    }

    public hasTrackedCodebases(): boolean {
        try {
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return false;
            }

            return Object.keys(snapshot.codebases).length > 0;
        } catch (error) {
            console.warn('[SNAPSHOT-DEBUG] Error checking tracked codebases from file:', error);
            return this.codebaseInfoMap.size > 0;
        }
    }

    /**
     * @deprecated Use getCodebaseInfo() for individual codebases or iterate through codebases for v2 format support
     */
    public getIndexingCodebasesWithProgress(): Map<string, number> {
        return new Map(this.indexingCodebases);
    }

    public getIndexingProgress(codebasePath: string): number | undefined {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        // Read from JSON file to ensure consistency and persistence
        try {
            const snapshot = this.readSnapshotFromDiskUnsafe();
            if (!snapshot) {
                return undefined;
            }

            const info = snapshot.codebases[codebasePath];
            if (info && info.status === 'indexing') {
                return info.indexingPercentage || 0;
            }

            return undefined;
        } catch (error) {
            console.warn(`[SNAPSHOT-DEBUG] Error reading progress from file for ${codebasePath}:`, error);
            // Fallback to memory if file reading fails
            return this.indexingCodebases.get(codebasePath);
        }
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public addIndexingCodebase(codebasePath: string, progress: number = 0): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.indexingCodebases.set(codebasePath, progress);
        this.pendingDeletes.delete(codebasePath);

        // Also update codebaseInfoMap for v2 compatibility
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * @deprecated Use setCodebaseIndexing() instead for v2 format support
     */
    public updateIndexingProgress(codebasePath: string, progress: number): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        if (this.indexingCodebases.has(codebasePath)) {
            this.indexingCodebases.set(codebasePath, progress);
            this.pendingDeletes.delete(codebasePath);

            // Also update codebaseInfoMap for v2 compatibility
            const info: CodebaseInfoIndexing = {
                status: 'indexing',
                indexingPercentage: progress,
                lastUpdated: new Date().toISOString()
            };
            this.codebaseInfoMap.set(codebasePath, info);
        }
    }

    /**
     * @deprecated Use removeCodebaseCompletely() or state-specific methods instead for v2 format support
     */
    public removeIndexingCodebase(codebasePath: string): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.indexingCodebases.delete(codebasePath);
        // Also remove from codebaseInfoMap for v2 compatibility
        this.codebaseInfoMap.delete(codebasePath);
        this.markCodebaseDeleted(codebasePath);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public addIndexedCodebase(codebasePath: string, fileCount?: number): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }
        this.pendingDeletes.delete(codebasePath);
        if (fileCount !== undefined) {
            this.codebaseFileCount.set(codebasePath, fileCount);
        }

        // Also update codebaseInfoMap for v2 compatibility
        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexStatus: 'completed',
            statsState: 'unknown',
            lastUpdated: new Date().toISOString()
        };
        if (typeof fileCount === 'number') {
            info.indexedFiles = fileCount;
        }
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * @deprecated Use removeCodebaseCompletely() or state-specific methods instead for v2 format support
     */
    public removeIndexedCodebase(codebasePath: string): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.codebaseFileCount.delete(codebasePath);
        // Also remove from codebaseInfoMap for v2 compatibility
        this.codebaseInfoMap.delete(codebasePath);
        this.markCodebaseDeleted(codebasePath);
    }

    /**
     * @deprecated Use setCodebaseIndexed() instead for v2 format support
     */
    public moveFromIndexingToIndexed(codebasePath: string, fileCount?: number): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.removeIndexingCodebase(codebasePath);
        this.addIndexedCodebase(codebasePath, fileCount);
    }

    /**
     * @deprecated Use getCodebaseInfo() and check indexedFiles property instead for v2 format support
     */
    public getIndexedFileCount(codebasePath: string): number | undefined {
        return this.codebaseFileCount.get(this.normalizeCodebasePath(codebasePath));
    }

    /**
     * @deprecated Use setCodebaseIndexed() with complete stats instead for v2 format support
     */
    public setIndexedFileCount(codebasePath: string, fileCount: number): void {
        this.codebaseFileCount.set(this.normalizeCodebasePath(codebasePath), fileCount);
    }

    /**
     * Set codebase to indexing status
     */
    public setCodebaseIndexing(
        codebasePath: string,
        progress: number = 0,
        progressDetails?: IndexingProgressDetails
    ): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        const existingInfo = this.codebaseInfoMap.get(codebasePath);
        this.indexingCodebases.set(codebasePath, progress);
        this.pendingDeletes.delete(codebasePath);

        // Remove from other states
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        // Update info map
        const info: CodebaseInfoIndexing = {
            status: 'indexing',
            indexingPercentage: progress,
            progressDetails: this.normalizeProgressDetails(progressDetails)
                || (existingInfo?.status === 'indexing' ? existingInfo.progressDetails : undefined),
            lastUpdated: new Date().toISOString(),
            ...(existingInfo?.status === 'indexing' && existingInfo.owner
                ? { owner: this.buildOwnerInfo(existingInfo.owner) }
                : {})
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * Set codebase to indexed status with complete statistics
     */
    public setCodebaseIndexed(
        codebasePath: string,
        stats: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached'; codeChunkLimit?: number }
    ): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.pendingDeletes.delete(codebasePath);

        // Add to indexed list if not already there
        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }

        // Remove from indexing state
        this.indexingCodebases.delete(codebasePath);

        // Update file count and info
        this.codebaseFileCount.set(codebasePath, stats.indexedFiles);

        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexedFiles: stats.indexedFiles,
            totalChunks: stats.totalChunks,
            codeChunkLimit: stats.codeChunkLimit,
            indexStatus: stats.status,
            statsState: 'known',
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    public setCodebaseIndexedWithoutStats(
        codebasePath: string,
        status: 'completed' | 'limit_reached' = 'completed'
    ): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.pendingDeletes.delete(codebasePath);

        if (!this.indexedCodebases.includes(codebasePath)) {
            this.indexedCodebases.push(codebasePath);
        }

        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        const info: CodebaseInfoIndexed = {
            status: 'indexed',
            indexStatus: status,
            statsState: 'unknown',
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    public touchCodebaseIndexed(codebasePath: string): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        const currentInfo = this.codebaseInfoMap.get(codebasePath);

        if (!currentInfo || currentInfo.status !== 'indexed') {
            return;
        }

        const nextInfo: CodebaseInfoIndexed = {
            ...currentInfo,
            lastUpdated: new Date().toISOString()
        };

        if (this.hasKnownIndexStats(currentInfo)) {
            this.codebaseFileCount.set(codebasePath, currentInfo.indexedFiles);
        } else {
            this.codebaseFileCount.delete(codebasePath);
        }

        this.codebaseInfoMap.set(codebasePath, nextInfo);
    }

    public async restoreIndexedCodebaseFromCloud(
        codebasePath: string,
        stats?: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached'; codeChunkLimit?: number },
        indexStatus: 'completed' | 'limit_reached' = 'completed'
    ): Promise<'restored-with-stats' | 'restored-without-stats' | 'skipped-live-owner'> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);

        return this.mutateSnapshotWithLock('cloud-index-restore', async (snapshot) => {
            const existingInfo = snapshot.codebases[normalizedPath];
            if (existingInfo?.status === 'indexing' && this.isLiveIndexingOwner(existingInfo)) {
                console.warn(
                    `[SNAPSHOT-OWNERSHIP] Refusing to reconcile '${normalizedPath}' from cloud because a live owner is still indexing.`
                );
                return {
                    changed: false,
                    result: 'skipped-live-owner' as const
                };
            }

            snapshot.codebases[normalizedPath] = stats
                ? {
                    status: 'indexed',
                    indexedFiles: stats.indexedFiles,
                    totalChunks: stats.totalChunks,
                    codeChunkLimit: stats.codeChunkLimit,
                    indexStatus: stats.status,
                    statsState: 'known',
                    lastUpdated: new Date().toISOString()
                }
                : {
                    status: 'indexed',
                    indexStatus,
                    statsState: 'unknown',
                    lastUpdated: new Date().toISOString()
                };

            if (snapshot.deletedCodebases) {
                delete snapshot.deletedCodebases[normalizedPath];
            }

            return {
                changed: true,
                result: stats ? 'restored-with-stats' as const : 'restored-without-stats' as const
            };
        });
    }

    /**
     * Set codebase to failed status
     */
    public setCodebaseIndexFailed(
        codebasePath: string,
        errorMessage: string,
        lastAttemptedPercentage?: number
    ): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        this.pendingDeletes.delete(codebasePath);

        // Remove from other states
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);

        // Update info map
        const info: CodebaseInfoIndexFailed = {
            status: 'indexfailed',
            errorMessage: errorMessage,
            lastAttemptedPercentage: lastAttemptedPercentage,
            lastUpdated: new Date().toISOString()
        };
        this.codebaseInfoMap.set(codebasePath, info);
    }

    /**
     * Get codebase status
     */
    public getCodebaseStatus(codebasePath: string): 'indexed' | 'indexing' | 'indexfailed' | 'not_found' {
        const info = this.codebaseInfoMap.get(this.normalizeCodebasePath(codebasePath));
        if (!info) return 'not_found';
        return info.status;
    }

    /**
     * Get complete codebase information
     */
    public getCodebaseInfo(codebasePath: string): CodebaseInfo | undefined {
        return this.codebaseInfoMap.get(this.normalizeCodebasePath(codebasePath));
    }

    public getAllCodebaseInfo(): Record<string, CodebaseInfo> {
        return Object.fromEntries(this.codebaseInfoMap.entries());
    }

    public async inspectIndexingOwnership(codebasePath: string): Promise<IndexingOwnershipInspectionResult> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);

        return this.inspectSnapshotWithLock(
            'index-ownership-inspect',
            async (snapshot): Promise<IndexingOwnershipInspectionResult> => {
                const existingInfo = snapshot.codebases[normalizedPath];
                if (!existingInfo || existingInfo.status !== 'indexing') {
                    return {
                        state: 'not-indexing',
                        info: existingInfo
                    };
                }

                const indexingInfo: CodebaseInfoIndexing = existingInfo;
                const currentOwner = indexingInfo.owner;
                const ownedByCurrentRuntime =
                    currentOwner?.runtimeId === this.runtimeId
                    && currentOwner?.pid === process.pid;

                if (ownedByCurrentRuntime) {
                    return {
                        state: 'owned-by-current-runtime',
                        currentOwner,
                        info: indexingInfo
                    };
                }

                if (this.isLiveIndexingOwner(indexingInfo)) {
                    return {
                        state: 'blocked-live-owner',
                        currentOwner,
                        info: indexingInfo
                    };
                }

                return {
                    state: 'stale-owner',
                    currentOwner,
                    info: indexingInfo,
                    staleReason: this.getIndexingOwnerStaleReason(indexingInfo)
                };
            }
        );
    }

    public async acquireIndexingOwnership(
        codebasePath: string,
        progress: number = 0
    ): Promise<IndexingOwnershipClaimResult> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);

        return this.mutateSnapshotWithLock<IndexingOwnershipClaimResult>(
            'index-ownership-acquire',
            async (snapshot): Promise<SnapshotMutationResult<IndexingOwnershipClaimResult>> => {
                const existingInfo = snapshot.codebases[normalizedPath];

                if (existingInfo?.status === 'indexing') {
                    const existingIndexingInfo = existingInfo as CodebaseInfoIndexing;
                    const existingOwner = existingIndexingInfo.owner;

                    if (this.isCurrentRuntimeOwner(existingIndexingInfo)) {
                        const updatedInfo: CodebaseInfoIndexing = {
                            ...existingIndexingInfo,
                            indexingPercentage: progress,
                            owner: this.buildOwnerInfo(existingOwner),
                            lastUpdated: new Date().toISOString()
                        };
                        snapshot.codebases[normalizedPath] = {
                            ...updatedInfo
                        };
                        if (snapshot.deletedCodebases) {
                            delete snapshot.deletedCodebases[normalizedPath];
                        }
                        return {
                            changed: true,
                            result: {
                                acquired: true,
                                reason: 'already-owned',
                                currentOwner: updatedInfo.owner,
                                previousInfo: existingIndexingInfo
                            }
                        };
                    }

                    if (this.isLiveIndexingOwner(existingIndexingInfo)) {
                        console.warn(
                            `[SNAPSHOT-OWNERSHIP] Rejecting indexing for '${normalizedPath}'. ` +
                            `Live owner already exists: ${this.formatOwner(existingOwner)}`
                        );
                        return {
                            changed: false,
                            result: {
                                acquired: false,
                                reason: 'blocked-live-owner',
                                currentOwner: existingOwner,
                                previousInfo: existingIndexingInfo
                            }
                        };
                    }

                    const staleReason = this.getIndexingOwnerStaleReason(existingIndexingInfo);
                    const reclaimedInfo: CodebaseInfoIndexing = {
                        status: 'indexing',
                        indexingPercentage: progress,
                        owner: this.buildOwnerInfo(),
                        lastUpdated: new Date().toISOString()
                    };
                    snapshot.codebases[normalizedPath] = reclaimedInfo;
                    if (snapshot.deletedCodebases) {
                        delete snapshot.deletedCodebases[normalizedPath];
                    }
                    console.warn(
                        `[SNAPSHOT-OWNERSHIP] Reclaiming stale indexing owner for '${normalizedPath}'. ` +
                        `Previous owner: ${this.formatOwner(existingOwner)}. Reason: ${staleReason}`
                    );
                    return {
                        changed: true,
                        result: {
                            acquired: true,
                            reason: 'reclaimed-stale-owner',
                            currentOwner: reclaimedInfo.owner,
                            previousInfo: existingIndexingInfo
                        }
                    };
                }

                const nextInfo: CodebaseInfoIndexing = {
                    status: 'indexing',
                    indexingPercentage: progress,
                    owner: this.buildOwnerInfo(),
                    lastUpdated: new Date().toISOString()
                };
                snapshot.codebases[normalizedPath] = nextInfo;
                if (snapshot.deletedCodebases) {
                    delete snapshot.deletedCodebases[normalizedPath];
                }

                return {
                    changed: true,
                    result: {
                        acquired: true,
                        reason: 'claimed',
                        currentOwner: nextInfo.owner,
                        previousInfo: existingInfo
                    }
                };
            }
        );
    }

    public async refreshIndexingOwnership(codebasePath: string, progress?: number): Promise<boolean> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);

        return this.mutateSnapshotWithLock('index-ownership-heartbeat', async (snapshot) => {
            const existingInfo = snapshot.codebases[normalizedPath];
            if (!existingInfo || existingInfo.status !== 'indexing' || !this.isCurrentRuntimeOwner(existingInfo)) {
                console.warn(
                    `[SNAPSHOT-OWNERSHIP] Skipping heartbeat refresh for '${normalizedPath}' because current runtime no longer owns indexing.`
                );
                return {
                    changed: false,
                    result: false
                };
            }

            snapshot.codebases[normalizedPath] = {
                ...existingInfo,
                indexingPercentage: progress ?? existingInfo.indexingPercentage,
                owner: this.buildOwnerInfo(existingInfo.owner),
                lastUpdated: new Date().toISOString()
            };
            if (snapshot.deletedCodebases) {
                delete snapshot.deletedCodebases[normalizedPath];
            }

            return {
                changed: true,
                result: true
            };
        });
    }

    public async completeIndexingOwnership(
        codebasePath: string,
        stats: { indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached'; codeChunkLimit?: number }
    ): Promise<boolean> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);

        return this.mutateSnapshotWithLock('index-ownership-complete', async (snapshot) => {
            const existingInfo = snapshot.codebases[normalizedPath];
            if (!existingInfo || existingInfo.status !== 'indexing' || !this.isCurrentRuntimeOwner(existingInfo)) {
                console.warn(
                    `[SNAPSHOT-OWNERSHIP] Refusing to mark '${normalizedPath}' as indexed because current runtime is not the owner anymore.`
                );
                return {
                    changed: false,
                    result: false
                };
            }

            snapshot.codebases[normalizedPath] = {
                status: 'indexed',
                indexedFiles: stats.indexedFiles,
                totalChunks: stats.totalChunks,
                codeChunkLimit: stats.codeChunkLimit,
                indexStatus: stats.status,
                statsState: 'known',
                lastUpdated: new Date().toISOString()
            };
            if (snapshot.deletedCodebases) {
                delete snapshot.deletedCodebases[normalizedPath];
            }

            return {
                changed: true,
                result: true
            };
        });
    }

    public async failIndexingOwnership(
        codebasePath: string,
        errorMessage: string,
        lastAttemptedPercentage?: number
    ): Promise<boolean> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);

        return this.mutateSnapshotWithLock('index-ownership-fail', async (snapshot) => {
            const existingInfo = snapshot.codebases[normalizedPath];
            if (!existingInfo || existingInfo.status !== 'indexing' || !this.isCurrentRuntimeOwner(existingInfo)) {
                console.warn(
                    `[SNAPSHOT-OWNERSHIP] Refusing to mark '${normalizedPath}' as failed because current runtime is not the owner anymore.`
                );
                return {
                    changed: false,
                    result: false
                };
            }

            snapshot.codebases[normalizedPath] = {
                status: 'indexfailed',
                errorMessage,
                lastAttemptedPercentage,
                lastUpdated: new Date().toISOString()
            };
            if (snapshot.deletedCodebases) {
                delete snapshot.deletedCodebases[normalizedPath];
            }

            return {
                changed: true,
                result: true
            };
        });
    }

    public async failCurrentRuntimeOwnedIndexingCodebases(errorMessage: string): Promise<string[]> {
        return this.mutateSnapshotWithLock('index-ownership-fail-runtime-shutdown', async (snapshot) => {
            const failedCodebases: string[] = [];
            const lastUpdated = new Date().toISOString();

            for (const [codebasePath, info] of Object.entries(snapshot.codebases)) {
                if (!info || info.status !== 'indexing' || !this.isCurrentRuntimeOwner(info)) {
                    continue;
                }

                snapshot.codebases[codebasePath] = {
                    status: 'indexfailed',
                    errorMessage,
                    lastAttemptedPercentage: info.indexingPercentage,
                    lastUpdated
                };
                failedCodebases.push(codebasePath);
            }

            return {
                changed: failedCodebases.length > 0,
                result: failedCodebases
            };
        });
    }

    /**
     * Get all failed codebases
     */
    public getFailedCodebases(): string[] {
        return Array.from(this.codebaseInfoMap.entries())
            .filter(([_, info]) => info.status === 'indexfailed')
            .map(([path, _]) => path);
    }

    /**
     * Completely remove a codebase from all tracking (for clear_index operation)
     */
    public removeCodebaseCompletely(codebasePath: string): void {
        codebasePath = this.normalizeCodebasePath(codebasePath);
        // Remove from all internal state
        this.indexedCodebases = this.indexedCodebases.filter(path => path !== codebasePath);
        this.indexingCodebases.delete(codebasePath);
        this.codebaseFileCount.delete(codebasePath);
        this.codebaseInfoMap.delete(codebasePath);
        this.markCodebaseDeleted(codebasePath);

        console.log(`[SNAPSHOT-DEBUG] Completely removed codebase from snapshot: ${codebasePath}`);
    }

    public loadCodebaseSnapshot(): void {
        console.log('[SNAPSHOT-DEBUG] Loading codebase snapshot from:', this.snapshotFilePath);

        try {
            this.pendingDeletes.clear();
            this.migrateLegacySnapshotIfNeeded();

            const { snapshot, sourceFormat } = this.readSnapshotFromDiskWithMetadata();
            if (!snapshot) {
                console.log('[SNAPSHOT-DEBUG] Snapshot file does not exist. Starting with empty codebase list.');
                this.pendingDeletes.clear();
                return;
            }

            console.log('[SNAPSHOT-DEBUG] Loaded snapshot:', snapshot);

            this.loadV2Format(snapshot);

            if (this.shouldPersistLoadedSnapshot(snapshot, sourceFormat)) {
                void this.saveCodebaseSnapshot('post-load-migration').catch((error) => {
                    console.error('[SNAPSHOT-DEBUG] Error persisting post-load migration snapshot:', getErrorMessage(error));
                });
            }

        } catch (error) {
            console.error('[SNAPSHOT-DEBUG] Error loading snapshot:', getErrorMessage(error));
            console.log('[SNAPSHOT-DEBUG] Starting with empty codebase list due to snapshot error.');
        }
    }

    private async performSaveCodebaseSnapshot(reason: string): Promise<void> {
        console.log(`[SNAPSHOT-DEBUG] Saving codebase snapshot to: ${this.snapshotFilePath} (reason=${reason})`);

        const mergedSnapshot = await this.withSnapshotLock(async () => {
            const existingSnapshot = this.readSnapshotFromDiskUnsafe();
            const localSnapshot = this.buildSnapshotFromMemory();
            const merged = this.mergeSnapshots(existingSnapshot, localSnapshot);
            this.writeSnapshotToDiskUnsafe(merged);
            this.applySnapshotToMemory(merged);
            return merged;
        });

        const statuses = Object.values(mergedSnapshot.codebases);
        const indexedCount = statuses.filter((info) => info.status === 'indexed').length;
        const indexingCount = statuses.filter((info) => info.status === 'indexing').length;
        const failedCount = statuses.filter((info) => info.status === 'indexfailed').length;

        console.log(`[SNAPSHOT-DEBUG] Snapshot saved successfully in v2 format. Indexed: ${indexedCount}, Indexing: ${indexingCount}, Failed: ${failedCount}`);
    }

    public async saveCodebaseSnapshot(reason: string = 'manual'): Promise<void> {
        this.clearPendingSaveTimer();
        await this.enqueueSave(reason);
    }
}
