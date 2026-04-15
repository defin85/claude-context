import * as fs from "fs";
import { Context, FileSynchronizer } from "@zilliz/claude-context-core";
import { CodebaseConfigManager } from "./codebase-config.js";
import { SnapshotManager } from "./snapshot.js";
import { RuntimeStatusManager, RuntimeSyncCodebaseResult } from "./runtime-status.js";
import { WorkloadManager } from "./workload-manager.js";

export class SyncManager {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private codebaseConfigManager: CodebaseConfigManager;
    private runtimeStatusManager?: RuntimeStatusManager;
    private workloadManager?: WorkloadManager;
    private isSyncing: boolean = false;

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
                        ? await this.workloadManager.runBackgroundSync(codebasePath, () => this.context.reindexByChange(codebasePath))
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

        // Execute initial sync immediately after a short delay to let server initialize
        console.log('[SYNC-DEBUG] Scheduling initial sync in 5 seconds...');
        setTimeout(async () => {
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
        }, 5000); // Initial sync after 5 seconds

        // Periodically check for file changes and update the index
        console.log('[SYNC-DEBUG] Setting up periodic sync every 5 minutes (300000ms)');
        const syncInterval = setInterval(() => {
            console.log('[SYNC-DEBUG] Executing scheduled periodic sync');
            this.handleSyncIndex();
        }, 5 * 60 * 1000); // every 5 minutes

        console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', syncInterval);
    }
} 
