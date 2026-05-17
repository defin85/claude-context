import * as fs from "fs";
import { Context, FileSynchronizer, envManager } from "@zilliz/claude-context-core";
import { CodebaseConfigManager } from "./codebase-config.js";
import { SnapshotManager } from "./snapshot.js";
import { RuntimeStatusManager, RuntimeSyncCodebaseResult } from "./runtime-status.js";
import { WorkloadCancelledError, WorkloadManager, isWorkloadCancelledError } from "./workload-manager.js";

const DEFAULT_INITIAL_SYNC_DELAY_MS = 5_000;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MIN_SYNC_INTERVAL_MS = 1_000;

function isBackgroundSyncEnabled(): boolean {
    const value = envManager.get('CLAUDE_CONTEXT_BACKGROUND_SYNC');
    if (!value) {
        return true;
    }

    switch (value.trim().toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'on':
            return true;
        case '0':
        case 'false':
        case 'no':
        case 'off':
            return false;
        default:
            console.warn(
                `[SYNC-DEBUG] Invalid CLAUDE_CONTEXT_BACKGROUND_SYNC value '${value}'. ` +
                'Expected true/false. Background sync will remain enabled.'
            );
            return true;
    }
}

function getBackgroundSyncIntervalMs(): number {
    const value = envManager.get('CLAUDE_CONTEXT_SYNC_INTERVAL_MS');
    if (!value) {
        return DEFAULT_SYNC_INTERVAL_MS;
    }

    const intervalMs = Number.parseInt(value, 10);
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_SYNC_INTERVAL_MS) {
        console.warn(
            `[SYNC-DEBUG] Invalid CLAUDE_CONTEXT_SYNC_INTERVAL_MS value '${value}'. ` +
            `Falling back to ${DEFAULT_SYNC_INTERVAL_MS}ms.`
        );
        return DEFAULT_SYNC_INTERVAL_MS;
    }

    return intervalMs;
}

export class SyncManager {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private codebaseConfigManager: CodebaseConfigManager;
    private runtimeStatusManager?: RuntimeStatusManager;
    private workloadManager?: WorkloadManager;
    private isSyncing: boolean = false;
    private isStopped: boolean = false;
    private initialSyncTimer?: ReturnType<typeof setTimeout>;
    private periodicSyncTimer?: ReturnType<typeof setInterval>;

    constructor(
        context: Context,
        snapshotManager: SnapshotManager,
        codebaseConfigManager: CodebaseConfigManager,
        runtimeStatusManager?: RuntimeStatusManager,
        workloadManager?: WorkloadManager
    ) {
        this.context = context;
        this.snapshotManager = snapshotManager;
        this.codebaseConfigManager = codebaseConfigManager;
        this.runtimeStatusManager = runtimeStatusManager;
        this.workloadManager = workloadManager;
    }

    private throwIfCancelled(abortSignal?: AbortSignal, codebasePath?: string): void {
        if (!abortSignal?.aborted) {
            return;
        }

        const reason = abortSignal.reason;
        if (reason instanceof Error) {
            throw reason;
        }

        throw new WorkloadCancelledError(
            codebasePath
                ? `Background sync for '${codebasePath}' was cancelled by daemon operator.`
                : 'Background sync was cancelled by daemon operator.'
        );
    }

