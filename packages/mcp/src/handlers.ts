import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import {
    CodebaseSessionConfig,
    Context,
    COLLECTION_LIMIT_MESSAGE,
    isReducedOneCIndexScopeProfile,
    parseRankingProfile,
    parseRetrievalProfile,
    parseOneCIndexScopeProfile,
    resolveOneCIndexScopeProfile,
} from "@zilliz/claude-context-core";
import type { OneCIndexScopeProfile, OneCIndexScopeSummary, RankingProfile, RetrievalMode, RetrievalProfile } from "@zilliz/claude-context-core";
import { CodebaseConfigManager } from "./codebase-config.js";
import { SnapshotManager } from "./snapshot.js";
import { RuntimeStatusManager } from "./runtime-status.js";
import {
    getErrorCode,
    getErrorMessage,
    normalizeCodebasePath,
    truncateContent,
    trackCodebasePath
} from "./utils.js";
import { CodebaseAccessPolicy } from "./access-policy.js";
import { ManagedBgeM3WorkerManager } from "./bge-m3-managed-workers.js";
import { WorkloadCancelledError, WorkloadManager, isWorkloadCancelledError } from "./workload-manager.js";
import {
    createCodebaseProfileState,
    createSearchProfileState,
    mergeProfileState,
} from "./profile-state.js";

type ToolArgs = Record<string, unknown>;
type StructuredContent = Record<string, unknown>;
type CountQueryRow = Record<string, unknown>;
type SearchResultSummary = {
    relativePath: string;
    language?: string;
    startLine: number;
    endLine: number;
    score: number;
    content: string;
    metadata?: unknown;
};
type DaemonRetrievalConfiguration = {
    retrievalProfile?: RetrievalProfile;
    resolvedRetrievalProfile?: RetrievalProfile;
    explicitProfile?: boolean;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
    bgeM3Mode?: 'dense' | 'full';
    usesBgeM3Sparse?: boolean;
    usesColbert?: boolean;
};

export class ToolHandlers {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private codebaseConfigManager: CodebaseConfigManager;
    private runtimeStatusManager?: RuntimeStatusManager;
    private accessPolicy: CodebaseAccessPolicy;
    private workloadManager?: WorkloadManager;
    private managedBgeM3WorkerManager?: ManagedBgeM3WorkerManager;
    private daemonRetrievalConfiguration?: DaemonRetrievalConfiguration;
    private indexingStats: { indexedFiles: number; totalChunks: number } | null = null;
    private currentWorkspace: string;

    constructor(
        context: Context,
        snapshotManager: SnapshotManager,
        codebaseConfigManager: CodebaseConfigManager,
        runtimeStatusManager?: RuntimeStatusManager,
        accessPolicy: CodebaseAccessPolicy = new CodebaseAccessPolicy({ mode: 'stdio' }),
        workloadManager?: WorkloadManager,
        managedBgeM3WorkerManager?: ManagedBgeM3WorkerManager,
        daemonRetrievalConfiguration?: DaemonRetrievalConfiguration
    ) {
        this.context = context;
        this.snapshotManager = snapshotManager;
        this.codebaseConfigManager = codebaseConfigManager;
        this.runtimeStatusManager = runtimeStatusManager;
        this.accessPolicy = accessPolicy;
        this.workloadManager = workloadManager;
        this.managedBgeM3WorkerManager = managedBgeM3WorkerManager;
        this.daemonRetrievalConfiguration = daemonRetrievalConfiguration;
        this.currentWorkspace = process.cwd();
        console.log(`[WORKSPACE] Current workspace: ${this.currentWorkspace}`);
    }

    private isIndexingWorkloadIdle(): boolean {
        const snapshot = this.workloadManager?.getSnapshot();
        if (!snapshot) {
            return true;
        }

        return snapshot.indexing.activeCount === 0 && snapshot.indexing.queuedCount === 0;
    }

    private scheduleManagedWorkerStopWhenIdle(reason: string): void {
        this.managedBgeM3WorkerManager?.scheduleStopWhenIdle(reason, () => this.isIndexingWorkloadIdle());
    }

    private registerManagedBgeM3WorkerEndpoints(endpoints: string[]): void {
        if (endpoints.length === 0) {
            return;
        }
        const embedding = this.context.getEmbedding() as {
            registerWorkerEndpoints?: (workerEndpoints: string[]) => void;
        };
        if (typeof embedding.registerWorkerEndpoints !== 'function') {
            console.warn('[MCP] Managed BGE-M3 workers started, but embedding provider does not support dynamic worker registration.');
            return;
        }
        embedding.registerWorkerEndpoints(endpoints);
    }

