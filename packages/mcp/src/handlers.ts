import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { CodebaseSessionConfig, Context, COLLECTION_LIMIT_MESSAGE } from "@zilliz/claude-context-core";
import { CodebaseConfigManager } from "./codebase-config.js";
import { SnapshotManager } from "./snapshot.js";
import { RuntimeStatusManager } from "./runtime-status.js";
import { normalizeCodebasePath, truncateContent, trackCodebasePath } from "./utils.js";
import { CodebaseAccessPolicy } from "./access-policy.js";
import { WorkloadCancelledError, WorkloadManager, isWorkloadCancelledError } from "./workload-manager.js";

export class ToolHandlers {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private codebaseConfigManager: CodebaseConfigManager;
    private runtimeStatusManager?: RuntimeStatusManager;
    private accessPolicy: CodebaseAccessPolicy;
    private workloadManager?: WorkloadManager;
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;
    private currentWorkspace: string;

    constructor(
        context: Context,
        snapshotManager: SnapshotManager,
        codebaseConfigManager: CodebaseConfigManager,
        runtimeStatusManager?: RuntimeStatusManager,
        accessPolicy: CodebaseAccessPolicy = new CodebaseAccessPolicy({ mode: 'stdio' }),
        workloadManager?: WorkloadManager
    ) {
        this.context = context;
        this.snapshotManager = snapshotManager;
        this.codebaseConfigManager = codebaseConfigManager;
        this.runtimeStatusManager = runtimeStatusManager;
        this.accessPolicy = accessPolicy;
        this.workloadManager = workloadManager;
        this.currentWorkspace = process.cwd();
        console.log(`[WORKSPACE] Current workspace: ${this.currentWorkspace}`);
    }

    private hasKnownIndexStats(info: any): info is { indexedFiles: number; totalChunks: number; statsState?: 'known' | 'unknown' } {
        return info
            && info.statsState !== 'unknown'
            && typeof info.indexedFiles === 'number'
            && typeof info.totalChunks === 'number';
    }

    private getMerkleSnapshotPath(codebasePath: string): string {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        return path.join(os.homedir(), '.context', 'merkle', `${hash}.json`);
    }