    private async recoverIndexedCodebasesFromPersistedConfig(): Promise<string[]> {
        const configuredCodebases = await this.codebaseConfigManager.listConfiguredCodebases();
        if (configuredCodebases.length === 0) {
            console.log('[SYNC-DEBUG] No persisted codebase configs found for snapshot self-heal.');
            return [];
        }

        console.log(`[SYNC-DEBUG] Attempting snapshot self-heal from ${configuredCodebases.length} persisted codebase config(s).`);

        const recoveredCodebases: string[] = [];

        for (const codebasePath of configuredCodebases) {
            if (!fs.existsSync(codebasePath)) {
                console.warn(`[SYNC-DEBUG] Skipping self-heal candidate '${codebasePath}': path no longer exists.`);
                continue;
            }

            try {
                const hasCloudIndex = await this.context.hasIndex(codebasePath);
                if (!hasCloudIndex) {
                    console.log(`[SYNC-DEBUG] Self-heal candidate '${codebasePath}' has no cloud index. Skipping.`);
                    continue;
                }

                this.snapshotManager.setCodebaseIndexedWithoutStats(codebasePath);
                recoveredCodebases.push(codebasePath);
                console.log(`[SYNC-DEBUG] Self-healed snapshot entry for '${codebasePath}' from persisted config + cloud index.`);
            } catch (error: any) {
                console.warn(`[SYNC-DEBUG] Failed self-heal check for '${codebasePath}':`, error.message || error);
            }
        }

        if (recoveredCodebases.length > 0) {
            await this.snapshotManager.saveCodebaseSnapshot('sync-self-heal-cloud-present');
        }

        return recoveredCodebases;
    }