    private hasKnownIndexStats(info: unknown): info is { indexedFiles: number; totalChunks: number; codeChunkLimit?: number; indexStatus: 'completed' | 'limit_reached'; lastUpdated: string; statsState?: 'known' | 'unknown' } {
        if (typeof info !== 'object' || info === null) {
            return false;
        }
        const candidate = info as {
            indexedFiles?: unknown;
            totalChunks?: unknown;
            indexStatus?: unknown;
            lastUpdated?: unknown;
            statsState?: unknown;
        };
        return candidate.statsState !== 'unknown'
            && typeof candidate.indexedFiles === 'number'
            && typeof candidate.totalChunks === 'number'
            && (candidate.indexStatus === 'completed' || candidate.indexStatus === 'limit_reached')
            && typeof candidate.lastUpdated === 'string';
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
        } catch (error) {
            if (getErrorCode(error) !== 'ENOENT') {
                console.warn(`[INDEX-STATS] Failed to read merkle snapshot for '${codebasePath}':`, getErrorMessage(error));
            }
            return undefined;
        }
    }

    private parseCountQueryResult(rows: CountQueryRow[]): number | undefined {
        if (!Array.isArray(rows) || rows.length === 0) {
            return undefined;
        }

        const parseNumericValue = (value: unknown): number | undefined => {
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

            const toStringValue = value && typeof value === 'object' ? (value as { toString?: unknown }).toString : undefined;
            if (typeof toStringValue === 'function') {
                const parsed = Number(toStringValue.call(value));
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
        } catch (error) {
            console.warn(
                `[INDEX-STATS] Failed to query total chunk count for '${codebasePath}':`,
                getErrorMessage(error)
            );
            return undefined;
        }
    }

    private async tryRecoverIndexStats(
        codebasePath: string,
        indexStatus: 'completed' | 'limit_reached' = 'completed'
    ): Promise<{
        indexedFiles: number;
        totalChunks: number;
        status: 'completed' | 'limit_reached';
        codeChunkLimit?: number;
        initialIndexing?: {
            mode: 'initial_full' | 'initial_resume' | 'incremental_changes';
            manifestRunState: string;
            confirmedDocumentCount: number;
            skippedDocumentCount: number;
            batchCount: number;
        };
    } | null> {
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
        customIgnorePatterns: string[],
        retrievalProfile?: RetrievalProfile,
        oneCIndexScopeProfile?: OneCIndexScopeProfile
    ): CodebaseSessionConfig {
        return {
            customExtensions,
            customIgnorePatterns,
            ...(retrievalProfile ? { retrievalProfile } : {}),
            ...(oneCIndexScopeProfile ? { oneCIndexScopeProfile } : {})
        };
    }

    private normalizeOneCIndexScopeProfile(value: unknown): OneCIndexScopeProfile {
        if (typeof value !== 'string') {
            return resolveOneCIndexScopeProfile();
        }
        return parseOneCIndexScopeProfile(value, 'oneCIndexScopeProfile');
    }

    private getPersistedOneCIndexScopeProfile(info: unknown, config: CodebaseSessionConfig | null): OneCIndexScopeProfile {
        const candidate = info && typeof info === 'object'
            ? (info as { oneCIndexScopeProfile?: unknown }).oneCIndexScopeProfile
            : undefined;
        if (typeof candidate === 'string') {
            return parseOneCIndexScopeProfile(candidate, 'persisted oneCIndexScopeProfile');
        }
        if (config?.oneCIndexScopeProfile) {
            return config.oneCIndexScopeProfile;
        }
        return 'full';
    }

    private async getRlmBslEnrichmentStatus(codebasePath: string, config: CodebaseSessionConfig | null): Promise<Record<string, unknown> | undefined> {
        const mode = config?.rlmBslEnrichment?.mode || 'disabled';
        const status: Record<string, unknown> = {
            mode,
            configured: mode !== 'disabled',
            commandConfigured: Boolean(config?.rlmBslEnrichment?.command)
        };

        try {
            const collectionName = this.context.getCollectionName(codebasePath);
            const description = await this.context.getVectorDatabase().getCollectionDescription(collectionName);
            const fields = this.parseCollectionDescriptionFields(description);
            if (fields.enrichmentProvider === 'rlm-tools-bsl') {
                status.provider = fields.enrichmentProvider;
                status.status = fields.enrichmentStatus;
                status.rawStatus = fields.enrichmentRawStatus;
                status.providerSchemaVersion = fields.enrichmentProviderSchemaVersion
                    ? Number(fields.enrichmentProviderSchemaVersion)
                    : undefined;
                status.sourceFingerprint = fields.enrichmentSourceFingerprint;
                status.sourceRootMatchesCodebase = fields.enrichmentSourceRoot
                    ? normalizeCodebasePath(fields.enrichmentSourceRoot) === normalizeCodebasePath(codebasePath)
                    : undefined;
            }
            const runtimeStatus = this.context.getRlmBslEnrichmentRuntimeStatus(codebasePath);
            if (runtimeStatus) {
                Object.assign(status, runtimeStatus);
            }
        } catch (error) {
            status.diagnostics = { collectionMetadata: `unavailable: ${getErrorMessage(error)}` };
        }

        return status;
    }

    private parseCollectionDescriptionFields(description: string): Record<string, string> {
        const result: Record<string, string> = {};
        for (const part of description.split(/[;\n]/)) {
            const separator = part.indexOf(':');
            if (separator <= 0) {
                continue;
            }
            const key = part.slice(0, separator).trim();
            const value = part.slice(separator + 1).trim();
            if (key && value) {
                result[key] = value;
            }
        }
        return result;
    }

    private createReducedOneCScopeWarning(profile: OneCIndexScopeProfile | undefined): string | undefined {
        if (!isReducedOneCIndexScopeProfile(profile)) {
            return undefined;
        }
        return `1C indexing scope profile '${profile}' intentionally indexes reduced coverage. Search results may omit files excluded by this profile.`;
    }

    private getOneCScopeStatus(
        info: unknown,
        config: CodebaseSessionConfig | null,
        accelerator?: { oneCIndexScope?: OneCIndexScopeSummary }
    ): {
        oneCIndexScopeProfile?: OneCIndexScopeProfile;
        oneCIndexScope?: OneCIndexScopeSummary;
        reducedCoverageWarning?: string;
    } {
        const infoScope = info && typeof info === 'object'
            ? info as {
                oneCIndexScopeProfile?: unknown;
                oneCIndexScope?: OneCIndexScopeSummary;
                reducedCoverageWarning?: unknown;
            }
            : undefined;
        const profile = this.getPersistedOneCIndexScopeProfile(infoScope, config);
        const oneCIndexScope = infoScope?.oneCIndexScope || accelerator?.oneCIndexScope;
        const reducedCoverageWarning =
            (typeof infoScope?.reducedCoverageWarning === 'string' ? infoScope.reducedCoverageWarning : undefined)
            || oneCIndexScope?.warning
            || this.createReducedOneCScopeWarning(profile);

        return {
            ...((profile !== 'full' || config?.oneCIndexScopeProfile || infoScope?.oneCIndexScopeProfile)
                ? { oneCIndexScopeProfile: profile }
                : {}),
            ...(oneCIndexScope ? { oneCIndexScope } : {}),
            ...(reducedCoverageWarning ? { reducedCoverageWarning } : {}),
        };
    }

    private startOwnershipHeartbeat(codebasePath: string): { stop: () => void } {
        const heartbeatIntervalMs = this.snapshotManager.getOwnershipHeartbeatIntervalMs();
        const heartbeatTimer = setInterval(() => {
            void this.snapshotManager.refreshIndexingOwnership(codebasePath).then((refreshed) => {
                if (!refreshed) {
                    console.warn(`[INDEX-OWNERSHIP] Heartbeat refresh lost ownership for '${codebasePath}'.`);
                }
            }).catch((error) => {
                console.error(`[INDEX-OWNERSHIP] Heartbeat refresh failed for '${codebasePath}':`, getErrorMessage(error));
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
                    if (
                        !collectionName.startsWith('code_chunks_') &&
                        !collectionName.startsWith('hybrid_code_chunks_') &&
                        !collectionName.startsWith('bge_m3_code_chunks_') &&
                        !collectionName.startsWith('bge_m3_dense_code_chunks_')
                    ) {
                        console.log(`[SYNC-CLOUD] ⏭️  Skipping non-code collection: ${collectionName}`);
                        continue;
                    }

                    codeCollectionsChecked++;
                    console.log(`[SYNC-CLOUD] 🔍 Checking collection: ${collectionName}`);

                    let extracted = false;
                    try {
                        const description = await vectorDb.getCollectionDescription(collectionName);
                        if (description && description.startsWith('codebasePath:')) {
                            const codebasePath = description
                                .split(/\r?\n/, 1)[0]
                                .substring('codebasePath:'.length);
                            if (codebasePath.length > 0) {
                                const normalizedPath = normalizeCodebasePath(codebasePath);
                                console.log(`[SYNC-CLOUD] 📍 Found codebase path from description: ${normalizedPath} in collection: ${collectionName}`);
                                cloudCodebases.add(normalizedPath);
                                successfulExtractions++;
                                extracted = true;
                            }
                        }
                    } catch (descError) {
                        console.warn(`[SYNC-CLOUD] ⚠️  Failed to get description for collection ${collectionName}:`, getErrorMessage(descError));
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
                        } catch (queryError) {
                            console.warn(`[SYNC-CLOUD] ⚠️  Fallback query failed for collection ${collectionName}:`, getErrorMessage(queryError));
                        }
                    }
                } catch (collectionError) {
                    console.warn(`[SYNC-CLOUD] ⚠️  Error checking collection ${collectionName}:`, getErrorMessage(collectionError));
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
        } catch (error) {
            console.error(`[SYNC-CLOUD] ❌ Error syncing codebases from cloud:`, getErrorMessage(error));
        }
    }

    public async handleIndexCodebase(args: ToolArgs) {
        const codebasePath = typeof args.path === 'string' ? args.path : '';
        const forceReindex = args.force === true;
        const splitterType = typeof args.splitter === 'string' ? args.splitter : 'ast'; // Default to AST
        let retrievalProfile: RetrievalProfile | undefined;
        try {
            retrievalProfile = parseRetrievalProfile(args.retrievalProfile);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                isError: true
            };
        }
        const oneCIndexScopeProfile = this.normalizeOneCIndexScopeProfile(args.oneCIndexScopeProfile ?? args['1cIndexScopeProfile']);
        const customFileExtensions = Array.isArray(args.customExtensions)
            ? args.customExtensions.filter((extension): extension is string => typeof extension === 'string')
            : [];
        const customIgnorePatterns = Array.isArray(args.ignorePatterns)
            ? args.ignorePatterns.filter((pattern): pattern is string => typeof pattern === 'string')
            : [];
        const persistedSessionConfig = this.createPersistedSessionConfig(
            customFileExtensions,
            customIgnorePatterns,
            retrievalProfile,
            oneCIndexScopeProfile,
        );
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
            const existingSessionConfig = hasPersistedSyncConfig
                ? await this.codebaseConfigManager.getConfig(absolutePath)
                : null;
            const requestedSessionConfig = this.context.configureCodebaseSession(absolutePath, persistedSessionConfig);

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

            const existingInfo = this.snapshotManager.getCodebaseInfo(absolutePath);
            const hasExistingIndex = cloudHasIndex || snapshotHasIndex;
            const persistedOneCIndexScopeProfile = this.getPersistedOneCIndexScopeProfile(existingInfo, existingSessionConfig);
            if (
                !forceReindex &&
                existingSessionConfig?.retrievalMode &&
                requestedSessionConfig.retrievalMode &&
                (
                    existingSessionConfig.retrievalMode !== requestedSessionConfig.retrievalMode ||
                    existingSessionConfig.retrievalSchemaVersion !== requestedSessionConfig.retrievalSchemaVersion
                )
            ) {
                if (existingSessionConfig) {
                    this.context.configureCodebaseSession(absolutePath, existingSessionConfig);
                }
                return {
                    content: [{
                        type: "text",
                        text:
                            `Error: retrievalProfile change requires force=true for '${absolutePath}'. ` +
                            `Persisted profile is '${existingSessionConfig.retrievalProfile || 'inferred'}' (${existingSessionConfig.retrievalMode}), ` +
                            `requested profile is '${requestedSessionConfig.retrievalProfile || 'inferred'}' (${requestedSessionConfig.retrievalMode}).`
                    }],
                    structuredContent: {
                        path: absolutePath,
                        retrievalProfile: requestedSessionConfig.retrievalProfile,
                        persistedRetrievalProfile: existingSessionConfig.retrievalProfile,
                        retrievalMode: requestedSessionConfig.retrievalMode,
                        persistedRetrievalMode: existingSessionConfig.retrievalMode,
                        forceRequired: true,
                        profileState: createCodebaseProfileState({
                            config: existingSessionConfig,
                            info: existingInfo,
                            daemonRetrievalConfiguration: requestedSessionConfig,
                            retrievalCompatibility: 'requires-force',
                        }),
                    },
                    isError: true
                };
            }
            if (
                hasExistingIndex &&
                !forceReindex &&
                persistedOneCIndexScopeProfile !== oneCIndexScopeProfile
            ) {
                return {
                    content: [{
                        type: "text",
                        text:
                            `Error: 1C indexing scope profile change requires force=true for '${absolutePath}'. ` +
                            `Persisted profile is '${persistedOneCIndexScopeProfile}', requested profile is '${oneCIndexScopeProfile}'.`
                    }],
                    structuredContent: {
                        path: absolutePath,
                        oneCIndexScopeProfile,
                        persistedOneCIndexScopeProfile,
                        forceRequired: true,
                    },
                    isError: true
                };
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
            } catch (validationError) {
                // Handle other collection creation errors
                console.error(`[INDEX-VALIDATION] ❌ Collection creation validation failed:`, getErrorMessage(validationError));
                return {
                    content: [{
                        type: "text",
                        text: `Error validating collection creation: ${getErrorMessage(validationError)}`
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
            this.snapshotManager.setCodebaseIndexing(absolutePath, 0, undefined, {
                oneCIndexScopeProfile,
            });

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

            // Force reindex clearing is handled inside Context.indexCodebase after manifest planning.
            if (forceReindex && cloudHasIndex) {
                console.log(`[FORCE-REINDEX] 🔄 Existing index for '${absolutePath}' will be replaced by Context.indexCodebase`);
            }

            const configuredSessionConfig = requestedSessionConfig;

            // Check current status and log if retrying after failure
            if (ownershipClaim.previousInfo?.status === 'indexfailed') {
                console.log(`[BACKGROUND-INDEX] Retrying indexing for previously failed codebase. Previous error: ${ownershipClaim.previousInfo.errorMessage || 'Unknown error'}`);
            }

            // Track the codebase path for syncing
            trackCodebasePath(absolutePath);
            await this.runtimeStatusManager?.refresh('index-started');

            const ownershipHeartbeat = this.startOwnershipHeartbeat(absolutePath);
            const runIndexingJob = async (signal: AbortSignal) => {
                try {
                    const managedEndpoints = await this.managedBgeM3WorkerManager?.ensureStarted(`interactive indexing for ${absolutePath}`) || [];
                    this.registerManagedBgeM3WorkerEndpoints(managedEndpoints);
                    await this.startBackgroundIndexing(absolutePath, forceReindex, splitterType, configuredSessionConfig, signal);
                } finally {
                    ownershipHeartbeat.stop();
                    this.scheduleManagedWorkerStopWhenIdle(`indexing workload idle after ${absolutePath}`);
                }
            };

            const queuedIndexingJob = this.workloadManager
                ? this.workloadManager.enqueueInteractiveIndexing(absolutePath, runIndexingJob)
                : {
                    startedImmediately: true,
                    queuePosition: 0,
                    completion: runIndexingJob(new AbortController().signal)
                };

            void queuedIndexingJob.completion.catch((error) => {
                console.error(`[BACKGROUND-INDEX] Queued indexing task failed for '${absolutePath}':`, getErrorMessage(error));
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
            const scopeInfo = `\nUsing 1C indexing scope profile: ${oneCIndexScopeProfile}` +
                (isReducedOneCIndexScopeProfile(oneCIndexScopeProfile)
                    ? `\nWarning: 1C scope '${oneCIndexScopeProfile}' intentionally indexes reduced coverage.`
                    : '');
            const retrievalInfo = configuredSessionConfig.retrievalProfile
                ? `\nUsing retrieval performance profile: ${configuredSessionConfig.retrievalProfile} (${configuredSessionConfig.retrievalMode}, schema v${configuredSessionConfig.retrievalSchemaVersion})`
                : `\nUsing retrieval mode: ${configuredSessionConfig.retrievalMode} (schema v${configuredSessionConfig.retrievalSchemaVersion})`;
            const enrichmentInfo = configuredSessionConfig.rlmBslEnrichment?.mode && configuredSessionConfig.rlmBslEnrichment.mode !== 'disabled'
                ? `\nUsing RLM BSL enrichment mode: ${configuredSessionConfig.rlmBslEnrichment.mode}`
                : '';

            const queueInfo = queuedIndexingJob.startedImmediately
                ? `\nIndexing started immediately.`
                : `\nIndexing request queued at position ${queuedIndexingJob.queuePosition}. Ownership is reserved in this runtime while the job waits for an indexing slot.`;

            return {
                content: [{
                    type: "text",
                    text: `Started background indexing for codebase '${absolutePath}' using ${splitterType.toUpperCase()} splitter.${pathInfo}${extensionInfo}${ignoreInfo}${scopeInfo}${retrievalInfo}${enrichmentInfo}${queueInfo}\n\nIndexing is running in the background. You can search the codebase while indexing is in progress, but results may be incomplete until indexing completes.`
                }],
                structuredContent: {
                    path: absolutePath,
                    originalPath: codebasePath,
                    force: forceReindex,
                    splitter: splitterType,
                    customExtensions: customFileExtensions,
                    ignorePatterns: customIgnorePatterns,
                    retrievalProfile: configuredSessionConfig.retrievalProfile,
                    retrievalMode: configuredSessionConfig.retrievalMode,
                    retrievalSchemaVersion: configuredSessionConfig.retrievalSchemaVersion,
                    rlmBslEnrichment: configuredSessionConfig.rlmBslEnrichment
                        ? {
                            mode: configuredSessionConfig.rlmBslEnrichment.mode,
                            commandConfigured: Boolean(configuredSessionConfig.rlmBslEnrichment.command),
                        }
                        : { mode: 'disabled', commandConfigured: false },
                    oneCIndexScopeProfile,
                    startedImmediately: queuedIndexingJob.startedImmediately,
                    queuePosition: queuedIndexingJob.queuePosition
                }
            };

        } catch (error) {
            // Enhanced error handling to prevent MCP service crash
            console.error('Error in handleIndexCodebase:', error);

            if (ownershipClaimed && claimedCodebasePath) {
                try {
                    await this.snapshotManager.failIndexingOwnership(
                        claimedCodebasePath,
                        getErrorMessage(error)
                    );
                    await this.runtimeStatusManager?.refresh('index-start-failed');
                } catch (ownershipError) {
                    console.error(`[INDEX-OWNERSHIP] Failed to release ownership for '${claimedCodebasePath}':`, getErrorMessage(ownershipError));
                }
            }

            // Ensure we always return a proper MCP response, never throw
            return {
                content: [{
                    type: "text",
                    text: `Error starting indexing: ${getErrorMessage(error)}`
                }],
                isError: true
            };
        }
    }

    private async startBackgroundIndexing(
        codebasePath: string,
        forceReindex: boolean,
        splitterType: string,
        sessionConfig: CodebaseSessionConfig | undefined,
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

            const persistedConfig = sessionConfig || await this.codebaseConfigManager.getConfig(absolutePath);
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

            const ignorePatterns = this.context.getIgnorePatterns(absolutePath) || [];
            const supportedExtensions = this.context.getSupportedExtensions(absolutePath) || [];
            console.log(`[BACKGROUND-INDEX] Using ignore patterns: ${ignorePatterns.join(', ')}`);
            console.log(`[BACKGROUND-INDEX] Using supported extensions: ${supportedExtensions.join(', ')}`);
            throwIfCancelled();

            console.log(`[BACKGROUND-INDEX] Starting indexing with ${splitterType} splitter for: ${absolutePath}`);

            // Log embedding provider information before indexing
            const embeddingProvider = this.context.getEmbedding();
            console.log(`[BACKGROUND-INDEX] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} with dimension: ${embeddingProvider.getDimension()}`);

            // Start indexing with the appropriate context and progress tracking
            console.log(`[BACKGROUND-INDEX] 🚀 Beginning codebase indexing process...`);
            const stats = await contextForThisTask.indexCodebase(absolutePath, (progress) => {
                throwIfCancelled();
                // Update progress in snapshot manager using new method
                this.snapshotManager.setCodebaseIndexing(absolutePath, progress.percentage, progress);

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
            await this.codebaseConfigManager.saveConfig(absolutePath, this.context.getCodebaseSessionConfig(absolutePath) || persistedConfig);
            await this.runtimeStatusManager?.refresh('codebase-sync-config-saved');

            const completed = await this.snapshotManager.completeIndexingOwnership(absolutePath, stats);
            if (!completed) {
                console.warn(`[INDEX-OWNERSHIP] Background indexing finished for '${absolutePath}' but ownership completion was rejected.`);
            }
            await this.runtimeStatusManager?.refresh('index-completed');

            let message = `Background indexing completed for '${absolutePath}' using ${splitterType.toUpperCase()} splitter.\nIndexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks.`;
            const initialIndexingStats = (stats as typeof stats & {
                initialIndexing?: {
                    mode: 'initial_full' | 'initial_resume' | 'incremental_changes';
                    resumeEligible: boolean;
                    manifestCompatibility: 'compatible' | 'missing' | 'incompatible' | 'ignored_force';
                    confirmedDocumentCount: number;
                    skippedDocumentCount: number;
                    batchCount: number;
                };
            }).initialIndexing;
            if (initialIndexingStats) {
                const modeLabel = initialIndexingStats.mode === 'initial_resume'
                    ? 'resume'
                    : initialIndexingStats.mode === 'incremental_changes'
                        ? 'incremental'
                        : 'full';
                message += `\nInitial indexing mode: ${modeLabel}; manifest=${initialIndexingStats.manifestCompatibility}, resumeEligible=${initialIndexingStats.resumeEligible}; confirmed=${initialIndexingStats.confirmedDocumentCount}, skipped=${initialIndexingStats.skippedDocumentCount}, batches=${initialIndexingStats.batchCount}.`;
            }
            if (stats.status === 'limit_reached') {
                message += `\n⚠️  Warning: Indexing stopped because CODE_CHUNK_LIMIT=${stats.codeChunkLimit ?? 'unknown'} was reached after ${stats.totalChunks} chunks and ${stats.indexedFiles} files. The partial index remains searchable, but results may be incomplete. Raise CODE_CHUNK_LIMIT and run force reindex to include chunks skipped by this run.`;
            }

            console.log(`[BACKGROUND-INDEX] ${message}`);

        } catch (error) {
            console.error(`[BACKGROUND-INDEX] Error during indexing for ${absolutePath}:`, error);

            // Get the last attempted progress
            const lastProgress = this.snapshotManager.getIndexingProgress(absolutePath);

            const errorMessage = isWorkloadCancelledError(error)
                ? (error.message || `Indexing for '${absolutePath}' was cancelled by daemon operator.`)
                : getErrorMessage(error);
            const failed = await this.snapshotManager.failIndexingOwnership(absolutePath, errorMessage, lastProgress);
            if (!failed) {
                console.warn(`[INDEX-OWNERSHIP] Background indexing failed for '${absolutePath}' but ownership failure update was rejected.`);
            }
            await this.runtimeStatusManager?.refresh('index-failed');

            // Log error but don't crash MCP service - indexing errors are handled gracefully
            console.error(`[BACKGROUND-INDEX] Indexing failed for ${absolutePath}: ${errorMessage}`);
        }
    }

    public async handleSearchCode(args: ToolArgs) {
        const codebasePath = typeof args.path === 'string' ? args.path : '';
        const query = typeof args.query === 'string' ? args.query : '';
        const resultLimit = typeof args.limit === 'number' ? args.limit : 10;
        const extensionFilter = args.extensionFilter;
        let rankingProfile: RankingProfile;
        try {
            rankingProfile = parseRankingProfile(args.rankingProfile) || 'auto';
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                isError: true
            };
        }
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
                const persistedSearchConfig = await this.codebaseConfigManager.getConfig(absolutePath);
                if (persistedSearchConfig) {
                    this.context.configureCodebaseSession(absolutePath, persistedSearchConfig);
                }
                const isIndexedInSnapshot = this.snapshotManager.getIndexedCodebases().includes(absolutePath);
                const isIndexing = this.snapshotManager.getIndexingCodebases().includes(absolutePath);
                const hasCloudIndex = await this.context.hasIndex(absolutePath);
                const oneCScopeStatus = this.getOneCScopeStatus(
                    this.snapshotManager.getCodebaseInfo(absolutePath),
                    persistedSearchConfig,
                    this.context.getLastAcceleratorSnapshot()
                );

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
                const scopeWarningMessage = oneCScopeStatus.reducedCoverageWarning
                    ? `\n⚠️  **1C Scope**: ${oneCScopeStatus.reducedCoverageWarning}`
                    : '';

                console.log(`[SEARCH] Searching in codebase: ${absolutePath}`);
                console.log(`[SEARCH] Query: "${query}"`);
                console.log(`[SEARCH] Ranking profile: ${rankingProfile}`);
                console.log(`[SEARCH] Indexing status: ${isIndexing ? 'In Progress' : (hasCloudIndex ? 'Completed' : 'No collection yet')}`);

                // Log embedding provider information before search
                const embeddingProvider = this.context.getEmbedding();
                console.log(`[SEARCH] 🧠 Using embedding provider: ${embeddingProvider.getProvider()} for search`);
                console.log(`[SEARCH] 🔍 Generating embeddings for query using ${embeddingProvider.getProvider()}...`);

                // Build filter expression from extensionFilter list
                let filterExpr: string | undefined = undefined;
                if (Array.isArray(extensionFilter) && extensionFilter.length > 0) {
                    const cleaned = extensionFilter
                        .filter((v): v is string => typeof v === 'string')
                        .map((v) => v.trim())
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
                    filterExpr,
                    { rankingProfile }
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

                    let noResultsMessage = `No results found for query: "${query}" in codebase '${absolutePath}'${scopeWarningMessage}`;
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
                            rankingProfile,
                            retrievalProfile: persistedSearchConfig?.retrievalProfile,
                            retrievalMode: persistedSearchConfig?.retrievalMode,
                            retrievalSchemaVersion: persistedSearchConfig?.retrievalSchemaVersion,
                            indexingStatus: isIndexing ? 'indexing' : 'indexed',
                            ...oneCScopeStatus,
                            profileState: mergeProfileState(
                                createCodebaseProfileState({
                                    config: persistedSearchConfig,
                                    info: this.snapshotManager.getCodebaseInfo(absolutePath),
                                    oneCScopeStatus,
                                    daemonRetrievalConfiguration: this.daemonRetrievalConfiguration,
                                }),
                                createSearchProfileState({ requestedRankingProfile: rankingProfile }),
                            ),
                            results: []
                        }
                    };
                }

                // Format results
                const formattedResults = searchResults.map((result, index: number) => {
                    const location = `${result.relativePath}:${result.startLine}-${result.endLine}`;
                    const context = truncateContent(result.content, 5000);
                    const codebaseInfo = path.basename(absolutePath);

                    return `${index + 1}. Code snippet (${result.language}) [${codebaseInfo}]\n` +
                        `   Location: ${location}\n` +
                        `   Rank: ${index + 1}\n` +
                        `   Context: \n\`\`\`${result.language}\n${context}\n\`\`\`\n`;
                }).join('\n');

                let resultMessage = `Found ${searchResults.length} results for query: "${query}" in codebase '${absolutePath}'${indexingStatusMessage}${scopeWarningMessage}\n\n${formattedResults}`;

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
                        rankingProfile,
                        retrievalProfile: persistedSearchConfig?.retrievalProfile,
                        retrievalMode: persistedSearchConfig?.retrievalMode,
                        retrievalSchemaVersion: persistedSearchConfig?.retrievalSchemaVersion,
                        indexingStatus: isIndexing ? 'indexing' : 'indexed',
                        ...oneCScopeStatus,
                        profileState: mergeProfileState(
                            createCodebaseProfileState({
                                config: persistedSearchConfig,
                                info: this.snapshotManager.getCodebaseInfo(absolutePath),
                                oneCScopeStatus,
                                daemonRetrievalConfiguration: this.daemonRetrievalConfiguration,
                            }),
                            createSearchProfileState({
                                requestedRankingProfile: rankingProfile,
                                resultMetadata: searchResults[0]?.metadata,
                            }),
                        ),
                        results: searchResults.map((result): SearchResultSummary => ({
                            relativePath: result.relativePath,
                            language: result.language,
                            startLine: result.startLine,
                            endLine: result.endLine,
                            score: result.score,
                            content: result.content,
                            ...(result.metadata && { metadata: result.metadata })
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

    public async handleClearIndex(args: ToolArgs) {
        const codebasePath = typeof args.path === 'string' ? args.path : '';

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
            const hasTrackedSnapshotState = snapshotStatus !== 'not_found';
            const hasCloudIndex = await this.context.hasIndex(absolutePath);
            const hasPersistedConfig = await this.codebaseConfigManager.hasConfig(absolutePath);
            const ownershipState = await this.snapshotManager.inspectIndexingOwnership(absolutePath);

            if (!hasTrackedSnapshotState && !hasCloudIndex && !hasPersistedConfig) {
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
                } catch (error) {
                    const errorMsg = `Failed to clear ${absolutePath}: ${getErrorMessage(error)}`;
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

    public async handleGetIndexingStatus(args: ToolArgs) {
        const codebasePath = typeof args.path === 'string' ? args.path : '';

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
            const hasPersistedSyncConfig = await this.codebaseConfigManager.hasConfig(absolutePath);
            const persistedSyncConfig = hasPersistedSyncConfig
                ? await this.codebaseConfigManager.getConfig(absolutePath)
                : null;
            if (persistedSyncConfig) {
                this.context.configureCodebaseSession(absolutePath, persistedSyncConfig);
            }
            const hasCloudIndex = await this.context.hasIndex(absolutePath);

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
            const structuredStatus: StructuredContent = {
                path: absolutePath,
                status,
                recoveredFromCloud,
                hasPersistedSyncConfig
            };
            const lastAccelerator = this.context.getLastAcceleratorSnapshot();
            const accelerator = lastAccelerator?.codebasePath === absolutePath ? lastAccelerator : undefined;
            if (accelerator) {
                structuredStatus.accelerator = accelerator;
            }
            const initialIndexingManifest = (this.context as typeof this.context & {
                getLastInitialIndexingManifest?: () => {
                    selectedMode?: 'initial_full' | 'initial_resume';
                    runState: string;
                    identity: { codebasePath: string };
                    confirmedDocumentIds: string[];
                    batches: Array<{ state: string; documentIds: string[] }>;
                    traversal: {
                        selectedFileCount: number;
                        hashedFileCount: number;
                    };
                } | undefined;
            }).getLastInitialIndexingManifest?.();
            if (initialIndexingManifest?.identity.codebasePath === absolutePath) {
                const plannedDocumentIds = new Set(
                    initialIndexingManifest.batches.flatMap((batch) => batch.documentIds),
                );
                const confirmedDocumentIds = new Set(initialIndexingManifest.confirmedDocumentIds);
                const unconfirmedDocumentCount = [...plannedDocumentIds]
                    .filter((documentId) => !confirmedDocumentIds.has(documentId))
                    .length;
                const resumeEligible = ['indexing', 'interrupted', 'failed', 'cancelled', 'limit_reached'].includes(initialIndexingManifest.runState);
                structuredStatus.initialIndexing = {
                    mode: initialIndexingManifest.selectedMode || (resumeEligible ? 'initial_resume' : 'initial_full'),
                    runState: initialIndexingManifest.runState,
                    resumeEligible,
                    manifestCompatibility: 'compatible',
                    plannedDocumentCount: plannedDocumentIds.size,
                    confirmedDocumentCount: confirmedDocumentIds.size,
                    skippedDocumentCount: confirmedDocumentIds.size,
                    unconfirmedDocumentCount,
                    remainingDocumentCount: unconfirmedDocumentCount,
                    batchCount: initialIndexingManifest.batches.length,
                    insertedBatchCount: initialIndexingManifest.batches.filter((batch) => batch.state === 'inserted').length,
                    failedBatchCount: initialIndexingManifest.batches.filter((batch) => batch.state === 'failed').length,
                    selectedFileCount: initialIndexingManifest.traversal.selectedFileCount,
                    hashedFileCount: initialIndexingManifest.traversal.hashedFileCount,
                };
            }
            if (persistedSyncConfig?.retrievalMode) {
                structuredStatus.retrievalProfile = persistedSyncConfig.retrievalProfile;
                structuredStatus.retrievalMode = persistedSyncConfig.retrievalMode;
                structuredStatus.retrievalSchemaVersion = persistedSyncConfig.retrievalSchemaVersion;
            }
            const oneCScopeStatus = this.getOneCScopeStatus(info, persistedSyncConfig, accelerator);
            Object.assign(structuredStatus, oneCScopeStatus);
            const rlmBslEnrichmentStatus = await this.getRlmBslEnrichmentStatus(absolutePath, persistedSyncConfig);
            if (rlmBslEnrichmentStatus) {
                structuredStatus.rlmBslEnrichment = rlmBslEnrichmentStatus;
            }
            structuredStatus.profileState = createCodebaseProfileState({
                config: persistedSyncConfig,
                info,
                oneCScopeStatus,
                rlmBslEnrichmentStatus,
                daemonRetrievalConfiguration: this.daemonRetrievalConfiguration,
            });

            switch (status) {
                case 'indexed':
                    if (this.hasKnownIndexStats(info)) {
                        structuredStatus.indexedFiles = info.indexedFiles;
                        structuredStatus.totalChunks = info.totalChunks;
                        structuredStatus.codeChunkLimit = info.codeChunkLimit;
                        structuredStatus.indexStatus = info.indexStatus;
                        structuredStatus.lastUpdated = info.lastUpdated;
                        statusMessage = `✅ Codebase '${absolutePath}' is fully indexed and ready for search.`;
                        statusMessage += `\n📊 Statistics: ${info.indexedFiles} files, ${info.totalChunks} chunks`;
                        if (info.codeChunkLimit !== undefined) {
                            statusMessage += `\n🔢 CODE_CHUNK_LIMIT: ${info.codeChunkLimit}`;
                        }
                        statusMessage += `\n📅 Status: ${info.indexStatus}`;
                        if (info.indexStatus === 'limit_reached') {
                            statusMessage += `\n⚠️ Results may be incomplete because indexing stopped at the configured chunk limit. Raise CODE_CHUNK_LIMIT and run force reindex to include previously skipped chunks.`;
                        }
                        if (persistedSyncConfig?.retrievalMode) {
                            statusMessage += `\n🔎 Retrieval profile: ${persistedSyncConfig.retrievalProfile || 'inferred'}`;
                            statusMessage += `\n🔎 Retrieval mode: ${persistedSyncConfig.retrievalMode}`;
                            if (persistedSyncConfig.retrievalSchemaVersion) {
                                statusMessage += ` (schema v${persistedSyncConfig.retrievalSchemaVersion})`;
                            }
                        }
                        if (rlmBslEnrichmentStatus?.configured) {
                            statusMessage += `\n🧩 RLM BSL enrichment: ${String(rlmBslEnrichmentStatus.status || rlmBslEnrichmentStatus.mode)}`;
                        }
                        statusMessage += `\n🕐 Last updated: ${new Date(info.lastUpdated).toLocaleString()}`;
                    } else {
                        if (info && info.status === 'indexed') {
                            structuredStatus.indexStatus = info.indexStatus;
                            structuredStatus.lastUpdated = info.lastUpdated;
                        }
                        statusMessage = `✅ Codebase '${absolutePath}' is fully indexed and ready for search.`;
                        if (info && info.status === 'indexed') {
                            statusMessage += `\n📊 Statistics: unavailable in local snapshot`;
                            statusMessage += `\n📅 Status: ${info.indexStatus}`;
                            if (persistedSyncConfig?.retrievalMode) {
                                statusMessage += `\n🔎 Retrieval profile: ${persistedSyncConfig.retrievalProfile || 'inferred'}`;
                                statusMessage += `\n🔎 Retrieval mode: ${persistedSyncConfig.retrievalMode}`;
                                if (persistedSyncConfig.retrievalSchemaVersion) {
                                    statusMessage += ` (schema v${persistedSyncConfig.retrievalSchemaVersion})`;
                                }
                            }
                            if (rlmBslEnrichmentStatus?.configured) {
                                statusMessage += `\n🧩 RLM BSL enrichment: ${String(rlmBslEnrichmentStatus.status || rlmBslEnrichmentStatus.mode)}`;
                            }
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
                    if (info && info.status === 'indexing') {
                        const progressPercentage = info.indexingPercentage || 0;
                        structuredStatus.progressPercentage = progressPercentage;
                        if (info.progressDetails) {
                            structuredStatus.progressDetails = info.progressDetails;
                        }
                        structuredStatus.lastUpdated = info.lastUpdated;
                        statusMessage = `🔄 Codebase '${absolutePath}' is currently being indexed. Progress: ${progressPercentage.toFixed(1)}%`;

                        if (info.progressDetails) {
                            const { phase, current, total } = info.progressDetails;
                            statusMessage += `\n📍 Phase: ${phase} (${current}/${total})`;
                        } else if (progressPercentage < 10) {
                            statusMessage += ' (Preparing and scanning files...)';
                        } else if (progressPercentage < 100) {
                            statusMessage += ' (Processing files and generating embeddings...)';
                        }
                        statusMessage += `\n🕐 Last updated: ${new Date(info.lastUpdated).toLocaleString()}`;
                    } else {
                        statusMessage = `🔄 Codebase '${absolutePath}' is currently being indexed.`;
                    }
                    break;

                case 'indexfailed':
                    if (info && info.status === 'indexfailed') {
                        structuredStatus.errorMessage = info.errorMessage;
                        structuredStatus.lastAttemptedPercentage = info.lastAttemptedPercentage;
                        structuredStatus.lastUpdated = info.lastUpdated;
                        statusMessage = `❌ Codebase '${absolutePath}' indexing failed.`;
                        statusMessage += `\n🚨 Error: ${info.errorMessage}`;
                        if (info.lastAttemptedPercentage !== undefined) {
                            statusMessage += `\n📊 Failed at: ${info.lastAttemptedPercentage.toFixed(1)}% progress`;
                        }
                        statusMessage += `\n🕐 Failed at: ${new Date(info.lastUpdated).toLocaleString()}`;
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

            if (accelerator) {
                const retryReasonText = accelerator.retryReasons
                    ? Object.entries(accelerator.retryReasons)
                        .filter(([, count]) => count > 0)
                        .map(([reason, count]) => `${reason}=${count}`)
                        .join(', ')
                    : '';
                statusMessage +=
                    `\n⚡ Accelerator: retries=${accelerator.retriedBatches}, failed=${accelerator.failedBatches}, ` +
                    `insertConcurrency=${accelerator.insertConcurrency ?? 1}, effectiveInsertConcurrency=${accelerator.effectiveInsertConcurrency ?? accelerator.insertConcurrency ?? 1}, ` +
                    `vectorBackend=${accelerator.vectorWritePolicy?.backend ?? 'unknown'}, insertClamp=${accelerator.backendClampReason ?? accelerator.vectorWritePolicy?.backendClampReason ?? 'none'}, ` +
                    `queuedInsert=${accelerator.queuedInsertBatches ?? 0}, ` +
                    `runningInsert=${accelerator.runningInsertBatches ?? accelerator.inFlightInsertBatches ?? 0}, ` +
                    `queuedCoalescedDocs=${accelerator.queuedCoalescedDocuments ?? 0}, coalescedWrites=${accelerator.coalescedInsertBatches ?? 0}, ` +
                    `coalescedDocs=${accelerator.coalescedInsertDocuments ?? 0}, ` +
                    `completedInsert=${accelerator.completedInsertBatches ?? 0}, failedInsert=${accelerator.failedInsertBatches ?? 0}, ` +
                    `activeWorkers=${accelerator.activeWorkers ?? 0}, rejectedWorkers=${accelerator.rejectedWorkers ?? 0}, ` +
                    `recoveredWorkers=${accelerator.workerLifecycle?.recovered ?? 0}` +
                    `${retryReasonText ? `, retryReasons=${retryReasonText}` : ''}`;
            }
            if (oneCScopeStatus.reducedCoverageWarning) {
                statusMessage += `\n⚠️ 1C scope: ${oneCScopeStatus.reducedCoverageWarning}`;
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

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Error getting indexing status: ${getErrorMessage(error)}`
                }],
                isError: true
            };
        }
    }
} 