    private getIndexedFileCountFromMerkle(codebasePath: string): number | undefined {
        const snapshotPath = this.getMerkleSnapshotPath(codebasePath);

        try {
            const snapshotData = fs.readFileSync(snapshotPath, 'utf-8');
            const snapshot = JSON.parse(snapshotData);

            if (!Array.isArray(snapshot?.fileHashes)) {
                console.warn(`[INDEX-STATS] Merkle snapshot is missing fileHashes array: ${snapshotPath}`);
                return undefined;
            }

            return snapshot.fileHashes.length;
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.warn(`[INDEX-STATS] Failed to read merkle snapshot for '${codebasePath}':`, error.message || error);
            }
            return undefined;
        }
    }

    private parseCountQueryResult(rows: Record<string, any>[]): number | undefined {
        if (!Array.isArray(rows) || rows.length === 0) {
            return undefined;
        }

        const parseNumericValue = (value: any): number | undefined => {
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }

            if (typeof value === 'string') {
                const parsed = Number(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            if (typeof value === 'bigint') {
                const parsed = Number(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            if (value && typeof value.toString === 'function') {
                const parsed = Number(value.toString());
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            return undefined;
        };

        const row = rows[0];
        const exactMatch = parseNumericValue(row?.['count(*)']);
        if (typeof exactMatch === 'number') {
            return exactMatch;
        }

        for (const value of Object.values(row || {})) {
            const parsed = parseNumericValue(value);
            if (typeof parsed === 'number') {
                return parsed;
            }
        }

        return undefined;
    }

    private async getTotalChunkCountFromCollection(codebasePath: string): Promise<number | undefined> {
        try {
            const collectionName = this.context.getCollectionName(codebasePath);
            const rows = await this.context.getVectorDatabase().query(collectionName, undefined, ['count(*)']);
            const totalChunks = this.parseCountQueryResult(rows);

            if (typeof totalChunks === 'number') {
                return totalChunks;
            }

            console.warn(`[INDEX-STATS] Could not parse count(*) result for collection '${collectionName}'`);
            return undefined;
        } catch (error: any) {
            console.warn(
                `[INDEX-STATS] Failed to query total chunk count for '${codebasePath}':`,
                error.message || error
            );
            return undefined;
        }
    }

    private async tryRecoverIndexStats(
        codebasePath: string,
        indexStatus: 'completed' | 'limit_reached' = 'completed'
    ): Promise<{ indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' } | null> {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const indexedFiles = this.getIndexedFileCountFromMerkle(normalizedPath);
        const totalChunks = await this.getTotalChunkCountFromCollection(normalizedPath);

        if (typeof indexedFiles === 'number' && typeof totalChunks === 'number') {
            console.log(
                `[INDEX-STATS] Recovered stats for '${normalizedPath}': ` +
                `${indexedFiles} files, ${totalChunks} chunks`
            );
            return {
                indexedFiles,
                totalChunks,
                status: indexStatus
            };
        }

        const missingParts: string[] = [];
        if (typeof indexedFiles !== 'number') {
            missingParts.push('indexedFiles');
        }
        if (typeof totalChunks !== 'number') {
            missingParts.push('totalChunks');
        }

        console.warn(
            `[INDEX-STATS] Could not fully recover stats for '${normalizedPath}'. Missing: ${missingParts.join(', ')}`
        );
        return null;
    }

    private async restoreIndexedSnapshotEntry(
        codebasePath: string,
        saveReason: string,
        indexStatus: 'completed' | 'limit_reached' = 'completed'
    ): Promise<'restored-with-stats' | 'restored-without-stats' | 'skipped-live-owner'> {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const recoveredStats = await this.tryRecoverIndexStats(normalizedPath, indexStatus);
        const restoreResult = await this.snapshotManager.restoreIndexedCodebaseFromCloud(
            normalizedPath,
            recoveredStats || undefined,
            indexStatus
        );

        if (restoreResult !== 'skipped-live-owner') {
            await this.runtimeStatusManager?.refresh(saveReason);
        }

        return restoreResult;
    }

    private createLostCollectionError(codebasePath: string) {
        return {
            content: [{
                type: "text",
                text: `Error: Index data for '${codebasePath}' has been lost (collection not found in Milvus). Please re-index using index_codebase with force=true.`
            }],
            isError: true
        };
    }

    private formatOwnerForMessage(owner: { runtimeId: string; pid: number; heartbeatAt: string } | undefined): string {
        if (!owner) {
            return 'owner metadata is unavailable';
        }

        return `runtime=${owner.runtimeId}, pid=${owner.pid}, heartbeat=${owner.heartbeatAt}`;
    }

    private createBlockedIndexingResponse(
        codebasePath: string,
        ownershipState: { state: string; currentOwner?: { runtimeId: string; pid: number; heartbeatAt: string } }
    ) {
        const ownerScope = ownershipState.state === 'owned-by-current-runtime'
            ? 'this MCP runtime'
            : 'another MCP runtime';

        return {
            content: [{
                type: "text",
                text: `Codebase '${codebasePath}' is already being indexed by ${ownerScope}. ${this.formatOwnerForMessage(ownershipState.currentOwner)}`
            }],
            isError: true
        };
    }

    private async waitForCurrentRuntimeIndexingToStop(
        codebasePath: string,
        timeoutMs: number = 15000,
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const ownershipState = await this.snapshotManager.inspectIndexingOwnership(codebasePath);
            if (ownershipState.state !== 'owned-by-current-runtime') {
                return true;
            }

            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return false;
    }

    private async cancelCurrentRuntimeIndexingForClear(codebasePath: string): Promise<{ cancelled: boolean; error?: string }> {
        if (!this.workloadManager) {
            return {
                cancelled: false,
                error: 'clear_index cannot cancel active indexing because this runtime has no workload manager.'
            };
        }

        const reason = `Cancelled by clear_index for '${codebasePath}'.`;
        const cancellation = this.workloadManager.cancelCodebaseIndexingWork(codebasePath, reason);

        if (cancellation.queued.length === 0 && cancellation.active.length === 0) {
            return {
                cancelled: false,
                error: 'No queued or active indexing workload was found for this runtime.'
            };
        }

        if (cancellation.active.length === 0 && cancellation.queued.length > 0) {
            await this.snapshotManager.failIndexingOwnership(codebasePath, reason);
        }

        const stopped = await this.waitForCurrentRuntimeIndexingToStop(codebasePath);
        if (!stopped) {
            return {
                cancelled: true,
                error: 'Timed out waiting for this runtime indexing task to stop.'
            };
        }

        await this.runtimeStatusManager?.refresh('clear-index-cancelled-active-indexing');
        return { cancelled: true };
    }

    private createPersistedSessionConfig(
        customExtensions: string[],
        customIgnorePatterns: string[]
    ): CodebaseSessionConfig {
        return {
            customExtensions,
            customIgnorePatterns
        };
    }

    private startOwnershipHeartbeat(codebasePath: string): { stop: () => void } {
        const heartbeatIntervalMs = this.snapshotManager.getOwnershipHeartbeatIntervalMs();
        const heartbeatTimer = setInterval(() => {
            void this.snapshotManager.refreshIndexingOwnership(codebasePath).then((refreshed) => {
                if (!refreshed) {
                    console.warn(`[INDEX-OWNERSHIP] Heartbeat refresh lost ownership for '${codebasePath}'.`);
                }
            }).catch((error: any) => {
                console.error(`[INDEX-OWNERSHIP] Heartbeat refresh failed for '${codebasePath}':`, error);
            });
        }, heartbeatIntervalMs);
        heartbeatTimer.unref?.();

        return {
            stop: () => {
                clearInterval(heartbeatTimer);
            }
        };
    }

    private createAccessDeniedResponse(absolutePath: string) {
        const allowedRoots = this.accessPolicy.getAllowedRoots();
        const allowedRootsSuffix = allowedRoots.length > 0
            ? ` Allowed roots: ${allowedRoots.join(', ')}`
            : '';

        return {
            content: [{
                type: 'text',
                text: `Error: Access to codebase '${absolutePath}' is outside the configured daemon allowlist.${allowedRootsSuffix}`
            }],
            isError: true
        };
    }

    private enforceAccessPolicy(codebasePath: string) {
        const decision = this.accessPolicy.evaluateCodebasePath(codebasePath);
        if (!decision.allowed) {
            return {
                absolutePath: decision.absolutePath,
                response: this.createAccessDeniedResponse(decision.absolutePath)
            };
        }

        return {
            absolutePath: decision.absolutePath,
            response: null
        };
    }

    /**
     * Best-effort cloud sync for diagnostics.
     *
     * IMPORTANT SAFETY RULE:
     * Never remove local snapshot entries based only on cloud list/query results.
     * Different CLI sessions may run with different credentials/clusters, and
     * transient cloud visibility issues can cause false negatives.
     */
    private async syncIndexedCodebasesFromCloud(): Promise<void> {
        try {
            console.log(`[SYNC-CLOUD] 🔄 Syncing indexed codebases from Zilliz Cloud...`);

            const vectorDb = this.context.getVectorDatabase();
            const collections = await vectorDb.listCollections();

            console.log(`[SYNC-CLOUD] 📋 Found ${collections.length} collections in Zilliz Cloud`);

            if (collections.length === 0) {
                console.warn(`[SYNC-CLOUD] ⚠️  Cloud returned zero collections. Skipping local snapshot cleanup to avoid false negatives.`);
                return;
            }

            const cloudCodebases = new Set<string>();
            let codeCollectionsChecked = 0;
            let successfulExtractions = 0;

            for (const collectionName of collections) {
                try {
                    if (!collectionName.startsWith('code_chunks_') && !collectionName.startsWith('hybrid_code_chunks_')) {
                        console.log(`[SYNC-CLOUD] ⏭️  Skipping non-code collection: ${collectionName}`);
                        continue;
                    }

                    codeCollectionsChecked++;
                    console.log(`[SYNC-CLOUD] 🔍 Checking collection: ${collectionName}`);

                    let extracted = false;
                    try {
                        const description = await vectorDb.getCollectionDescription(collectionName);
                        if (description && description.startsWith('codebasePath:')) {
                            const codebasePath = description.substring('codebasePath:'.length);
                            if (codebasePath.length > 0) {
                                const normalizedPath = normalizeCodebasePath(codebasePath);
                                console.log(`[SYNC-CLOUD] 📍 Found codebase path from description: ${normalizedPath} in collection: ${collectionName}`);
                                cloudCodebases.add(normalizedPath);
                                successfulExtractions++;
                                extracted = true;
                            }
                        }
                    } catch (descError: any) {
                        console.warn(`[SYNC-CLOUD] ⚠️  Failed to get description for collection ${collectionName}:`, descError.message || descError);
                    }

                    if (!extracted) {
                        console.log(`[SYNC-CLOUD] 🔄 Falling back to query-based extraction for collection: ${collectionName}`);
                        try {
                            const results = await vectorDb.query(
                                collectionName,
                                undefined,
                                ['metadata'],
                                1
                            );

                            if (results && results.length > 0) {
                                const firstResult = results[0];
                                const metadataStr = firstResult.metadata;

                                if (metadataStr) {
                                    const metadata = JSON.parse(metadataStr);
                                    const codebasePath = metadata.codebasePath;

                                    if (codebasePath && typeof codebasePath === 'string') {
                                        const normalizedPath = normalizeCodebasePath(codebasePath);
                                        console.log(`[SYNC-CLOUD] 📍 Found codebase path from query: ${normalizedPath} in collection: ${collectionName}`);
                                        cloudCodebases.add(normalizedPath);
                                        successfulExtractions++;
                                    } else {
                                        console.warn(`[SYNC-CLOUD] ⚠️  No codebasePath found in metadata for collection: ${collectionName}`);
                                    }
                                } else {
                                    console.warn(`[SYNC-CLOUD] ⚠️  No metadata found in collection: ${collectionName}`);
                                }
                            } else {
                                console.log(`[SYNC-CLOUD] ℹ️  Collection ${collectionName} is empty`);
                            }
                        } catch (queryError: any) {
                            console.warn(`[SYNC-CLOUD] ⚠️  Fallback query failed for collection ${collectionName}:`, queryError.message || queryError);
                        }
                    }
                } catch (collectionError: any) {
                    console.warn(`[SYNC-CLOUD] ⚠️  Error checking collection ${collectionName}:`, collectionError.message || collectionError);
                }
            }

            console.log(`[SYNC-CLOUD] 📊 Found ${cloudCodebases.size} valid codebases in cloud (checked ${codeCollectionsChecked} code collections, ${successfulExtractions} successfully extracted)`);

            if (codeCollectionsChecked > 0 && successfulExtractions === 0) {
                console.warn(`[SYNC-CLOUD] ⚠️  All ${codeCollectionsChecked} code collection extractions failed. Skipping sync to avoid accidental deletion of local codebases.`);
                return;
            }

            const localCodebases = this.snapshotManager.getIndexedCodebases();
            console.log(`[SYNC-CLOUD] 📊 Found ${localCodebases.length} local codebases in snapshot`);

            const missingInCloud = localCodebases.filter((localCodebase) => !cloudCodebases.has(localCodebase));
            if (missingInCloud.length > 0) {
                console.warn(
                    `[SYNC-CLOUD] ⚠️  ${missingInCloud.length} local codebase(s) were not found in cloud metadata. ` +
                    `Keeping local snapshot unchanged for safety.`
                );
            }

            console.log(`[SYNC-CLOUD] ℹ️  Cloud sync is non-destructive; local snapshot was not modified.`);
            console.log(`[SYNC-CLOUD] ✅ Cloud sync completed successfully`);
        } catch (error: any) {
            console.error(`[SYNC-CLOUD] ❌ Error syncing codebases from cloud:`, error.message || error);
        }
    }

    public async handleIndexCodebase(args: any) {
        const { path: codebasePath, force, splitter, customExtensions, ignorePatterns } = args;
        const forceReindex = force || false;
        const splitterType = splitter || 'ast'; // Default to AST
        const customFileExtensions = customExtensions || [];
        const customIgnorePatterns = ignorePatterns || [];
        const persistedSessionConfig = this.createPersistedSessionConfig(customFileExtensions, customIgnorePatterns);
        let ownershipClaimed = false;
        let claimedCodebasePath: string | null = null;

        try {
            // Sync indexed codebases from cloud first
            await this.syncIndexedCodebasesFromCloud();

            // Validate splitter parameter
            if (splitterType !== 'ast' && splitterType !== 'langchain') {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Invalid splitter type '${splitterType}'. Must be 'ast' or 'langchain'.`
                    }],
                    isError: true
                };
            }
            // Force absolute path resolution - warn if relative path provided
            const accessDecision = this.enforceAccessPolicy(codebasePath);
            if (accessDecision.response) {
                return accessDecision.response;
            }
            const absolutePath = accessDecision.absolutePath;

            // Validate path exists
            if (!fs.existsSync(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            const ownershipState = await this.snapshotManager.inspectIndexingOwnership(absolutePath);
            if (ownershipState.state === 'owned-by-current-runtime' || ownershipState.state === 'blocked-live-owner') {
                return this.createBlockedIndexingResponse(absolutePath, ownershipState);
            }

            const snapshotHasIndex = this.snapshotManager.getIndexedCodebases().includes(absolutePath);
            const cloudHasIndex = await this.context.hasIndex(absolutePath);
            const hasPersistedSyncConfig = await this.codebaseConfigManager.hasConfig(absolutePath);

            // Reconcile local snapshot with cloud truth for this specific codebase
            if (snapshotHasIndex !== cloudHasIndex) {
                console.warn(`[INDEX-VALIDATION] ❌ Snapshot and cloud index mismatch: ${absolutePath}`);
                if (cloudHasIndex && !snapshotHasIndex) {
                    const restoreResult = await this.restoreIndexedSnapshotEntry(
                        absolutePath,
                        'index-reconcile-cloud-present'
                    );
                    if (restoreResult === 'skipped-live-owner') {
                        const latestOwnershipState = await this.snapshotManager.inspectIndexingOwnership(absolutePath);
                        if (latestOwnershipState.state === 'owned-by-current-runtime' || latestOwnershipState.state === 'blocked-live-owner') {
                            return this.createBlockedIndexingResponse(absolutePath, latestOwnershipState);
                        }
                        console.warn(
                            `[INDEX-VALIDATION] Skipped cloud snapshot reconcile for '${absolutePath}' because live indexing ownership changed during the request.`
                        );
                    } else {
                        console.log(
                            `[INDEX-VALIDATION] 🛠️  Recovered missing snapshot entry from cloud index: ${absolutePath}` +
                            (restoreResult === 'restored-with-stats' ? ' (with recovered stats)' : '')
                        );
                    }
                } else if (!cloudHasIndex && snapshotHasIndex) {
                    this.snapshotManager.removeCodebaseCompletely(absolutePath);
                    await this.snapshotManager.saveCodebaseSnapshot('index-reconcile-cloud-missing');
                    console.log(`[INDEX-VALIDATION] 🧹 Removed stale snapshot entry without cloud index: ${absolutePath}`);
                }
            }

            // Check if already indexed in cloud (unless force is true)
            if (!forceReindex && cloudHasIndex) {
                if (!hasPersistedSyncConfig) {
                    return {
                        content: [{
                            type: "text",
                            text: `Codebase '${absolutePath}' is already indexed, but its local per-codebase sync config is missing. Re-run index_codebase with force=true to restore restart-safe incremental sync.`
                        }],
                        isError: true
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Codebase '${absolutePath}' is already indexed. Use force=true to re-index.`
                    }],
                    isError: true
                };
            }

            // CRITICAL: Pre-index collection creation validation
            try {
                console.log(`[INDEX-VALIDATION] 🔍 Validating collection creation capability`);
                const canCreateCollection = await this.context.getVectorDatabase().checkCollectionLimit();

                if (!canCreateCollection) {
                    console.error(`[INDEX-VALIDATION] ❌ Collection limit validation failed: ${absolutePath}`);

                    // CRITICAL: Immediately return the COLLECTION_LIMIT_MESSAGE to MCP client
                    return {
                        content: [{
                            type: "text",
                            text: COLLECTION_LIMIT_MESSAGE
                        }],
                        isError: true
                    };
                }

                console.log(`[INDEX-VALIDATION] ✅  Collection creation validation completed`);
            } catch (validationError: any) {
                // Handle other collection creation errors
                console.error(`[INDEX-VALIDATION] ❌ Collection creation validation failed:`, validationError);
                return {
                    content: [{
                        type: "text",
                        text: `Error validating collection creation: ${validationError.message || validationError}`
                    }],
                    isError: true
                };
            }

            const ownershipClaim = await this.snapshotManager.acquireIndexingOwnership(absolutePath, 0);
            if (!ownershipClaim.acquired) {
                return {
                    content: [{
                        type: "text",
                        text: `Codebase '${absolutePath}' is already being indexed by another MCP runtime. ${this.formatOwnerForMessage(ownershipClaim.currentOwner)}`
                    }],
                    isError: true
                };
            }

            ownershipClaimed = true;
            claimedCodebasePath = absolutePath;

            if (ownershipClaim.reason === 'reclaimed-stale-owner') {
                console.warn(
                    `[INDEX-OWNERSHIP] Reclaimed stale indexing ownership for '${absolutePath}'. ` +
                    `Previous owner: ${this.formatOwnerForMessage(
                        ownershipClaim.previousInfo?.status === 'indexing' ? ownershipClaim.previousInfo.owner : undefined
                    )}`
                );
            } else {
                console.log(
                    `[INDEX-OWNERSHIP] Acquired indexing ownership for '${absolutePath}'. ` +
                    `${this.formatOwnerForMessage(ownershipClaim.currentOwner)}`
                );
            }

            await this.runtimeStatusManager?.refresh('index-ownership-acquired');

            // If force reindex and codebase is already indexed, clear cloud state only after ownership is secured.
            if (forceReindex && cloudHasIndex) {
                console.log(`[FORCE-REINDEX] 🔄 Clearing index for '${absolutePath}'`);
                await this.context.clearIndex(absolutePath);
            }

            this.context.configureCodebaseSession(absolutePath, persistedSessionConfig);
            await this.codebaseConfigManager.saveConfig(absolutePath, persistedSessionConfig);
            await this.runtimeStatusManager?.refresh('codebase-sync-config-saved');

            // Check current status and log if retrying after failure
            if (ownershipClaim.previousInfo?.status === 'indexfailed') {
                const failedInfo = ownershipClaim.previousInfo as any;
                console.log(`[BACKGROUND-INDEX] Retrying indexing for previously failed codebase. Previous error: ${failedInfo?.errorMessage || 'Unknown error'}`);
            }

            // Track the codebase path for syncing
            trackCodebasePath(absolutePath);
            await this.runtimeStatusManager?.refresh('index-started');

            const ownershipHeartbeat = this.startOwnershipHeartbeat(absolutePath);
            const runIndexingJob = async (signal: AbortSignal) => {
                try {
                    await this.startBackgroundIndexing(absolutePath, forceReindex, splitterType, signal);
                } finally {
                    ownershipHeartbeat.stop();
                }
            };

            const queuedIndexingJob = this.workloadManager
                ? this.workloadManager.enqueueInteractiveIndexing(absolutePath, runIndexingJob)
                : {
                    startedImmediately: true,
                    queuePosition: 0,
                    completion: runIndexingJob(new AbortController().signal)
                };

            void queuedIndexingJob.completion.catch((error: any) => {
                console.error(`[BACKGROUND-INDEX] Queued indexing task failed for '${absolutePath}':`, error?.message || error);
            });

            const pathInfo = codebasePath !== absolutePath
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            const extensionInfo = customFileExtensions.length > 0
                ? `\nUsing ${customFileExtensions.length} custom extensions: ${customFileExtensions.join(', ')}`
                : '';

            const ignoreInfo = customIgnorePatterns.length > 0
                ? `\nUsing ${customIgnorePatterns.length} custom ignore patterns: ${customIgnorePatterns.join(', ')}`
                : '';

            const queueInfo = queuedIndexingJob.startedImmediately
                ? `\nIndexing started immediately.`
                : `\nIndexing request queued at position ${queuedIndexingJob.queuePosition}. Ownership is reserved in this runtime while the job waits for an indexing slot.`;

            return {
                content: [{
                    type: "text",
                    text: `Started background indexing for codebase '${absolutePath}' using ${splitterType.toUpperCase()} splitter.${pathInfo}${extensionInfo}${ignoreInfo}${queueInfo}\n\nIndexing is running in the background. You can search the codebase while indexing is in progress, but results may be incomplete until indexing completes.`
                }],
                structuredContent: {
                    path: absolutePath,
                    originalPath: codebasePath,
                    force: forceReindex,
                    splitter: splitterType,
                    customExtensions: customFileExtensions,
                    ignorePatterns: customIgnorePatterns,
                    startedImmediately: queuedIndexingJob.startedImmediately,
                    queuePosition: queuedIndexingJob.queuePosition
                }
            };

        } catch (error: any) {
            // Enhanced error handling to prevent MCP service crash
            console.error('Error in handleIndexCodebase:', error);

            if (ownershipClaimed && claimedCodebasePath) {
                try {
                    await this.snapshotManager.failIndexingOwnership(
                        claimedCodebasePath,
                        error.message || String(error)
                    );
                    await this.runtimeStatusManager?.refresh('index-start-failed');
                } catch (ownershipError: any) {
                    console.error(`[INDEX-OWNERSHIP] Failed to release ownership for '${claimedCodebasePath}':`, ownershipError);
                }
            }

            // Ensure we always return a proper MCP response, never throw
            return {
                content: [{
                    type: "text",
                    text: `Error starting indexing: ${error.message || error}`
                }],
                isError: true
            };
        }
    }

    private async startBackgroundIndexing(
        codebasePath: string,
        forceReindex: boolean,
        splitterType: string,
        abortSignal?: AbortSignal
    ) {
        const absolutePath = codebasePath;
        let lastPersistedProgress = -1;
        const throwIfCancelled = () => {
            if (!abortSignal?.aborted) {
                return;
            }

            const reason = abortSignal.reason;
            if (reason instanceof Error) {
                throw reason;
            }

            throw new WorkloadCancelledError(
                typeof reason === 'string' && reason.trim().length > 0
                    ? reason
                    : `Indexing for '${absolutePath}' was cancelled by daemon operator.`
            );
        };

        try {
            throwIfCancelled();
            console.log(`[BACKGROUND-INDEX] Starting background indexing for: ${absolutePath}`);
            await this.runtimeStatusManager?.refresh('index-background-starting');

            // Note: If force reindex, collection was already cleared during validation phase
            if (forceReindex) {
                console.log(`[BACKGROUND-INDEX] ℹ️  Force reindex mode - collection was already cleared during validation`);
            }

            const persistedConfig = await this.codebaseConfigManager.getConfig(absolutePath);
            if (!persistedConfig) {
                throw new Error(`Persisted codebase sync config is missing for '${absolutePath}'. Re-run index_codebase with force=true.`);
            }
            throwIfCancelled();

            this.context.configureCodebaseSession(absolutePath, persistedConfig);

            // Use the existing Context instance for indexing.
            let contextForThisTask = this.context;
            if (splitterType !== 'ast') {
                console.warn(`[BACKGROUND-INDEX] Non-AST splitter '${splitterType}' requested; falling back to AST splitter`);
            }

            // Load ignore patterns from files first (including .ignore, .gitignore, etc.)
            await this.context.getLoadedIgnorePatterns(absolutePath);
            throwIfCancelled();

            // Initialize file synchronizer with proper ignore patterns (including project-specific patterns)
            const { FileSynchronizer } = await import("@zilliz/claude-context-core");
            const ignorePatterns = this.context.getIgnorePatterns(absolutePath) || [];
            const supportedExtensions = this.context.getSupportedExtensions(absolutePath) || [];
            console.log(`[BACKGROUND-INDEX] Using ignore patterns: ${ignorePatterns.join(', ')}`);
            const synchronizer = new FileSynchronizer(absolutePath, ignorePatterns, supportedExtensions);
            await synchronizer.initialize();
            throwIfCancelled();

            // Store synchronizer in the context (let context manage collection names)
            await this.context.getPreparedCollection(absolutePath);
            const collectionName = this.context.getCollectionName(absolutePath);
            this.context.setSynchronizerForCodebase(absolutePath, synchronizer);
            if (contextForThisTask !== this.context) {
                contextForThisTask.setSynchronizer(collectionName, synchronizer);
            }

            console.log(`[BACKGROUND-INDEX] Starting indexing with ${splitterType} splitter for: ${absolutePath}`);

            // Log embedding provider information before indexing
            const embeddingProvider = this.context.getEmbedding();
            console.log(`[BACKGROUND-INDEX] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} with dimension: ${embeddingProvider.getDimension()}`);

            // Start indexing with the appropriate context and progress tracking
            console.log(`[BACKGROUND-INDEX] 🚀 Beginning codebase indexing process...`);
            const stats = await contextForThisTask.indexCodebase(absolutePath, (progress) => {
                throwIfCancelled();
                // Update progress in snapshot manager using new method
                this.snapshotManager.setCodebaseIndexing(absolutePath, progress.percentage);

                // Coalesce disk writes: persist only meaningful progress jumps.
                const shouldPersistProgress =
                    lastPersistedProgress < 0 ||
                    progress.percentage >= 100 ||
                    Math.abs(progress.percentage - lastPersistedProgress) >= 2;

                if (shouldPersistProgress) {
                    this.snapshotManager.scheduleSaveCodebaseSnapshot('index-progress');
                    lastPersistedProgress = progress.percentage;
                    console.log(`[BACKGROUND-INDEX] 💾 Scheduled progress snapshot at ${progress.percentage.toFixed(1)}%`);
                }

                console.log(`[BACKGROUND-INDEX] Progress: ${progress.phase} - ${progress.percentage}% (${progress.current}/${progress.total})`);
            }, forceReindex, abortSignal);
            console.log(`[BACKGROUND-INDEX] ✅ Indexing completed successfully! Files: ${stats.indexedFiles}, Chunks: ${stats.totalChunks}`);
            this.indexingStats = { indexedFiles: stats.indexedFiles, totalChunks: stats.totalChunks };

            const completed = await this.snapshotManager.completeIndexingOwnership(absolutePath, stats);
            if (!completed) {
                console.warn(`[INDEX-OWNERSHIP] Background indexing finished for '${absolutePath}' but ownership completion was rejected.`);
            }
            await this.runtimeStatusManager?.refresh('index-completed');

            let message = `Background indexing completed for '${absolutePath}' using ${splitterType.toUpperCase()} splitter.\nIndexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks.`;
            if (stats.status === 'limit_reached') {
                message += `\n⚠️  Warning: Indexing stopped because the chunk limit (450,000) was reached. The index may be incomplete.`;
            }

            console.log(`[BACKGROUND-INDEX] ${message}`);

        } catch (error: any) {
            console.error(`[BACKGROUND-INDEX] Error during indexing for ${absolutePath}:`, error);

            // Get the last attempted progress
            const lastProgress = this.snapshotManager.getIndexingProgress(absolutePath);

            const errorMessage = isWorkloadCancelledError(error)
                ? (error.message || `Indexing for '${absolutePath}' was cancelled by daemon operator.`)
                : (error.message || String(error));
            const failed = await this.snapshotManager.failIndexingOwnership(absolutePath, errorMessage, lastProgress);
            if (!failed) {
                console.warn(`[INDEX-OWNERSHIP] Background indexing failed for '${absolutePath}' but ownership failure update was rejected.`);
            }
            await this.runtimeStatusManager?.refresh('index-failed');

            // Log error but don't crash MCP service - indexing errors are handled gracefully
            console.error(`[BACKGROUND-INDEX] Indexing failed for ${absolutePath}: ${errorMessage}`);
        }
    }

    public async handleSearchCode(args: any) {
        const { path: codebasePath, query, limit = 10, extensionFilter } = args;
        const resultLimit = limit || 10;
        const executeSearch = async () => {
            try {
                // Sync indexed codebases from cloud first
                await this.syncIndexedCodebasesFromCloud();

                // Force absolute path resolution - warn if relative path provided
                const accessDecision = this.enforceAccessPolicy(codebasePath);
                if (accessDecision.response) {
                    return accessDecision.response;
                }
                const absolutePath = accessDecision.absolutePath;

                // Validate path exists
                if (!fs.existsSync(absolutePath)) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                        }],
                        isError: true
                    };
                }

                // Check if it's a directory
                const stat = fs.statSync(absolutePath);
                if (!stat.isDirectory()) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error: Path '${absolutePath}' is not a directory`
                        }],
                        isError: true
                    };
                }

                trackCodebasePath(absolutePath);

                // Check status with cloud as source of truth and snapshot as progress source
                const isIndexedInSnapshot = this.snapshotManager.getIndexedCodebases().includes(absolutePath);
                const isIndexing = this.snapshotManager.getIndexingCodebases().includes(absolutePath);
                const hasCloudIndex = await this.context.hasIndex(absolutePath);

                // Self-heal snapshot if index exists in cloud but local snapshot is missing
                if (hasCloudIndex && !isIndexedInSnapshot && !isIndexing) {
                    const restoreResult = await this.restoreIndexedSnapshotEntry(
                        absolutePath,
                        'search-reconcile-cloud-present'
                    );
                    if (restoreResult === 'skipped-live-owner') {
                        console.log(`[SEARCH] ⏭️ Skipped cloud snapshot restore for '${absolutePath}' because a live owner is indexing.`);
                    } else {
                        console.log(
                            `[SEARCH] 🛠️ Restored missing snapshot entry from cloud index for: ${absolutePath}` +
                            (restoreResult === 'restored-with-stats' ? ' (with recovered stats)' : '')
                        );
                    }
                }

                if (!hasCloudIndex && isIndexedInSnapshot && !isIndexing) {
                    const collectionName = this.context.getCollectionName(absolutePath);
                    const hasCollection = await this.context.getVectorDatabase().hasCollection(collectionName);
                    if (!hasCollection) {
                        return this.createLostCollectionError(absolutePath);
                    }
                }

                if (!hasCloudIndex && !isIndexing && !isIndexedInSnapshot) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error: Codebase '${absolutePath}' is not indexed. Please index it first using the index_codebase tool.`
                        }],
                        isError: true
                    };
                }

                // Show indexing status if codebase is being indexed
                let indexingStatusMessage = '';
                if (isIndexing) {
                    indexingStatusMessage = `\n⚠️  **Indexing in Progress**: This codebase is currently being indexed in the background. Search results may be incomplete until indexing completes.`;
                }

                console.log(`[SEARCH] Searching in codebase: ${absolutePath}`);
                console.log(`[SEARCH] Query: "${query}"`);
                console.log(`[SEARCH] Indexing status: ${isIndexing ? 'In Progress' : (hasCloudIndex ? 'Completed' : 'No collection yet')}`);

                // Log embedding provider information before search
                const embeddingProvider = this.context.getEmbedding();
                console.log(`[SEARCH] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} for search`);
                console.log(`[SEARCH] 🔍 Generating embeddings for query using ${embeddingProvider.getProvider()}...`);

                // Build filter expression from extensionFilter list
                let filterExpr: string | undefined = undefined;
                if (Array.isArray(extensionFilter) && extensionFilter.length > 0) {
                    const cleaned = extensionFilter
                        .filter((v: any) => typeof v === 'string')
                        .map((v: string) => v.trim())
                        .filter((v: string) => v.length > 0);
                    const invalid = cleaned.filter((e: string) => !(e.startsWith('.') && e.length > 1 && !/\s/.test(e)));
                    if (invalid.length > 0) {
                        return {
                            content: [{ type: 'text', text: `Error: Invalid file extensions in extensionFilter: ${JSON.stringify(invalid)}. Use proper extensions like '.ts', '.py'.` }],
                            isError: true
                        };
                    }
                    const quoted = cleaned.map((e: string) => `'${e}'`).join(', ');
                    filterExpr = `fileExtension in [${quoted}]`;
                }

                // Search in the specified codebase
                const searchResults = await this.context.semanticSearch(
                    absolutePath,
                    query,
                    Math.min(resultLimit, 50),
                    0.3,
                    filterExpr
                );

                console.log(`[SEARCH] ✅ Search completed! Found ${searchResults.length} results using ${embeddingProvider.getProvider()} embeddings`);

                if (searchResults.length === 0) {
                    // Check if collection was lost (indexed locally but missing in Milvus)
                    if ((isIndexedInSnapshot || hasCloudIndex) && !isIndexing) {
                        const collectionName = this.context.getCollectionName(absolutePath);
                        const hasCollection = await this.context.getVectorDatabase().hasCollection(collectionName);
                        if (!hasCollection) {
                            return this.createLostCollectionError(absolutePath);
                        }
                    }

                    let noResultsMessage = `No results found for query: "${query}" in codebase '${absolutePath}'`;
                    if (isIndexing) {
                        noResultsMessage += `\n\nNote: This codebase is still being indexed. Try searching again after indexing completes, or the query may not match any indexed content.`;
                    }
                    return {
                        content: [{
                            type: "text",
                            text: noResultsMessage
                        }],
                        structuredContent: {
                            path: absolutePath,
                            query,
                            limit: Math.min(resultLimit, 50),
                            indexingStatus: isIndexing ? 'indexing' : 'indexed',
                            results: []
                        }
                    };
                }

                // Format results
                const formattedResults = searchResults.map((result: any, index: number) => {
                    const location = `${result.relativePath}:${result.startLine}-${result.endLine}`;
                    const context = truncateContent(result.content, 5000);
                    const codebaseInfo = path.basename(absolutePath);

                    return `${index + 1}. Code snippet (${result.language}) [${codebaseInfo}]\n` +
                        `   Location: ${location}\n` +
                        `   Rank: ${index + 1}\n` +
                        `   Context: \n\`\`\`${result.language}\n${context}\n\`\`\`\n`;
                }).join('\n');

                let resultMessage = `Found ${searchResults.length} results for query: "${query}" in codebase '${absolutePath}'${indexingStatusMessage}\n\n${formattedResults}`;

                if (isIndexing) {
                    resultMessage += `\n\n💡 **Tip**: This codebase is still being indexed. More results may become available as indexing progresses.`;
                }

                return {
                    content: [{
                        type: "text",
                        text: resultMessage
                    }],
                    structuredContent: {
                        path: absolutePath,
                        query,
                        limit: Math.min(resultLimit, 50),
                        indexingStatus: isIndexing ? 'indexing' : 'indexed',
                        results: searchResults.map((result: any) => ({
                            relativePath: result.relativePath,
                            language: result.language,
                            startLine: result.startLine,
                            endLine: result.endLine,
                            score: result.score,
                            content: result.content
                        }))
                    }
                };
            } catch (error) {
                // Check if this is the collection limit error
                // Handle both direct string throws and Error objects containing the message
                const errorMessage = typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error));

                if (errorMessage === COLLECTION_LIMIT_MESSAGE || errorMessage.includes(COLLECTION_LIMIT_MESSAGE)) {
                    // Return the collection limit message as a successful response
                    // This ensures LLM treats it as final answer, not as retryable error
                    return {
                        content: [{
                            type: "text",
                            text: COLLECTION_LIMIT_MESSAGE
                        }]
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Error searching code: ${errorMessage} Please check if the codebase has been indexed first.`
                    }],
                    isError: true
                };
            }
        };

        if (!this.workloadManager) {
            return executeSearch();
        }

        const searchCodebasePath = typeof codebasePath === 'string' && codebasePath.length > 0
            ? codebasePath
            : this.currentWorkspace;
        return this.workloadManager.runSearch(searchCodebasePath, executeSearch);
    }

    public async handleClearIndex(args: any) {
        const { path: codebasePath } = args;

        try {
            // Force absolute path resolution - warn if relative path provided
            const accessDecision = this.enforceAccessPolicy(codebasePath);
            if (accessDecision.response) {
                return accessDecision.response;
            }
            const absolutePath = accessDecision.absolutePath;

            // Validate path exists
            if (!fs.existsSync(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            // Check if this codebase is indexed, indexing, or otherwise tracked in the snapshot.
            const snapshotStatus = this.snapshotManager.getCodebaseStatus(absolutePath);
            const isIndexed = snapshotStatus === 'indexed';
            const isIndexing = snapshotStatus === 'indexing';
            const hasTrackedSnapshotState = snapshotStatus !== 'not_found';
            const hasCloudIndex = await this.context.hasIndex(absolutePath);
            const ownershipState = await this.snapshotManager.inspectIndexingOwnership(absolutePath);

            if (!hasTrackedSnapshotState && !hasCloudIndex) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Codebase '${absolutePath}' is not indexed or being indexed.`
                    }],
                    isError: true
                };
            }

            if (ownershipState.state === 'owned-by-current-runtime') {
                const cancellation = await this.cancelCurrentRuntimeIndexingForClear(absolutePath);
                if (cancellation.error) {
                    return {
                        content: [{
                            type: "text",
                            text:
                                `Error: Codebase '${absolutePath}' is currently being indexed by this MCP runtime. ` +
                                `${cancellation.error} ${this.formatOwnerForMessage(ownershipState.currentOwner)}`
                        }],
                        isError: true
                    };
                }
            } else if (ownershipState.state === 'blocked-live-owner') {
                const ownerDescription = this.formatOwnerForMessage(ownershipState.currentOwner);

                return {
                    content: [{
                        type: "text",
                        text:
                            `Error: Codebase '${absolutePath}' is currently being indexed by another MCP runtime. ` +
                            `clear_index is blocked until indexing completes or fails. ${ownerDescription}`
                    }],
                    isError: true
                };
            }

            if (ownershipState.state === 'stale-owner') {
                console.warn(
                    `[CLEAR] Proceeding with clear_index for '${absolutePath}' despite stale ownership metadata. ` +
                    `Reason: ${ownershipState.staleReason || 'unknown stale owner'}`
                );
            }

            console.log(`[CLEAR] Clearing codebase: ${absolutePath}`);

            if (hasCloudIndex) {
                try {
                    await this.context.clearIndex(absolutePath);
                    console.log(`[CLEAR] Successfully cleared index for: ${absolutePath}`);
                } catch (error: any) {
                    const errorMsg = `Failed to clear ${absolutePath}: ${error.message}`;
                    console.error(`[CLEAR] ${errorMsg}`);
                    return {
                        content: [{
                            type: "text",
                            text: errorMsg
                        }],
                        isError: true
                    };
                }
            } else {
                console.log(`[CLEAR] ℹ️ No cloud collection found for ${absolutePath}, cleaning snapshot only`);
            }

            // Completely remove the cleared codebase from snapshot
            this.snapshotManager.removeCodebaseCompletely(absolutePath);
            await this.codebaseConfigManager.removeConfig(absolutePath);

            // Reset indexing stats if this was the active codebase
            this.indexingStats = null;

            // Save snapshot after clearing index
            await this.snapshotManager.saveCodebaseSnapshot('clear-index');
            await this.runtimeStatusManager?.refresh('clear-index');

            let resultText = `Successfully cleared codebase '${absolutePath}'`;

            const remainingIndexed = this.snapshotManager.getIndexedCodebases().length;
            const remainingIndexing = this.snapshotManager.getIndexingCodebases().length;

            if (remainingIndexed > 0 || remainingIndexing > 0) {
                resultText += `\n${remainingIndexed} other indexed codebase(s) and ${remainingIndexing} indexing codebase(s) remain`;
            }

            return {
                content: [{
                    type: "text",
                    text: resultText
                }],
                structuredContent: {
                    path: absolutePath,
                    cleared: true,
                    remainingIndexed,
                    remainingIndexing
                }
            };
        } catch (error) {
            // Check if this is the collection limit error
            // Handle both direct string throws and Error objects containing the message
            const errorMessage = typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error));

            if (errorMessage === COLLECTION_LIMIT_MESSAGE || errorMessage.includes(COLLECTION_LIMIT_MESSAGE)) {
                // Return the collection limit message as a successful response
                // This ensures LLM treats it as final answer, not as retryable error
                return {
                    content: [{
                        type: "text",
                        text: COLLECTION_LIMIT_MESSAGE
                    }]
                };
            }

            return {
                content: [{
                    type: "text",
                    text: `Error clearing index: ${errorMessage}`
                }],
                isError: true
            };
        }
    }

    public async handleGetIndexingStatus(args: any) {
        const { path: codebasePath } = args;

        try {
            // Force absolute path resolution
            const accessDecision = this.enforceAccessPolicy(codebasePath);
            if (accessDecision.response) {
                return accessDecision.response;
            }
            const absolutePath = accessDecision.absolutePath;

            // Validate path exists
            if (!fs.existsSync(absolutePath)) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' does not exist. Original input: '${codebasePath}'`
                    }],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Path '${absolutePath}' is not a directory`
                    }],
                    isError: true
                };
            }

            // Check indexing status using snapshot plus cloud truth
            let status = this.snapshotManager.getCodebaseStatus(absolutePath);
            let info = this.snapshotManager.getCodebaseInfo(absolutePath);
            let recoveredFromCloud = false;
            const hasCloudIndex = await this.context.hasIndex(absolutePath);
            const hasPersistedSyncConfig = await this.codebaseConfigManager.hasConfig(absolutePath);

            // Self-heal snapshot if cloud has index but local status is missing
            if (status === 'not_found' && hasCloudIndex) {
                const restoreResult = await this.restoreIndexedSnapshotEntry(
                    absolutePath,
                    'status-reconcile-cloud-present'
                );
                if (restoreResult === 'skipped-live-owner') {
                    status = this.snapshotManager.getCodebaseStatus(absolutePath);
                    info = this.snapshotManager.getCodebaseInfo(absolutePath);
                    console.log(`[STATUS] ⏭️ Skipped cloud snapshot restore for '${absolutePath}' because a live owner is indexing.`);
                } else {
                    status = 'indexed';
                    info = this.snapshotManager.getCodebaseInfo(absolutePath);
                    recoveredFromCloud = true;
                    console.log(
                        `[STATUS] 🛠️ Restored missing snapshot entry from cloud index for: ${absolutePath}` +
                        (restoreResult === 'restored-with-stats' ? ' (with recovered stats)' : '')
                    );
                }
            }

            // Cleanup stale snapshot entries if cloud index no longer exists
            if (status === 'indexed' && !hasCloudIndex) {
                this.snapshotManager.removeCodebaseCompletely(absolutePath);
                await this.snapshotManager.saveCodebaseSnapshot('status-reconcile-cloud-missing');
                await this.runtimeStatusManager?.refresh('status-reconcile-cloud-missing');
                status = 'not_found';
                info = undefined;
                console.log(`[STATUS] 🧹 Removed stale indexed snapshot entry without cloud index for: ${absolutePath}`);
            }

            if (status === 'indexed' && hasCloudIndex && info && info.status === 'indexed' && !this.hasKnownIndexStats(info)) {
                const recoveredStats = await this.tryRecoverIndexStats(absolutePath, info.indexStatus);
                if (recoveredStats) {
                    this.snapshotManager.setCodebaseIndexed(absolutePath, recoveredStats);
                    await this.snapshotManager.saveCodebaseSnapshot('status-recovered-index-stats');
                    await this.runtimeStatusManager?.refresh('status-recovered-index-stats');
                    info = this.snapshotManager.getCodebaseInfo(absolutePath);
                    console.log(`[STATUS] 📊 Recovered missing index statistics for: ${absolutePath}`);
                }
            }

            let statusMessage = '';
            const structuredStatus: Record<string, any> = {
                path: absolutePath,
                status,
                recoveredFromCloud,
                hasPersistedSyncConfig
            };

            switch (status) {
                case 'indexed':
                    if (this.hasKnownIndexStats(info)) {
                        const indexedInfo = info as any;
                        structuredStatus.indexedFiles = indexedInfo.indexedFiles;
                        structuredStatus.totalChunks = indexedInfo.totalChunks;
                        structuredStatus.indexStatus = indexedInfo.indexStatus;
                        structuredStatus.lastUpdated = indexedInfo.lastUpdated;
                        statusMessage = `✅ Codebase '${absolutePath}' is fully indexed and ready for search.`;
                        statusMessage += `\n📊 Statistics: ${indexedInfo.indexedFiles} files, ${indexedInfo.totalChunks} chunks`;
                        statusMessage += `\n📅 Status: ${indexedInfo.indexStatus}`;
                        statusMessage += `\n🕐 Last updated: ${new Date(indexedInfo.lastUpdated).toLocaleString()}`;
                    } else {
                        if (info && info.status === 'indexed') {
                            structuredStatus.indexStatus = info.indexStatus;
                            structuredStatus.lastUpdated = info.lastUpdated;
                        }
                        statusMessage = `✅ Codebase '${absolutePath}' is fully indexed and ready for search.`;
                        if (info && info.status === 'indexed') {
                            statusMessage += `\n📊 Statistics: unavailable in local snapshot`;
                            statusMessage += `\n📅 Status: ${info.indexStatus}`;
                            statusMessage += `\n🕐 Last updated: ${new Date(info.lastUpdated).toLocaleString()}`;
                        }
                    }
                    if (recoveredFromCloud) {
                        statusMessage += `\nℹ️ Index was detected directly in vector database and local snapshot state was restored.`;
                    }
                    if (!hasPersistedSyncConfig) {
                        statusMessage += `\n⚠️ Incremental sync is degraded because persisted per-codebase sync config is missing. Re-index with force=true to restore restart-safe sync.`;
                    }
                    break;

                case 'indexing':
                    if (info && 'indexingPercentage' in info) {
                        const indexingInfo = info as any;
                        const progressPercentage = indexingInfo.indexingPercentage || 0;
                        structuredStatus.progressPercentage = progressPercentage;
                        structuredStatus.lastUpdated = indexingInfo.lastUpdated;
                        statusMessage = `🔄 Codebase '${absolutePath}' is currently being indexed. Progress: ${progressPercentage.toFixed(1)}%`;

                        // Add more detailed status based on progress
                        if (progressPercentage < 10) {
                            statusMessage += ' (Preparing and scanning files...)';
                        } else if (progressPercentage < 100) {
                            statusMessage += ' (Processing files and generating embeddings...)';
                        }
                        statusMessage += `\n🕐 Last updated: ${new Date(indexingInfo.lastUpdated).toLocaleString()}`;
                    } else {
                        statusMessage = `🔄 Codebase '${absolutePath}' is currently being indexed.`;
                    }
                    break;

                case 'indexfailed':
                    if (info && 'errorMessage' in info) {
                        const failedInfo = info as any;
                        structuredStatus.errorMessage = failedInfo.errorMessage;
                        structuredStatus.lastAttemptedPercentage = failedInfo.lastAttemptedPercentage;
                        structuredStatus.lastUpdated = failedInfo.lastUpdated;
                        statusMessage = `❌ Codebase '${absolutePath}' indexing failed.`;
                        statusMessage += `\n🚨 Error: ${failedInfo.errorMessage}`;
                        if (failedInfo.lastAttemptedPercentage !== undefined) {
                            statusMessage += `\n📊 Failed at: ${failedInfo.lastAttemptedPercentage.toFixed(1)}% progress`;
                        }
                        statusMessage += `\n🕐 Failed at: ${new Date(failedInfo.lastUpdated).toLocaleString()}`;
                        statusMessage += `\n💡 You can retry indexing by running the index_codebase command again.`;
                    } else {
                        statusMessage = `❌ Codebase '${absolutePath}' indexing failed. You can retry indexing.`;
                    }
                    break;

                case 'not_found':
                default:
                    statusMessage = `❌ Codebase '${absolutePath}' is not indexed. Please use the index_codebase tool to index it first.`;
                    break;
            }

            const pathInfo = codebasePath !== absolutePath
                ? `\nNote: Input path '${codebasePath}' was resolved to absolute path '${absolutePath}'`
                : '';

            return {
                content: [{
                    type: "text",
                    text: statusMessage + pathInfo
                }],
                structuredContent: structuredStatus
            };

        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error getting indexing status: ${error.message || error}`
                }],
                isError: true
            };
        }
    }
} 