    public async handleSyncIndex(): Promise<void> {
        if (this.isStopped) {
            console.log('[SYNC-DEBUG] Skipping sync: background sync manager is stopped.');
            return;
        }

        const syncStartTime = Date.now();
        console.log(`[SYNC-DEBUG] handleSyncIndex() called at ${new Date().toISOString()}`);

        let indexedCodebases = this.snapshotManager.getIndexedCodebases();
        const codebaseResults: RuntimeSyncCodebaseResult[] = [];

        if (indexedCodebases.length === 0) {
            if (this.snapshotManager.hasTrackedCodebases()) {
                const skipReason = 'no indexed codebases present, but snapshot already tracks local state; refusing self-heal';
                console.log(`[SYNC-DEBUG] Skipping sync: ${skipReason}`);
                await this.runtimeStatusManager?.markSyncSkipped(skipReason);
                return;
            }

            indexedCodebases = await this.recoverIndexedCodebasesFromPersistedConfig();
            if (indexedCodebases.length === 0) {
                const skipReason = 'no indexed codebases present in snapshot and snapshot self-heal found no cloud-backed candidates';
                console.log(`[SYNC-DEBUG] Skipping sync: ${skipReason}`);
                await this.runtimeStatusManager?.markSyncSkipped(skipReason);
                return;
            }
        }

        console.log(`[SYNC-DEBUG] Found ${indexedCodebases.length} indexed codebases:`, indexedCodebases);

        if (this.isSyncing) {
            const skipReason = 'sync already in progress in this runtime';
            console.log(`[SYNC-DEBUG] Skipping sync: ${skipReason}`);
            await this.runtimeStatusManager?.markSyncSkipped(skipReason);
            return;
        }

        this.isSyncing = true;
        console.log(`[SYNC-DEBUG] Starting index sync for all ${indexedCodebases.length} codebases...`);
        await this.runtimeStatusManager?.markSyncStarted();

        try {
            let totalStats = { added: 0, removed: 0, modified: 0 };

            for (let i = 0; i < indexedCodebases.length; i++) {
                const codebasePath = indexedCodebases[i];
                const codebaseStartTime = Date.now();

                console.log(`[SYNC-DEBUG] [${i + 1}/${indexedCodebases.length}] Starting sync for codebase: '${codebasePath}'`);

                // Check if codebase path still exists
                try {
                    const pathExists = fs.existsSync(codebasePath);
                    console.log(`[SYNC-DEBUG] Codebase path exists: ${pathExists}`);

                    if (!pathExists) {
                        const skipReason = 'codebase path no longer exists';
                        console.warn(`[SYNC-DEBUG] Codebase path '${codebasePath}' no longer exists. Skipping sync.`);
                        codebaseResults.push({
                            path: codebasePath,
                            outcome: 'skipped',
                            reason: skipReason
                        });
                        continue;
                    }
                } catch (pathError: any) {
                    console.error(`[SYNC-DEBUG] Error checking codebase path '${codebasePath}':`, pathError);
                    codebaseResults.push({
                        path: codebasePath,
                        outcome: 'failed',
                        reason: `path validation failed: ${pathError.message || pathError}`
                    });
                    continue;
                }

                try {
                    const persistedConfig = await this.codebaseConfigManager.getConfig(codebasePath);
                    if (!persistedConfig) {
                        const skipReason = 'missing persisted per-codebase sync config; reindex required to restore incremental sync';
                        console.warn(`[SYNC-DEBUG] Skipping sync for '${codebasePath}': ${skipReason}`);
                        codebaseResults.push({
                            path: codebasePath,
                            outcome: 'skipped',
                            reason: skipReason
                        });
                        continue;
                    }

                    this.context.configureCodebaseSession(codebasePath, persistedConfig);
                    await this.context.getLoadedIgnorePatterns(codebasePath);

                    console.log(`[SYNC-DEBUG] Calling context.reindexByChange() for '${codebasePath}'`);
                    const stats = this.workloadManager
                        ? await this.workloadManager.runBackgroundSync(codebasePath, (signal) => {
                            this.throwIfCancelled(signal, codebasePath);
                            return this.context.reindexByChange(
                                codebasePath,
                                (progress) => {
                                    console.log(`[SYNC-DEBUG] Sync progress for '${codebasePath}': ${progress.phase} (${progress.percentage}%)`);
                                    this.throwIfCancelled(signal, codebasePath);
                                },
                                signal
                            );
                        })
                        : await this.context.reindexByChange(codebasePath);
                    const codebaseElapsed = Date.now() - codebaseStartTime;

                    console.log(`[SYNC-DEBUG] Reindex stats for '${codebasePath}':`, stats);
                    console.log(`[SYNC-DEBUG] Codebase sync completed in ${codebaseElapsed}ms`);

                    // Accumulate total stats
                    totalStats.added += stats.added;
                    totalStats.removed += stats.removed;
                    totalStats.modified += stats.modified;

                    if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                        // Refresh snapshot metadata so get_indexing_status shows recent incremental reindex time.
                        const currentInfo = this.snapshotManager.getCodebaseInfo(codebasePath);
                        if (currentInfo && currentInfo.status === 'indexed') {
                            this.snapshotManager.touchCodebaseIndexed(codebasePath);
                            await this.snapshotManager.saveCodebaseSnapshot('sync-incremental-updated');
                        }

                        codebaseResults.push({
                            path: codebasePath,
                            outcome: 'synced',
                            added: stats.added,
                            removed: stats.removed,
                            modified: stats.modified,
                            durationMs: codebaseElapsed
                        });

                        console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${codebaseElapsed}ms)`);
                    } else {
                        codebaseResults.push({
                            path: codebasePath,
                            outcome: 'unchanged',
                            reason: 'no file changes detected',
                            durationMs: codebaseElapsed
                        });
                        console.log(`[SYNC] No changes detected for '${codebasePath}' (${codebaseElapsed}ms)`);
                    }
                } catch (error: any) {
                    const codebaseElapsed = Date.now() - codebaseStartTime;
                    if (isWorkloadCancelledError(error)) {
                        codebaseResults.push({
                            path: codebasePath,
                            outcome: 'skipped',
                            reason: error.message || `background sync for '${codebasePath}' was cancelled by daemon operator`,
                            durationMs: codebaseElapsed
                        });
                        console.warn(`[SYNC-DEBUG] Background sync for '${codebasePath}' was cancelled after ${codebaseElapsed}ms.`);
                        continue;
                    }

                    console.error(`[SYNC-DEBUG] Error syncing codebase '${codebasePath}' after ${codebaseElapsed}ms:`, error);
                    console.error(`[SYNC-DEBUG] Error stack:`, error.stack);

                    if (error.message.includes('Failed to query Milvus')) {
                        // Collection maybe deleted manually, delete the snapshot file
                        await FileSynchronizer.deleteSnapshot(codebasePath);
                    }

                    // Log additional error details
                    if (error.code) {
                        console.error(`[SYNC-DEBUG] Error code: ${error.code}`);
                    }
                    if (error.errno) {
                        console.error(`[SYNC-DEBUG] Error errno: ${error.errno}`);
                    }

                    codebaseResults.push({
                        path: codebasePath,
                        outcome: 'failed',
                        reason: error.message || String(error),
                        durationMs: codebaseElapsed
                    });

                    // Continue with next codebase even if one fails
                }
            }

            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] Total sync stats across all codebases: Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            console.log(`[SYNC-DEBUG] Codebase sync outcomes: ${JSON.stringify(codebaseResults)}`);
            console.log(`[SYNC-DEBUG] Index sync completed for all codebases in ${totalElapsed}ms`);
            console.log(`[SYNC] Index sync completed for all codebases. Total changes - Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            await this.runtimeStatusManager?.markSyncCompleted(totalStats, codebaseResults);
        } catch (error: any) {
            const totalElapsed = Date.now() - syncStartTime;
            console.error(`[SYNC-DEBUG] Error during index sync after ${totalElapsed}ms:`, error);
            console.error(`[SYNC-DEBUG] Error stack:`, error.stack);
            await this.runtimeStatusManager?.markSyncFailed(error.message || String(error), codebaseResults);
        } finally {
            this.isSyncing = false;
            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] handleSyncIndex() finished at ${new Date().toISOString()}, total duration: ${totalElapsed}ms`);
        }
    }

    public startBackgroundSync(): void {
        console.log('[SYNC-DEBUG] startBackgroundSync() called');
        if (this.initialSyncTimer || this.periodicSyncTimer) {
            console.log('[SYNC-DEBUG] Background sync already started. Skipping duplicate start request.');
            return;
        }
        this.isStopped = false;

        if (!isBackgroundSyncEnabled()) {
            console.log('[SYNC-DEBUG] Background sync is disabled via CLAUDE_CONTEXT_BACKGROUND_SYNC=false.');
            return;
        }

        const syncIntervalMs = getBackgroundSyncIntervalMs();

        // Execute initial sync immediately after a short delay to let server initialize
        console.log(`[SYNC-DEBUG] Scheduling initial sync in ${DEFAULT_INITIAL_SYNC_DELAY_MS}ms...`);
        this.initialSyncTimer = setTimeout(async () => {
            this.initialSyncTimer = undefined;
            if (this.isStopped) {
                console.log('[SYNC-DEBUG] Initial sync timer fired after stop request. Skipping.');
                return;
            }
            console.log('[SYNC-DEBUG] Executing initial sync after server startup');
            try {
                await this.handleSyncIndex();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage.includes('Failed to query collection')) {
                    console.log('[SYNC-DEBUG] Collection not yet established, this is expected for new cluster users. Will retry on next sync cycle.');
                } else {
                    console.error('[SYNC-DEBUG] Initial sync failed with unexpected error:', error);
                    throw error;
                }
            }
        }, DEFAULT_INITIAL_SYNC_DELAY_MS);

        // Periodically check for file changes and update the index
        console.log(`[SYNC-DEBUG] Setting up periodic sync every ${syncIntervalMs}ms`);
        this.periodicSyncTimer = setInterval(() => {
            if (this.isStopped) {
                console.log('[SYNC-DEBUG] Periodic sync tick observed after stop request. Skipping.');
                return;
            }
            console.log('[SYNC-DEBUG] Executing scheduled periodic sync');
            void this.handleSyncIndex();
        }, syncIntervalMs);

        console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', this.periodicSyncTimer);
    }

    public stopBackgroundSync(): void {
        this.isStopped = true;

        if (this.initialSyncTimer) {
            clearTimeout(this.initialSyncTimer);
            this.initialSyncTimer = undefined;
        }

        if (this.periodicSyncTimer) {
            clearInterval(this.periodicSyncTimer);
            this.periodicSyncTimer = undefined;
        }

        console.log('[SYNC-DEBUG] Background sync timers stopped.');
    }
} 
