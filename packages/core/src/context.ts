import { Splitter, CodeChunk, AstCodeSplitter } from "./splitter";
import {
    Embedding,
    EmbeddingVector,
    MultiVectorEmbedding,
    EmbeddingContextLimitError,
    OpenAIEmbedding,
} from "./embedding";
import {
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchResult,
    RetrievalMode,
    RetrievalSchemaMetadata,
    VectorWriteCapabilities,
} from "./vectordb";
import { SemanticSearchResult } from "./types";
import {
    CodeSymbolProvider,
    RlmToolsBslSubprocessProvider,
    collectCodeSymbolCandidates,
    fuseCodeSearchResults,
    RankingProfile,
    resolveRankingProfile,
} from "./code-symbol-retrieval";
import {
    DEFAULT_IGNORE_PATTERNS,
    DEFAULT_SUPPORTED_EXTENSIONS,
} from "./config-defaults";
import { envManager } from "./utils/env-manager";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { FileSynchronizer } from "./sync/synchronizer";
import {
    isPreIndexTraversalDiagnosticsEnabled,
    PreIndexTraversalResult,
    traversePreIndex,
} from "./sync/preindex-traversal";
import { OneCIndexScopeProfile, OneCIndexScopeSummary } from "./sync/one-c-scope";
import {
    EmbeddingWorkerFailureReason,
    IndexingBatchMetadata,
    IndexingAcceleratorConfig,
    IndexingAcceleratorResourcePressure,
    IndexingAcceleratorRuntime,
    IndexingAcceleratorSnapshot,
    IndexingAcceleratorWorkerSnapshot,
    getEffectiveEmbeddingPayloadLimits,
    getIndexingAcceleratorConfig,
    resolveVectorWritePolicy,
    shouldAccelerateIndexing,
} from "./indexing-accelerator";
import { EmbeddingBatchScheduler } from "./embedding-batch-scheduler";
import {
    inferRetrievalProfile,
    resolveRetrievalProfile,
    RETRIEVAL_SCHEMA_VERSION,
    RetrievalProfile,
    ResolvedRetrievalProfile,
} from "./retrieval-profile";
import {
    CodebaseIndexEnricher,
    CodebaseIndexEnrichmentSession,
    DisabledCodebaseIndexEnricher,
    RlmBslEnrichmentConfig,
    RlmBslCompatibilityProof,
} from "./rlm-bsl-enrichment";
import {
    InitialIndexingManifest,
    InitialIndexingManifestStore,
} from "./indexing-manifest";
import { planIndexingMode } from "./indexing-mode-planner";

const DEFAULT_CODE_CHUNK_LIMIT = 450000;

type PreparedChunkBatchInsert = {
    collectionName: string;
    documents: VectorDocument[];
    insertMode: "regular" | "hybrid" | "bge_m3";
    useBgeM3Upsert: boolean;
};

function normalizeCodebasePath(codebasePath: string): string {
    const trimmedPath = codebasePath.trim();

    if (process.platform === "linux") {
        const match = trimmedPath.match(
            /^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.*)$/i,
        );
        if (match) {
            const [, distroName, rawPath] = match;
            const currentDistro = process.env.WSL_DISTRO_NAME;

            if (
                currentDistro &&
                distroName.toLowerCase() !== currentDistro.toLowerCase()
            ) {
                console.warn(
                    `[Context] Received WSL UNC path for distro '${distroName}', ` +
                        `but current runtime is '${currentDistro}'. Attempting best-effort normalization.`,
                );
            }

            const posixPath = `/${rawPath.split("\\").filter(Boolean).join("/")}`;
            return path.resolve(posixPath);
        }
    }

    return path.resolve(trimmedPath);
}

function isFatalEmbeddingBatchError(error: unknown): boolean {
    if (error instanceof EmbeddingContextLimitError) {
        return true;
    }

    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code ===
            "EMBEDDING_CONTEXT_LIMIT_EXCEEDED"
    );
}

function isPayloadSizeEmbeddingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Cannot create a string longer than|payload too large|request entity too large|body too large|content length|413/i.test(message);
}

function isIndexingBatchStageError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /^Indexing batch \d+ failed during (embedding|insert):/.test(message);
}

export function parseCodeChunkLimit(rawLimit?: string): number {
    if (!rawLimit) {
        return DEFAULT_CODE_CHUNK_LIMIT;
    }

    const parsedLimit = Number.parseInt(rawLimit, 10);
    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
        return parsedLimit;
    }

    console.warn(
        `[Context] ⚠️  Invalid CODE_CHUNK_LIMIT value '${rawLimit}'. ` +
            `Using default ${DEFAULT_CODE_CHUNK_LIMIT}.`,
    );
    return DEFAULT_CODE_CHUNK_LIMIT;
}

export function getCodeChunkLimit(): number {
    return parseCodeChunkLimit(envManager.get("CODE_CHUNK_LIMIT"));
}

function throwIfOperationAborted(abortSignal?: AbortSignal): void {
    if (!abortSignal?.aborted) {
        return;
    }

    const reason = abortSignal.reason;
    if (reason instanceof Error) {
        throw reason;
    }

    if (typeof reason === "string" && reason.trim().length > 0) {
        throw new IndexAbortError(reason);
    }

    throw new IndexAbortError("Operation cancelled.");
}

export class IndexAbortError extends Error {
    constructor(message: string = "Indexing aborted") {
        super(message);
        this.name = "IndexAbortError";
    }
}

export interface ContextConfig {
    embedding?: Embedding;
    vectorDatabase?: VectorDatabase;
    codeSplitter?: Splitter;
    supportedExtensions?: string[];
    ignorePatterns?: string[];
    customExtensions?: string[]; // New: custom extensions from MCP
    customIgnorePatterns?: string[]; // New: custom ignore patterns from MCP
    collectionNameOverride?: string;
    acceleratorResourceSnapshotProvider?: () => IndexingAcceleratorResourcePressure | undefined;
    codeSymbolProviders?: CodeSymbolProvider[];
    codebaseIndexEnricher?: CodebaseIndexEnricher;
    rlmBslEnrichment?: RlmBslEnrichmentConfig;
    retrievalProfile?: RetrievalProfile;
    initialIndexingManifestRoot?: string;
}

export interface CodebaseSessionConfig {
    customExtensions?: string[];
    customIgnorePatterns?: string[];
    retrievalProfile?: RetrievalProfile;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
    rlmBslEnrichment?: RlmBslEnrichmentConfig;
}

export interface SemanticSearchOptions {
    rankingProfile?: RankingProfile;
}

interface ProcessFileListOptions {
    abortSignal?: AbortSignal;
    allowAcceleration?: boolean;
    isBackgroundSync?: boolean;
    enrichmentSession?: CodebaseIndexEnrichmentSession;
    preIndexTraversal?: PreIndexTraversalResult;
    onBatchProgress?: (
        snapshot: IndexingAcceleratorSnapshot,
        state: { productionComplete: boolean },
    ) => void;
    manifestRecorder?: InitialIndexingManifestRecorder;
    skipDocumentIds?: Set<string>;
    startingBatchSequence?: number;
}

interface InitialIndexingManifestRecorder {
    onBatchPlanned(batchId: string, batch: Array<{ chunk: CodeChunk; codebasePath: string }>): Promise<void>;
    onBatchEmbedding(batchId: string): Promise<void>;
    onBatchInserting(batchId: string): Promise<void>;
    onBatchInserted(batchId: string, documentIds: string[]): Promise<void>;
    onBatchFailed(batchId: string, error: unknown): Promise<void>;
}

interface CodebaseSessionState {
    codebasePath: string;
    customExtensions: string[];
    customIgnorePatterns: string[];
    retrievalProfile?: RetrievalProfile;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
    rlmBslEnrichment?: RlmBslEnrichmentConfig;
    enrichmentOutcome?: CodebaseIndexEnrichmentSession['status'];
    enrichmentDiagnostics?: Record<string, unknown>;
    enrichmentCompatibility?: RlmBslCompatibilityProof;
    fileIgnorePatterns: string[];
    effectiveExtensions: string[];
    effectiveIgnorePatterns: string[];
    synchronizer?: FileSynchronizer;
}

type MultiVectorEmbeddingProvider = Embedding & {
    embedMulti(text: string): Promise<MultiVectorEmbedding>;
    embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]>;
    embedMultiBatchWithWorkerPool?(
        texts: string[],
        onRetry?: (
            workerEndpoint: string,
            error: Error,
            failure?: {
                reason: EmbeddingWorkerFailureReason;
                retrySafe: boolean;
                evidence?: import("./indexing-accelerator").EmbeddingFailureEvidence;
            },
        ) => void,
        requestContext?: {
            logicalBatchId?: number;
            chunkCount?: number;
            contentCharCount?: number;
            estimatedTokens?: number;
            maxContentChars?: number;
            maxEstimatedTokens?: number;
        },
    ): Promise<MultiVectorEmbedding[]>;
};

type WorkerSnapshotProvider = Embedding & {
    getWorkerSnapshot(): IndexingAcceleratorWorkerSnapshot[];
};

type WorkerCapacityProvider = Embedding & {
    getWorkerPoolSize(): number;
};

export class Context {
    private static readonly MAX_COLLECTION_NAME_LENGTH = 255;
    private embedding: Embedding;
    private vectorDatabase: VectorDatabase;
    private codeSplitter: Splitter;
    private defaultSupportedExtensions: string[];
    private defaultIgnorePatterns: string[];
    private collectionNameOverride?: string;
    private defaultRetrievalProfile?: RetrievalProfile;
    private warnedOverrideSanitization = new Set<string>();
    private codebaseSessions = new Map<string, CodebaseSessionState>();
    private synchronizers = new Map<string, FileSynchronizer>();
    private lastAcceleratorSnapshot?: IndexingAcceleratorSnapshot;
    private acceleratorResourceSnapshotProvider?: () => IndexingAcceleratorResourcePressure | undefined;
    private codeSymbolProviders: CodeSymbolProvider[];
    private explicitCodebaseIndexEnricher?: CodebaseIndexEnricher;
    private rlmBslEnrichmentRuntimeStatus = new Map<string, Record<string, unknown>>();
    private initialIndexingManifestStore: InitialIndexingManifestStore;
    private lastInitialIndexingManifest?: InitialIndexingManifest;

    constructor(config: ContextConfig = {}) {
        // Initialize services
        this.embedding =
            config.embedding ||
            new OpenAIEmbedding({
                apiKey:
                    envManager.get("OPENAI_API_KEY") || "your-openai-api-key",
                model: "text-embedding-3-small",
                ...(envManager.get("OPENAI_BASE_URL") && {
                    baseURL: envManager.get("OPENAI_BASE_URL"),
                }),
            });

        if (!config.vectorDatabase) {
            throw new Error(
                "VectorDatabase is required. Please provide a vectorDatabase instance in the config.",
            );
        }
        this.vectorDatabase = config.vectorDatabase;

        this.codeSplitter =
            config.codeSplitter || new AstCodeSplitter(2500, 300);

        // Load custom extensions from environment variables
        const envCustomExtensions = this.getCustomExtensionsFromEnv();

        // Combine default extensions with config extensions and env extensions
        const allSupportedExtensions = [
            ...DEFAULT_SUPPORTED_EXTENSIONS,
            ...(config.supportedExtensions || []),
            ...(config.customExtensions || []),
            ...envCustomExtensions,
        ];
        // Remove duplicates
        this.defaultSupportedExtensions = [...new Set(allSupportedExtensions)];

        // Load custom ignore patterns from environment variables
        const envCustomIgnorePatterns = this.getCustomIgnorePatternsFromEnv();

        // Start with default ignore patterns
        const allIgnorePatterns = [
            ...DEFAULT_IGNORE_PATTERNS,
            ...(config.ignorePatterns || []),
            ...(config.customIgnorePatterns || []),
            ...envCustomIgnorePatterns,
        ];
        // Remove duplicates
        this.defaultIgnorePatterns = [...new Set(allIgnorePatterns)];
        this.collectionNameOverride = config.collectionNameOverride;
        this.defaultRetrievalProfile = config.retrievalProfile;
        this.initialIndexingManifestStore = new InitialIndexingManifestStore(
            config.initialIndexingManifestRoot ||
            path.join(os.homedir(), ".context", "initial-indexing-manifests"),
        );
        this.acceleratorResourceSnapshotProvider = config.acceleratorResourceSnapshotProvider;
        this.codeSymbolProviders = config.codeSymbolProviders || this.createCodeSymbolProvidersFromEnv();
        this.explicitCodebaseIndexEnricher = config.codebaseIndexEnricher;
        console.log(
            `[Context] 🔧 Initialized with ${this.defaultSupportedExtensions.length} supported extensions and ${this.defaultIgnorePatterns.length} ignore patterns`,
        );
        if (envCustomExtensions.length > 0) {
            console.log(
                `[Context] 📎 Loaded ${envCustomExtensions.length} custom extensions from environment: ${envCustomExtensions.join(", ")}`,
            );
        }
        if (envCustomIgnorePatterns.length > 0) {
            console.log(
                `[Context] 🚫 Loaded ${envCustomIgnorePatterns.length} custom ignore patterns from environment: ${envCustomIgnorePatterns.join(", ")}`,
            );
        }
    }

    getLastAcceleratorSnapshot(): IndexingAcceleratorSnapshot | undefined {
        if (!this.lastAcceleratorSnapshot) {
            return undefined;
        }
        const snapshot: IndexingAcceleratorSnapshot = {
            ...this.lastAcceleratorSnapshot,
            batches: this.lastAcceleratorSnapshot.batches.map((batch) => ({ ...batch })),
            workers: this.lastAcceleratorSnapshot.workers?.map((worker) => ({ ...worker })),
        };
        const workers = this.getCurrentAcceleratorWorkerSnapshot();
        if (workers) {
            snapshot.activeWorkers = workers.filter((worker) => worker.healthy).length;
            snapshot.rejectedWorkers = workers.filter((worker) => worker.rejectedReason).length;
            snapshot.workers = workers;
        }
        return snapshot;
    }

    getLastInitialIndexingManifest(): InitialIndexingManifest | undefined {
        if (!this.lastInitialIndexingManifest) {
            return undefined;
        }
        return {
            ...this.lastInitialIndexingManifest,
            identity: {
                ...this.lastInitialIndexingManifest.identity,
                supportedExtensions: [...this.lastInitialIndexingManifest.identity.supportedExtensions],
                ignorePatterns: [...this.lastInitialIndexingManifest.identity.ignorePatterns],
            },
            traversal: { ...this.lastInitialIndexingManifest.traversal },
            batches: this.lastInitialIndexingManifest.batches.map((batch) => ({
                ...batch,
                filePaths: [...batch.filePaths],
                documentIds: [...batch.documentIds],
            })),
            confirmedDocumentIds: [...this.lastInitialIndexingManifest.confirmedDocumentIds],
        };
    }

    private getCurrentAcceleratorWorkerSnapshot(): IndexingAcceleratorWorkerSnapshot[] | undefined {
        const candidate = this.embedding as Embedding & Partial<WorkerSnapshotProvider>;
        if (typeof candidate.getWorkerSnapshot !== "function") {
            return undefined;
        }

        return candidate.getWorkerSnapshot();
    }

    private buildInitialIndexingManifest(
        codebasePath: string,
        session: CodebaseSessionState,
        preIndexTraversal: PreIndexTraversalResult,
    ): InitialIndexingManifest {
        const resolvedRetrieval = this.getResolvedRetrievalProfile(codebasePath);
        const vectorWriteCapabilities = this.vectorDatabase.getWriteCapabilities?.();
        const identity = {
            codebasePath,
            collectionName: this.getCollectionName(codebasePath),
            vectorBackend: vectorWriteCapabilities?.backend || this.vectorDatabase.constructor.name || "unknown",
            retrievalMode: resolvedRetrieval.retrievalMode,
            vectorSchemaFingerprint: `retrieval-schema:${resolvedRetrieval.retrievalSchemaVersion}`,
            embeddingProfileFingerprint: `${this.embedding.getProvider()}:${resolvedRetrieval.retrievalProfile}:${resolvedRetrieval.retrievalMode}`,
            splitterFingerprint: this.codeSplitter.constructor.name,
            fileSelectionFingerprint: this.createPreIndexTraversalFingerprint(preIndexTraversal),
            supportedExtensions: session.effectiveExtensions,
            ignorePatterns: session.effectiveIgnorePatterns,
            ...(session.oneCIndexScopeProfile ? { oneCIndexScopeProfile: session.oneCIndexScopeProfile } : {}),
        };
        const manifest = this.initialIndexingManifestStore.create(identity);
        manifest.runState = "indexing";
        manifest.traversal = {
            selectedFileCount: preIndexTraversal.selectedFileCount,
            hashedFileCount: preIndexTraversal.hashedFileCount,
            selectedFileFingerprint: identity.fileSelectionFingerprint,
        };
        return manifest;
    }

    private async hasSynchronizerSnapshot(codebasePath: string): Promise<boolean> {
        try {
            await fs.promises.access(FileSynchronizer.getSnapshotPathForCodebase(codebasePath));
            return true;
        } catch {
            return false;
        }
    }

    private getInitialIndexingWriteSafety(collectionName: string): {
        regular: boolean;
        hybrid: boolean;
        bge_m3: boolean;
    } {
        const capabilities: VectorWriteCapabilities | undefined =
            this.vectorDatabase.getWriteCapabilities?.(collectionName);
        const idempotentWrite = capabilities?.idempotentUpsert === true;
        return {
            regular: idempotentWrite,
            hybrid: idempotentWrite,
            bge_m3: idempotentWrite && typeof this.vectorDatabase.upsertBgeM3 === "function",
        };
    }

    private createPreIndexTraversalFingerprint(preIndexTraversal: PreIndexTraversalResult): string {
        if (preIndexTraversal.diagnostics?.selectedPathHashFingerprint) {
            return preIndexTraversal.diagnostics.selectedPathHashFingerprint;
        }
        const hash = crypto.createHash("sha256");
        for (const file of preIndexTraversal.files) {
            hash.update(file.relativePath);
            hash.update("\0");
            hash.update(file.hash || "");
            hash.update("\0");
        }
        return hash.digest("hex");
    }

    private createInitialIndexingManifestRecorder(
        manifest: InitialIndexingManifest,
    ): InitialIndexingManifestRecorder {
        const persist = async () => {
            await this.initialIndexingManifestStore.write(manifest);
            this.lastInitialIndexingManifest = manifest;
        };
        const findBatch = (batchId: string) => manifest.batches.find((batch) => batch.id === batchId);

        return {
            onBatchPlanned: async (batchId, batch) => {
                const documentIds = batch
                    .map((item) => item.chunk.metadata.documentId)
                    .filter((documentId): documentId is string => typeof documentId === "string");
                const filePaths = [
                    ...new Set(
                        batch
                            .map((item) => item.chunk.metadata.filePath)
                            .filter((filePath): filePath is string => typeof filePath === "string"),
                    ),
                ];
                manifest.batches.push({
                    id: batchId,
                    state: "planned",
                    filePaths,
                    documentIds,
                    updatedAt: new Date().toISOString(),
                });
                await persist();
            },
            onBatchEmbedding: async (batchId) => {
                const batch = findBatch(batchId);
                if (!batch) {
                    return;
                }
                batch.state = "embedding";
                batch.updatedAt = new Date().toISOString();
                await persist();
            },
            onBatchInserting: async (batchId) => {
                const batch = findBatch(batchId);
                if (!batch) {
                    return;
                }
                batch.state = "inserting";
                batch.updatedAt = new Date().toISOString();
                await persist();
            },
            onBatchInserted: async (batchId, documentIds) => {
                const batch = findBatch(batchId);
                if (!batch) {
                    return;
                }
                batch.state = "inserted";
                batch.documentIds = documentIds;
                batch.updatedAt = new Date().toISOString();
                const confirmed = new Set(manifest.confirmedDocumentIds);
                for (const documentId of documentIds) {
                    confirmed.add(documentId);
                }
                manifest.confirmedDocumentIds = [...confirmed].sort();
                await persist();
            },
            onBatchFailed: async (batchId, error) => {
                const batch = findBatch(batchId);
                if (!batch) {
                    return;
                }
                batch.state = "failed";
                batch.error = error instanceof Error ? error.message : String(error);
                batch.updatedAt = new Date().toISOString();
                manifest.runState = "failed";
                await persist();
            },
        };
    }

    private updateAcceleratorWorkerSnapshot(acceleratorRuntime: IndexingAcceleratorRuntime): void {
        const workers = this.getCurrentAcceleratorWorkerSnapshot();
        if (!workers) {
            return;
        }

        acceleratorRuntime.updateWorkerCounts(
            workers.filter((worker) => worker.healthy).length,
            workers.filter((worker) => worker.rejectedReason).length,
            workers,
        );
    }

    private getEmbeddingWorkerCapacity(): number | undefined {
        const candidate = this.embedding as Embedding & Partial<WorkerCapacityProvider>;
        if (typeof candidate.getWorkerPoolSize === "function") {
            return candidate.getWorkerPoolSize();
        }

        const workers = this.getCurrentAcceleratorWorkerSnapshot();
        if (!workers) {
            return undefined;
        }

        return workers.filter((worker) => worker.poolState !== "rejected").length;
    }

    private getEffectiveEmbeddingConcurrency(
        acceleratorConfig: IndexingAcceleratorConfig,
        accelerationActive: boolean,
        codebasePath?: string,
    ): number {
        if (!accelerationActive) {
            return 1;
        }

        if (this.getResolvedRetrievalProfile(codebasePath).retrievalMode !== "bge_m3_full") {
            return acceleratorConfig.embeddingConcurrency;
        }

        const workerCapacity = this.getEmbeddingWorkerCapacity();
        if (!workerCapacity || workerCapacity <= 0) {
            return acceleratorConfig.embeddingConcurrency;
        }

        return Math.max(
            acceleratorConfig.embeddingConcurrency,
            Math.min(workerCapacity, acceleratorConfig.maxBgeM3Workers),
        );
    }

    private resetAcceleratorSnapshotForPreIndex(
        codebasePath: string,
        preIndexTraversal: PreIndexTraversalResult,
        options: { allowAcceleration: boolean; isBackgroundSync: boolean },
    ): void {
        const acceleratorConfig = getIndexingAcceleratorConfig();
        const accelerationDecision = shouldAccelerateIndexing(acceleratorConfig, {
            isInitialOrForce: options.allowAcceleration,
            isBackgroundSync: options.isBackgroundSync,
        });
        const effectiveEmbeddingConcurrency = this.getEffectiveEmbeddingConcurrency(
            acceleratorConfig,
            accelerationDecision.active,
            codebasePath,
        );
        const effectiveAcceleratorConfig = {
            ...acceleratorConfig,
            embeddingConcurrency: effectiveEmbeddingConcurrency,
        };
        const acceleratorRuntime = new IndexingAcceleratorRuntime(
            effectiveAcceleratorConfig,
            accelerationDecision.active,
            accelerationDecision.fallbackReason,
        );
        acceleratorRuntime.recordCodebasePath(codebasePath);
        acceleratorRuntime.recordPreIndex({
            ...preIndexTraversal.timings,
            selectedFileCount: preIndexTraversal.selectedFileCount,
            hashedFileCount: preIndexTraversal.hashedFileCount,
            oneCIndexScope: preIndexTraversal.oneCIndexScope,
            diagnostics: preIndexTraversal.diagnostics,
        });
        this.updateAcceleratorWorkerSnapshot(acceleratorRuntime);
        this.lastAcceleratorSnapshot = acceleratorRuntime.getSnapshot();
    }

    private resetAcceleratorSnapshotForPreIndexStart(
        codebasePath: string,
        options: { allowAcceleration: boolean; isBackgroundSync: boolean },
    ): void {
        const acceleratorConfig = getIndexingAcceleratorConfig();
        const accelerationDecision = shouldAccelerateIndexing(acceleratorConfig, {
            isInitialOrForce: options.allowAcceleration,
            isBackgroundSync: options.isBackgroundSync,
        });
        const effectiveEmbeddingConcurrency = this.getEffectiveEmbeddingConcurrency(
            acceleratorConfig,
            accelerationDecision.active,
            codebasePath,
        );
        const effectiveAcceleratorConfig = {
            ...acceleratorConfig,
            embeddingConcurrency: effectiveEmbeddingConcurrency,
        };
        const acceleratorRuntime = new IndexingAcceleratorRuntime(
            effectiveAcceleratorConfig,
            accelerationDecision.active,
            accelerationDecision.fallbackReason,
        );
        acceleratorRuntime.recordCodebasePath(codebasePath);
        acceleratorRuntime.recordPreIndexStart();
        this.updateAcceleratorWorkerSnapshot(acceleratorRuntime);
        this.lastAcceleratorSnapshot = acceleratorRuntime.getSnapshot();
    }

    private normalizeExtensionsList(extensions: string[] = []): string[] {
        return [
            ...new Set(
                extensions
                    .map((ext) => ext.trim())
                    .filter((ext) => ext.length > 0)
                    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)),
            ),
        ];
    }

    private normalizeIgnorePatternsList(patterns: string[] = []): string[] {
        return [
            ...new Set(
                patterns
                    .map((pattern) => pattern.trim())
                    .filter((pattern) => pattern.length > 0),
            ),
        ];
    }

    private buildEffectiveExtensions(
        customExtensions: string[] = [],
        oneCIndexScopeProfile?: OneCIndexScopeProfile,
    ): string[] {
        const profileExtensions = oneCIndexScopeProfile === "v8unpack"
            ? [".json"]
            : [];
        return [
            ...new Set([
                ...this.defaultSupportedExtensions,
                ...customExtensions,
                ...profileExtensions,
            ]),
        ];
    }

    private buildEffectiveIgnorePatterns(
        customIgnorePatterns: string[] = [],
        fileIgnorePatterns: string[] = [],
    ): string[] {
        return [
            ...new Set([
                ...this.defaultIgnorePatterns,
                ...customIgnorePatterns,
                ...fileIgnorePatterns,
            ]),
        ];
    }

    private getCodebaseSession(
        codebasePath: string,
    ): CodebaseSessionState | undefined {
        return this.codebaseSessions.get(normalizeCodebasePath(codebasePath));
    }

    private getOrCreateCodebaseSession(
        codebasePath: string,
    ): CodebaseSessionState {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const existingSession = this.codebaseSessions.get(normalizedPath);
        if (existingSession) {
            return existingSession;
        }

        const nextSession: CodebaseSessionState = {
            codebasePath: normalizedPath,
            customExtensions: [],
            customIgnorePatterns: [],
            retrievalProfile: this.defaultRetrievalProfile,
            fileIgnorePatterns: [],
            effectiveExtensions: [...this.defaultSupportedExtensions],
            effectiveIgnorePatterns: [...this.defaultIgnorePatterns],
        };
        this.codebaseSessions.set(normalizedPath, nextSession);
        return nextSession;
    }

    private updateSessionEffectiveState(session: CodebaseSessionState): void {
        session.effectiveExtensions = this.buildEffectiveExtensions(
            session.customExtensions,
            session.oneCIndexScopeProfile,
        );
        session.effectiveIgnorePatterns = this.buildEffectiveIgnorePatterns(
            session.customIgnorePatterns,
            session.fileIgnorePatterns,
        );
        session.synchronizer?.updateIgnorePatterns(
            session.effectiveIgnorePatterns,
        );
        session.synchronizer?.updateSupportedExtensions(
            session.effectiveExtensions,
        );
        session.synchronizer?.updateOneCIndexScopeProfile(
            session.oneCIndexScopeProfile,
        );
    }

    configureCodebaseSession(
        codebasePath: string,
        config: CodebaseSessionConfig = {},
    ): CodebaseSessionConfig {
        const session = this.getOrCreateCodebaseSession(codebasePath);
        session.customExtensions = this.normalizeExtensionsList(
            config.customExtensions || [],
        );
        session.customIgnorePatterns = this.normalizeIgnorePatternsList(
            config.customIgnorePatterns || [],
        );
        const hasPersistedRetrievalShape = Boolean(config.retrievalMode && typeof config.retrievalSchemaVersion === "number");
        session.retrievalProfile = config.retrievalProfile ?? (hasPersistedRetrievalShape ? undefined : this.defaultRetrievalProfile);
        session.retrievalMode = config.retrievalMode;
        session.retrievalSchemaVersion = config.retrievalSchemaVersion;
        session.oneCIndexScopeProfile = config.oneCIndexScopeProfile;
        session.rlmBslEnrichment = undefined;
        this.updateSessionEffectiveState(session);

        console.log(
            `[Context] 🧩 Configured codebase session for ${session.codebasePath}: ` +
                `${session.customExtensions.length} custom extensions, ${session.customIgnorePatterns.length} custom ignore patterns`,
        );

        return this.getCodebaseSessionConfig(session.codebasePath) || {};
    }

    getCodebaseSessionConfig(
        codebasePath: string,
    ): CodebaseSessionConfig | undefined {
        const session = this.getCodebaseSession(codebasePath);
        if (!session) {
            return undefined;
        }

        const resolvedRetrieval = this.getResolvedRetrievalProfile(session.codebasePath);
        return {
            customExtensions: [...session.customExtensions],
            customIgnorePatterns: [...session.customIgnorePatterns],
            retrievalProfile: session.retrievalProfile ?? resolvedRetrieval.retrievalProfile,
            retrievalMode: resolvedRetrieval.retrievalMode,
            retrievalSchemaVersion: resolvedRetrieval.retrievalSchemaVersion,
            ...(session.oneCIndexScopeProfile ? { oneCIndexScopeProfile: session.oneCIndexScopeProfile } : {}),
        };
    }

    hasCodebaseSession(codebasePath: string): boolean {
        return this.codebaseSessions.has(normalizeCodebasePath(codebasePath));
    }

    clearCodebaseSession(codebasePath: string): void {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const collectionName = this.getCollectionName(normalizedPath);
        this.codebaseSessions.delete(normalizedPath);
        this.synchronizers.delete(collectionName);
    }

    setSynchronizerForCodebase(
        codebasePath: string,
        synchronizer: FileSynchronizer,
    ): void {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const session = this.getOrCreateCodebaseSession(normalizedPath);
        synchronizer.updateIgnorePatterns(session.effectiveIgnorePatterns);
        synchronizer.updateSupportedExtensions(session.effectiveExtensions);
        synchronizer.updateOneCIndexScopeProfile(session.oneCIndexScopeProfile);
        session.synchronizer = synchronizer;
        this.synchronizers.set(
            this.getCollectionName(normalizedPath),
            synchronizer,
        );
    }

    /**
     * Get embedding instance
     */
    getEmbedding(): Embedding {
        return this.embedding;
    }

    /**
     * Get vector database instance
     */
    getVectorDatabase(): VectorDatabase {
        return this.vectorDatabase;
    }

    /**
     * Get code splitter instance
     */
    getCodeSplitter(): Splitter {
        return this.codeSplitter;
    }

    /**
     * Get supported extensions
     */
    getSupportedExtensions(codebasePath?: string): string[] {
        if (!codebasePath) {
            return [...this.defaultSupportedExtensions];
        }

        return [
            ...this.getOrCreateCodebaseSession(codebasePath)
                .effectiveExtensions,
        ];
    }

    /**
     * Get ignore patterns
     */
    getIgnorePatterns(codebasePath?: string): string[] {
        if (!codebasePath) {
            return [...this.defaultIgnorePatterns];
        }

        return [
            ...this.getOrCreateCodebaseSession(codebasePath)
                .effectiveIgnorePatterns,
        ];
    }

    /**
     * Get synchronizers map
     */
    getSynchronizers(): Map<string, FileSynchronizer> {
        return new Map(this.synchronizers);
    }

    /**
     * Set synchronizer for a collection
     */
    setSynchronizer(
        collectionName: string,
        synchronizer: FileSynchronizer,
    ): void {
        this.synchronizers.set(collectionName, synchronizer);
    }

    /**
     * Public wrapper for loadIgnorePatterns private method
     */
    async getLoadedIgnorePatterns(codebasePath: string): Promise<void> {
        codebasePath = normalizeCodebasePath(codebasePath);
        this.getOrCreateCodebaseSession(codebasePath);
        return this.loadIgnorePatterns(codebasePath);
    }

    /**
     * Public wrapper for prepareCollection private method
     */
    async getPreparedCollection(codebasePath: string, forceReindex: boolean = false): Promise<void> {
        codebasePath = normalizeCodebasePath(codebasePath);
        this.getOrCreateCodebaseSession(codebasePath);
        return this.prepareCollection(codebasePath, forceReindex);
    }

    /**
     * Get isHybrid setting from environment variable with default true
     */
    private getIsHybrid(): boolean {
        const isHybridEnv = envManager.get("HYBRID_MODE");
        if (isHybridEnv === undefined || isHybridEnv === null) {
            return true; // Default to true
        }
        return isHybridEnv.toLowerCase() === "true";
    }

    private getRawRetrievalMode(): RetrievalMode {
        if (this.embedding.getProvider() === "BGE_M3") {
            const bgeMode = (this.embedding as Embedding & { getMode?: () => string }).getMode?.();
            return bgeMode === "dense" ? "bge_m3_dense" : "bge_m3_full";
        }

        return this.getIsHybrid() ? "hybrid_bm25" : "dense";
    }

    private getResolvedRetrievalProfile(codebasePath?: string): ResolvedRetrievalProfile {
        const session = codebasePath ? this.getCodebaseSession(codebasePath) : undefined;
        const bgeMode = (this.embedding as Embedding & { getMode?: () => string }).getMode?.() === "dense"
            ? "dense"
            : "full";
        const resolved = resolveRetrievalProfile({
            embeddingProvider: this.embedding.getProvider(),
            retrievalProfile: session?.retrievalProfile ?? this.defaultRetrievalProfile,
            bgeM3Mode: bgeMode,
            bgeM3StoreColbert: bgeMode === "full",
            hybridMode: this.getIsHybrid(),
        });

        if (
            session?.retrievalMode &&
            session.retrievalSchemaVersion === RETRIEVAL_SCHEMA_VERSION &&
            (session.retrievalProfile === undefined || inferRetrievalProfile(session.retrievalMode) === resolved.retrievalProfile)
        ) {
            return {
                ...resolved,
                retrievalProfile: session.retrievalProfile ?? inferRetrievalProfile(session.retrievalMode),
                retrievalMode: session.retrievalMode,
                retrievalSchemaVersion: session.retrievalSchemaVersion,
            };
        }

        return resolved;
    }

    private getCollectionPrefixForMode(mode: RetrievalMode = this.getRawRetrievalMode()): string {
        switch (mode) {
            case "bge_m3_full":
                return "bge_m3_code_chunks";
            case "bge_m3_dense":
                return "bge_m3_dense_code_chunks";
            case "hybrid_bm25":
                return "hybrid_code_chunks";
            case "dense":
            default:
                return "code_chunks";
        }
    }

    private getMultiVectorBatchEmbeddingProvider(): MultiVectorEmbeddingProvider | undefined {
        const candidate = this.embedding as Embedding & Partial<MultiVectorEmbeddingProvider>;
        return typeof candidate.embedMulti === "function" && typeof candidate.embedMultiBatch === "function"
            ? candidate as MultiVectorEmbeddingProvider
            : undefined;
    }

    private getBgeM3CandidateLimit(topK: number): number {
        const rawLimit = envManager.get("BGE_M3_CANDIDATE_LIMIT");
        if (!rawLimit) {
            return Math.max(100, topK);
        }

        const parsedLimit = Number.parseInt(rawLimit, 10);
        return Number.isInteger(parsedLimit) && parsedLimit > 0
            ? parsedLimit
            : Math.max(100, topK);
    }

    private getBgeM3RerankLimit(topK: number): number {
        const rawLimit = envManager.get("BGE_M3_RERANK_LIMIT");
        if (!rawLimit) {
            return Math.max(100, topK);
        }

        const parsedLimit = Number.parseInt(rawLimit, 10);
        return Number.isInteger(parsedLimit) && parsedLimit > 0
            ? parsedLimit
            : Math.max(100, topK);
    }

    private createCodeSymbolProvidersFromEnv(): CodeSymbolProvider[] {
        return [];
    }

    private getCodebaseIndexEnricherForSession(_session: CodebaseSessionState): CodebaseIndexEnricher {
        if (this.explicitCodebaseIndexEnricher) {
            return this.explicitCodebaseIndexEnricher;
        }
        return new DisabledCodebaseIndexEnricher();
    }

    private getCodeSymbolRetrievalEnabled(): boolean {
        const raw = envManager.get("CODE_SYMBOL_RETRIEVAL");
        return raw === undefined || raw === null || raw.toLowerCase() !== "false";
    }

    private getCodeSymbolRetrievalOptions(topK: number) {
        return {
            maxLexicalCandidates: this.parsePositiveEnvInt("CODE_SYMBOL_MAX_LEXICAL_CANDIDATES", Math.max(50, topK * 10)),
            maxProviderCandidates: this.parsePositiveEnvInt("CODE_SYMBOL_MAX_PROVIDER_CANDIDATES", Math.max(20, topK * 5)),
            providerTimeoutMs: this.parsePositiveEnvInt("CODE_SYMBOL_PROVIDER_TIMEOUT_MS", 750),
        };
    }

    private parsePositiveEnvInt(name: string, defaultValue: number): number {
        const rawValue = envManager.get(name);
        if (!rawValue) {
            return defaultValue;
        }
        const parsedValue = Number.parseInt(rawValue, 10);
        return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
    }

    private getBgeM3ColbertTokenLimit(): number {
        const rawLimit = envManager.get("BGE_M3_COLBERT_TOKEN_LIMIT");
        if (!rawLimit) {
            return 4;
        }

        const parsedLimit = Number.parseInt(rawLimit, 10);
        return Number.isInteger(parsedLimit) && parsedLimit > 0
            ? parsedLimit
            : 4;
    }

    private getBgeM3ColbertDecimalPlaces(): number {
        const rawPlaces = envManager.get("BGE_M3_COLBERT_DECIMAL_PLACES");
        if (!rawPlaces) {
            return 6;
        }

        const parsedPlaces = Number.parseInt(rawPlaces, 10);
        return Number.isInteger(parsedPlaces) && parsedPlaces >= 0
            ? parsedPlaces
            : 6;
    }

    private compactBgeM3ColbertVectors(vectors: number[][]): number[][] {
        const tokenLimit = this.getBgeM3ColbertTokenLimit();
        const decimalPlaces = this.getBgeM3ColbertDecimalPlaces();
        const scale = 10 ** decimalPlaces;

        return vectors.slice(0, tokenLimit).map((vector) =>
            vector.map((value) => Math.round(value * scale) / scale),
        );
    }

    private dotProduct(left: number[], right: number[]): number {
        const length = Math.min(left.length, right.length);
        let score = 0;
        for (let index = 0; index < length; index += 1) {
            score += left[index] * right[index];
        }
        return score;
    }

    private scoreColbertMaxSim(queryVectors: number[][], documentVectors: number[][]): number {
        if (queryVectors.length === 0 || documentVectors.length === 0) {
            return 0;
        }

        let totalScore = 0;
        for (const queryVector of queryVectors) {
            let maxScore = Number.NEGATIVE_INFINITY;
            for (const documentVector of documentVectors) {
                maxScore = Math.max(maxScore, this.dotProduct(queryVector, documentVector));
            }
            totalScore += maxScore;
        }
        return totalScore / queryVectors.length;
    }

    private rerankBgeM3Results(
        queryColbertVectors: number[][],
        searchResults: HybridSearchResult[],
        limit: number,
    ): HybridSearchResult[] {
        return searchResults
            .map((result) => {
                if (!result.document.colbertVectors || result.document.colbertVectors.length === 0) {
                    throw new Error(
                        `BGE-M3 full retrieval candidate '${result.document.id}' is missing ColBERT vectors. Clear or force reindex the collection if the stored vectors are missing; otherwise verify that the vector backend returns stored ColBERT vectors for rerank.`,
                    );
                }

                return {
                    ...result,
                    score: this.scoreColbertMaxSim(queryColbertVectors, result.document.colbertVectors),
                    metadata: {
                        ...(result.metadata || {}),
                        rerank: {
                            applied: true,
                            strategy: "colbert_maxsim",
                            firstStageScore: result.score,
                        },
                    },
                };
            })
            .sort((left, right) => right.score - left.score)
            .slice(0, limit);
    }

    private assertBgeM3ResultsBelongToCodebase(searchResults: HybridSearchResult[], codebasePath: string): void {
        for (const result of searchResults) {
            const resultCodebasePath = result.document.metadata?.codebasePath;
            if (typeof resultCodebasePath !== "string" || resultCodebasePath.trim().length === 0) {
                continue;
            }

            const normalizedResultCodebasePath = normalizeCodebasePath(resultCodebasePath);
            if (normalizedResultCodebasePath !== codebasePath) {
                throw new Error(
                    `BGE-M3 full retrieval candidate '${result.document.id}' belongs to '${normalizedResultCodebasePath}', not '${codebasePath}'. Clear the vector collection or force reindex the target codebase.`,
                );
            }
        }
    }

    private getPathHash(codebasePath: string): string {
        return crypto
            .createHash("md5")
            .update(normalizeCodebasePath(codebasePath))
            .digest("hex")
            .substring(0, 8);
    }

    private getRetrievalCollectionDescription(codebasePath: string, retrieval: ResolvedRetrievalProfile): string {
        const session = this.codebaseSessions.get(codebasePath);
        const enrichment = session?.enrichmentCompatibility;
        const lines = [
            `codebasePath:${codebasePath}`,
            `retrievalProfile:${retrieval.retrievalProfile}`,
            `retrievalMode:${retrieval.retrievalMode}`,
            `retrievalSchemaVersion:${retrieval.retrievalSchemaVersion}`,
        ];
        if (enrichment) {
            lines.push(
                `enrichmentProvider:${enrichment.provider}`,
                `enrichmentProviderSchemaVersion:${enrichment.providerSchemaVersion}`,
                `enrichmentStatus:${enrichment.status}`,
                `enrichmentRawStatus:${enrichment.rawStatus}`,
                `enrichmentSourceRoot:${enrichment.sourceRoot}`,
                `enrichmentSourceFingerprint:${enrichment.sourceFingerprint}`,
            );
        } else if (session?.enrichmentOutcome === 'unavailable') {
            const rawStatus = session.enrichmentDiagnostics?.rawStatus;
            const normalizedStatus = session.enrichmentDiagnostics?.status;
            lines.push(
                `enrichmentProvider:rlm-tools-bsl`,
                `enrichmentStatus:unavailable`,
            );
            if (typeof normalizedStatus === "string") {
                lines.push(`enrichmentNormalizedStatus:${normalizedStatus}`);
            }
            if (typeof rawStatus === "string") {
                lines.push(`enrichmentRawStatus:${rawStatus}`);
            }
        }
        return lines.join("\n");
    }

    public getRlmBslEnrichmentRuntimeStatus(codebasePath: string): Record<string, unknown> | undefined {
        const collectionName = this.getCollectionName(codebasePath);
        const status = this.rlmBslEnrichmentRuntimeStatus.get(collectionName);
        return status ? { ...status } : undefined;
    }

    private parseRetrievalCollectionDescription(description: string): Partial<RetrievalSchemaMetadata> {
        const metadata: Partial<RetrievalSchemaMetadata> = {};
        for (const line of description.split(/\r?\n/)) {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex < 0) {
                continue;
            }

            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if (key === "retrievalMode") {
                metadata.retrievalMode = value as RetrievalMode;
            } else if (key === "retrievalSchemaVersion") {
                const parsedVersion = Number.parseInt(value, 10);
                if (Number.isInteger(parsedVersion)) {
                    metadata.schemaVersion = parsedVersion;
                }
            }
        }
        return metadata;
    }

    private parseCollectionDescriptionFields(description: string): Record<string, string> {
        const fields: Record<string, string> = {};
        for (const line of description.split(/\r?\n/)) {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex < 0) {
                continue;
            }
            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if (key.length > 0) {
                fields[key] = value;
            }
        }
        return fields;
    }

    private collectionDescriptionHasAvailableRlmBslEnrichment(description: string): boolean {
        let provider = "";
        let status = "";
        const fields = this.parseCollectionDescriptionFields(description);
        provider = fields.enrichmentProvider || "";
        status = fields.enrichmentStatus || "";
        return provider === "rlm-tools-bsl" && status === "available";
    }

    private collectionHasAvailableRlmBslEnrichment(collectionName: string, description: string): boolean {
        const runtimeStatus = this.rlmBslEnrichmentRuntimeStatus.get(collectionName);
        if (runtimeStatus) {
            return runtimeStatus.provider === "rlm-tools-bsl" && runtimeStatus.status === "available";
        }
        return this.collectionDescriptionHasAvailableRlmBslEnrichment(description);
    }

    private async recordRlmBslEnrichmentRuntimeStatus(
        codebasePath: string,
        session: CodebaseSessionState,
        source: "full" | "incremental",
    ): Promise<void> {
        const collectionName = this.getCollectionName(codebasePath);
        const hasConfiguredEnricher = Boolean(this.explicitCodebaseIndexEnricher)
            || Boolean(session.rlmBslEnrichment && session.rlmBslEnrichment.mode !== "disabled");
        if (!hasConfiguredEnricher) {
            this.rlmBslEnrichmentRuntimeStatus.delete(collectionName);
            return;
        }

        if (session.enrichmentCompatibility) {
            this.rlmBslEnrichmentRuntimeStatus.set(collectionName, {
                provider: session.enrichmentCompatibility.provider,
                status: session.enrichmentCompatibility.status,
                rawStatus: session.enrichmentCompatibility.rawStatus,
                providerSchemaVersion: session.enrichmentCompatibility.providerSchemaVersion,
                sourceFingerprint: session.enrichmentCompatibility.sourceFingerprint,
            });
            return;
        }

        if (session.enrichmentOutcome === "unavailable") {
            let status = "unavailable";
            if (source === "incremental") {
                const description = await this.vectorDatabase.getCollectionDescription(collectionName).catch(() => "");
                if (this.collectionDescriptionHasAvailableRlmBslEnrichment(description)) {
                    status = "mixed";
                }
            }
            this.rlmBslEnrichmentRuntimeStatus.set(collectionName, {
                provider: "rlm-tools-bsl",
                status,
                diagnostics: session.enrichmentDiagnostics,
            });
            return;
        }

        this.rlmBslEnrichmentRuntimeStatus.delete(collectionName);
    }

    private async validateExistingCollection(collectionName: string, codebasePath: string, requestedMode: RetrievalMode): Promise<void> {
        const description = await this.vectorDatabase.getCollectionDescription(collectionName);
        const metadata = this.parseRetrievalCollectionDescription(description || "");

        if (!metadata.retrievalMode && requestedMode !== "bge_m3_full") {
            return;
        }

        if (metadata.retrievalMode !== requestedMode || metadata.schemaVersion !== RETRIEVAL_SCHEMA_VERSION) {
            if (requestedMode === "bge_m3_full") {
                throw new Error(
                    `Existing collection '${collectionName}' for '${codebasePath}' has incompatible BGE-M3 collection metadata. Re-run indexing with force=true.`,
                );
            }
            throw new Error(
                `Existing collection '${collectionName}' for '${codebasePath}' has incompatible retrieval metadata. Re-run indexing with force=true.`,
            );
        }
    }

    private getCollectionNameForPrefix(codebasePath: string, prefix: string): string {
        const pathHash = this.getPathHash(codebasePath);

        const configOverride = this.getValidOverrideValue(this.collectionNameOverride);
        if (configOverride) {
            const suffix = this.sanitizeCollectionNameSuffix(configOverride, prefix, pathHash, "Context config");
            return `${prefix}_${suffix}`;
        }

        const envOverride = this.getValidOverrideValue(envManager.get("CODE_CHUNKS_COLLECTION_NAME_OVERRIDE"));
        if (envOverride) {
            const suffix = this.sanitizeCollectionNameSuffix(envOverride, prefix, pathHash, "CODE_CHUNKS_COLLECTION_NAME_OVERRIDE");
            return `${prefix}_${suffix}`;
        }

        return `${prefix}_${pathHash}`;
    }

    /**
     * Generate collection name based on codebase path and hybrid mode
     */
    public getCollectionName(codebasePath: string): string {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const retrievalMode = this.getResolvedRetrievalProfile(normalizedPath).retrievalMode;
        return this.getCollectionNameForPrefix(
            normalizedPath,
            this.getCollectionPrefixForMode(retrievalMode),
        );
    }

    private getValidOverrideValue(value?: string): string | undefined {
        if (!value) {
            return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    private sanitizeCollectionNameSuffix(
        value: string,
        prefix: string,
        pathHash: string,
        source: string,
    ): string {
        const hashSuffix = `_${pathHash}`;
        const maxReadableLength =
            Context.MAX_COLLECTION_NAME_LENGTH -
            `${prefix}_`.length -
            hashSuffix.length;
        const normalized = value.trim();
        let sanitized = normalized.replace(/[^A-Za-z0-9_]/g, "_");
        sanitized = sanitized.slice(0, Math.max(0, maxReadableLength));

        if (sanitized.length === 0) {
            sanitized = "custom";
        }

        const fullSuffix = `${sanitized}${hashSuffix}`;

        if (sanitized !== normalized) {
            const warningKey = `${source}:${normalized}:${sanitized}`;
            if (!this.warnedOverrideSanitization.has(warningKey)) {
                console.warn(
                    `[Context] ⚠️ Sanitized collection name override from "${normalized}" to "${sanitized}" (${source}); final suffix "${fullSuffix}"`,
                );
                this.warnedOverrideSanitization.add(warningKey);
            }
        }

        return fullSuffix;
    }

    /**
     * Index a codebase for semantic search
     * @param codebasePath Codebase root path
     * @param progressCallback Optional progress callback function
     * @param forceReindex Whether to recreate the collection even if it exists
     * @returns Indexing statistics
     */
    async indexCodebase(
        codebasePath: string,
        progressCallback?: (progress: {
            phase: string;
            current: number;
            total: number;
            percentage: number;
        }) => void,
        forceReindex: boolean = false,
        abortSignal?: AbortSignal,
    ): Promise<{
        indexedFiles: number;
        totalChunks: number;
        status: "completed" | "limit_reached";
        codeChunkLimit: number;
        oneCIndexScopeProfile?: OneCIndexScopeProfile;
        oneCIndexScope?: OneCIndexScopeSummary;
        initialIndexing?: {
            mode: "initial_full" | "initial_resume" | "incremental_changes";
            resumeEligible: boolean;
            manifestCompatibility: "compatible" | "missing" | "incompatible" | "ignored_force";
            manifestRunState?: InitialIndexingManifest["runState"];
            confirmedDocumentCount: number;
            skippedDocumentCount: number;
            batchCount: number;
        };
    }> {
        codebasePath = normalizeCodebasePath(codebasePath);
        const session = this.getOrCreateCodebaseSession(codebasePath);
        const startRetrievalMode = this.getResolvedRetrievalProfile(codebasePath).retrievalMode;
        const isHybrid = startRetrievalMode === "hybrid_bm25" || startRetrievalMode === "bge_m3_full";
        const searchType =
            isHybrid === true ? "hybrid search" : "semantic search";
        console.log(
            `[Context] 🚀 Starting to index codebase with ${searchType}: ${codebasePath}`,
        );
        throwIfOperationAborted(abortSignal);

        // 1. Load ignore patterns from various ignore files
        await this.loadIgnorePatterns(codebasePath);
        throwIfOperationAborted(abortSignal);

        const enrichmentSession = await this.getCodebaseIndexEnricherForSession(session).prepare(codebasePath);
        session.enrichmentCompatibility = enrichmentSession.getCompatibilityProof?.();
        session.enrichmentOutcome = enrichmentSession.status;
        session.enrichmentDiagnostics = enrichmentSession.diagnostics;
        throwIfOperationAborted(abortSignal);

        this.resetAcceleratorSnapshotForPreIndexStart(codebasePath, {
            allowAcceleration: true,
            isBackgroundSync: false,
        });

        // 3. Recursively traverse codebase to get all supported files
        progressCallback?.({
            phase: "Pre-index traversal...",
            current: 5,
            total: 100,
            percentage: 5,
        });
        const preIndexTraversal = await traversePreIndex(codebasePath, {
            ignorePatterns: session.effectiveIgnorePatterns,
            supportedExtensions: session.effectiveExtensions,
            includeHashes: true,
            diagnostics: isPreIndexTraversalDiagnosticsEnabled(),
            oneCIndexScopeProfile: session.oneCIndexScopeProfile,
            abortSignal,
            progress: (traversalProgress) => {
                const activity =
                    traversalProgress.directoriesVisited +
                    traversalProgress.filesSeen +
                    traversalProgress.selectedFiles +
                    traversalProgress.hashedFiles;
                const boundedProgress = 5 + Math.min(4, Math.floor(Math.log10(Math.max(1, activity))));
                progressCallback?.({
                    phase:
                        `Pre-index ${traversalProgress.phase}: ` +
                        `${traversalProgress.selectedFiles} selected, ` +
                        `${traversalProgress.hashedFiles} hashed, ` +
                        `${traversalProgress.activeTasks} active, ` +
                        `${traversalProgress.queuedTasks} queued`,
                    current: boundedProgress,
                    total: 100,
                    percentage: boundedProgress,
                });
            },
        });
        const codeFiles = preIndexTraversal.files.map((file) => file.absolutePath);
        console.log(`[Context] 📁 Found ${codeFiles.length} code files`);
        console.log(
            `[Context] ⏱️ Pre-index traversal: totalMs=${preIndexTraversal.timings.totalMs}, scanMs=${preIndexTraversal.timings.scanMs}, hashMs=${preIndexTraversal.timings.hashMs}, fileListMs=${preIndexTraversal.timings.fileListMs}, selectedFiles=${preIndexTraversal.selectedFileCount}, hashedFiles=${preIndexTraversal.hashedFileCount}, concurrency=${preIndexTraversal.concurrency}`,
        );
        if (preIndexTraversal.diagnostics) {
            console.log(
                `[Context] 🔎 Pre-index diagnostics: entries=${preIndexTraversal.diagnostics.directoryEntriesVisited}, filesSeen=${preIndexTraversal.diagnostics.filesSeen}, unsupported=${Object.values(preIndexTraversal.diagnostics.unsupportedFilesByExtension).reduce((sum, count) => sum + count, 0)}, ignoredDirs=${preIndexTraversal.diagnostics.ignoredDirectories}, ignoredFiles=${preIndexTraversal.diagnostics.ignoredFiles}, matcherCalls=${preIndexTraversal.diagnostics.matcherCalls}, matcherMs=${preIndexTraversal.diagnostics.matcherMs}, selectedFingerprint=${preIndexTraversal.diagnostics.selectedPathFingerprint}`,
            );
            console.log(
                `[Context] 🔎 Pre-index diagnostics JSON: ${JSON.stringify(preIndexTraversal.diagnostics)}`,
            );
        }
        if (preIndexTraversal.oneCIndexScope.active) {
            const scope = preIndexTraversal.oneCIndexScope;
            console.log(
                `[Context] 🧭 1C index scope: profile=${scope.profile}, recognized=${scope.recognized}, included=${scope.includedFiles}, excluded=${scope.excludedFiles}`,
            );
            if (scope.warning) {
                console.warn(`[Context] ⚠️ ${scope.warning}`);
            }
        }
        this.resetAcceleratorSnapshotForPreIndex(codebasePath, preIndexTraversal, {
            allowAcceleration: true,
            isBackgroundSync: false,
        });
        let initialIndexingManifest = this.buildInitialIndexingManifest(
            codebasePath,
            session,
            preIndexTraversal,
        );
        const previousManifest = await this.initialIndexingManifestStore.read(initialIndexingManifest.identity);
        const collectionName = this.getCollectionName(codebasePath);
        const collectionExists = !forceReindex && await this.vectorDatabase.hasCollection(collectionName);
        const hasCompletedIndexCandidate = collectionExists && (!previousManifest || previousManifest.runState === "completed");
        const completedIndex = hasCompletedIndexCandidate
            ? {
                compatible: true,
                hasSynchronizerSnapshot: await this.hasSynchronizerSnapshot(codebasePath),
                reason: "completed index is missing synchronizer snapshot",
            }
            : undefined;
        const modeDecision = planIndexingMode({
            currentIdentity: initialIndexingManifest.identity,
            manifest: previousManifest,
            completedIndex,
            force: forceReindex,
            writeSafety: this.getInitialIndexingWriteSafety(collectionName),
        });
        if (modeDecision.mode === "initial_resume" && previousManifest) {
            initialIndexingManifest = previousManifest;
            initialIndexingManifest.runState = "indexing";
            initialIndexingManifest.traversal = {
                selectedFileCount: preIndexTraversal.selectedFileCount,
                hashedFileCount: preIndexTraversal.hashedFileCount,
                selectedFileFingerprint: initialIndexingManifest.identity.fileSelectionFingerprint,
            };
        } else if (modeDecision.supersedeManifest && previousManifest) {
            previousManifest.runState = "superseded";
            await this.initialIndexingManifestStore.write(previousManifest);
        } else if (modeDecision.mode === "incompatible_requires_reindex") {
            throw new Error(
                `Initial indexing cannot resume for '${codebasePath}': ${modeDecision.reason || "incompatible persisted state"}. Re-run index_codebase with force=true to start a full reindex.`,
            );
        }
        if (modeDecision.mode === "incremental_changes") {
            const changes = await this.reindexByChange(codebasePath, progressCallback, abortSignal);
            return {
                indexedFiles: changes.added + changes.modified,
                totalChunks: 0,
                status: "completed",
                codeChunkLimit: getCodeChunkLimit(),
                oneCIndexScopeProfile: preIndexTraversal.oneCIndexScope.profile,
                oneCIndexScope: preIndexTraversal.oneCIndexScope,
                initialIndexing: {
                    mode: "incremental_changes",
                    resumeEligible: false,
                    manifestCompatibility: modeDecision.manifestCompatibility,
                    confirmedDocumentCount: previousManifest?.confirmedDocumentIds.length ?? 0,
                    skippedDocumentCount: 0,
                    batchCount: previousManifest?.batches.length ?? 0,
                },
            };
        }
        const skipDocumentIds = new Set(initialIndexingManifest.confirmedDocumentIds);
        const startingBatchSequence = initialIndexingManifest.batches.reduce((max, batch) => {
            const parsed = Number.parseInt(batch.id, 10);
            return Number.isInteger(parsed) ? Math.max(max, parsed) : max;
        }, 0);
        await this.initialIndexingManifestStore.write(initialIndexingManifest);
        this.lastInitialIndexingManifest = initialIndexingManifest;
        const manifestRecorder = this.createInitialIndexingManifestRecorder(initialIndexingManifest);

        progressCallback?.({
            phase: "Preparing collection...",
            current: 9,
            total: 100,
            percentage: 9,
        });
        console.log(
            `Debug2: Preparing vector collection for codebase${forceReindex ? " (FORCE REINDEX)" : ""}`,
        );
        await this.prepareCollection(codebasePath, forceReindex);
        await this.recordRlmBslEnrichmentRuntimeStatus(codebasePath, session, "full");
        throwIfOperationAborted(abortSignal);

        const synchronizer = new FileSynchronizer(
            codebasePath,
            session.effectiveIgnorePatterns,
            session.effectiveExtensions,
            session.oneCIndexScopeProfile,
        );
        await synchronizer.initialize(preIndexTraversal, { persistSnapshot: false });
        session.synchronizer = synchronizer;
        this.synchronizers.set(this.getCollectionName(codebasePath), synchronizer);

        if (codeFiles.length === 0) {
            const codeChunkLimit = getCodeChunkLimit();
            initialIndexingManifest.runState = "completed";
            initialIndexingManifest.lastCompletedSynchronizerSnapshot = FileSynchronizer.getSnapshotPathForCodebase(codebasePath);
            await this.initialIndexingManifestStore.write(initialIndexingManifest);
            this.lastInitialIndexingManifest = initialIndexingManifest;
            await synchronizer.persistSnapshot();
            progressCallback?.({
                phase: "No files to index",
                current: 100,
                total: 100,
                percentage: 100,
            });
            return {
                indexedFiles: 0,
                totalChunks: 0,
                status: "completed",
                codeChunkLimit,
                oneCIndexScopeProfile: preIndexTraversal.oneCIndexScope.profile,
                oneCIndexScope: preIndexTraversal.oneCIndexScope,
                initialIndexing: {
                    mode: modeDecision.mode === "initial_resume" ? "initial_resume" : "initial_full",
                    resumeEligible: modeDecision.resumeEligible,
                    manifestCompatibility: modeDecision.manifestCompatibility,
                    manifestRunState: initialIndexingManifest.runState,
                    confirmedDocumentCount: initialIndexingManifest.confirmedDocumentIds.length,
                    skippedDocumentCount: 0,
                    batchCount: initialIndexingManifest.batches.length,
                },
            };
        }

        // 3. Process each file with streaming chunk processing
        // Reserve 10% for preparation, 80% for splitting, and 10% for draining embedding/insert batches.
        const indexingStartPercentage = 10;
        const indexingEndPercentage = 90;
        const indexingRange = indexingEndPercentage - indexingStartPercentage;

        let result: Awaited<ReturnType<Context["processFileList"]>>;
        try {
            result = await this.processFileList(
                codeFiles,
                codebasePath,
                (filePath, fileIndex, totalFiles) => {
                    // Calculate progress percentage
                    const progressPercentage =
                        indexingStartPercentage +
                        (fileIndex / totalFiles) * indexingRange;

                    console.log(
                        `[Context] 📊 Processed ${fileIndex}/${totalFiles} files`,
                    );
                    progressCallback?.({
                        phase: `Processing files (${fileIndex}/${totalFiles})...`,
                        current: fileIndex,
                        total: totalFiles,
                        percentage: Math.round(progressPercentage),
                    });
                },
                {
                    abortSignal,
                    allowAcceleration: forceReindex || codeFiles.length > 0,
                    isBackgroundSync: false,
                    enrichmentSession,
                    preIndexTraversal,
                    manifestRecorder,
                    skipDocumentIds,
                    startingBatchSequence,
                    onBatchProgress: (snapshot, state) => {
                        if (snapshot.submittedBatches <= 0) {
                            return;
                        }
                        if (!state.productionComplete) {
                            return;
                        }
                        const completed = Math.min(snapshot.completedBatches, snapshot.submittedBatches);
                        const drainPercentage = 90 + Math.floor((completed / snapshot.submittedBatches) * 9);
                        progressCallback?.({
                            phase:
                                `Processing embedding batches ` +
                                `(${completed}/${snapshot.submittedBatches}, ` +
                                `${snapshot.queuedBatches ?? 0} queued, ` +
                                `${snapshot.runningEmbeddingBatches ?? snapshot.inFlightEmbeddingBatches} embedding, ` +
                                `${snapshot.queuedInsertBatches ?? 0} queued insert, ` +
                                `${snapshot.runningInsertBatches ?? snapshot.inFlightInsertBatches} running insert, ` +
                                `${snapshot.backpressureWaitMs ?? 0}ms backpressure)...`,
                            current: completed,
                            total: snapshot.submittedBatches,
                            percentage: Math.min(99, drainPercentage),
                        });
                    },
                },
            );
        } catch (error) {
            initialIndexingManifest.runState = "failed";
            await this.initialIndexingManifestStore.write(initialIndexingManifest);
            this.lastInitialIndexingManifest = initialIndexingManifest;
            throw error;
        }

        console.log(
            `[Context] ✅ Codebase indexing completed! Processed ${result.processedFiles} files in total, generated ${result.totalChunks} code chunks`,
        );
        if (result.status === "completed") {
            await synchronizer.persistSnapshot();
            initialIndexingManifest.runState = "completed";
            initialIndexingManifest.lastCompletedSynchronizerSnapshot = FileSynchronizer.getSnapshotPathForCodebase(codebasePath);
        } else {
            initialIndexingManifest.runState = "limit_reached";
        }
        await this.initialIndexingManifestStore.write(initialIndexingManifest);
        this.lastInitialIndexingManifest = initialIndexingManifest;

        progressCallback?.({
            phase: "Indexing complete!",
            current: result.processedFiles,
            total: codeFiles.length,
            percentage: 100,
        });

        return {
            indexedFiles: result.processedFiles,
            totalChunks: result.totalChunks,
            status: result.status,
            codeChunkLimit: result.codeChunkLimit,
            oneCIndexScopeProfile: preIndexTraversal.oneCIndexScope.profile,
            oneCIndexScope: preIndexTraversal.oneCIndexScope,
            initialIndexing: {
                mode: modeDecision.mode === "initial_resume" ? "initial_resume" : "initial_full",
                resumeEligible: modeDecision.resumeEligible,
                manifestCompatibility: modeDecision.manifestCompatibility,
                manifestRunState: initialIndexingManifest.runState,
                confirmedDocumentCount: initialIndexingManifest.confirmedDocumentIds.length,
                skippedDocumentCount: result.skippedDocumentCount,
                batchCount: initialIndexingManifest.batches.length,
            },
        };
    }

    async reindexByChange(
        codebasePath: string,
        progressCallback?: (progress: {
            phase: string;
            current: number;
            total: number;
            percentage: number;
        }) => void,
        abortSignal?: AbortSignal,
    ): Promise<{ added: number; removed: number; modified: number }> {
        codebasePath = normalizeCodebasePath(codebasePath);
        const session = this.getOrCreateCodebaseSession(codebasePath);
        const collectionName = this.getCollectionName(codebasePath);
        throwIfOperationAborted(abortSignal);
        const synchronizer =
            session.synchronizer || this.synchronizers.get(collectionName);

        if (synchronizer && !session.synchronizer) {
            session.synchronizer = synchronizer;
        }

        if (!synchronizer) {
            // Load project-specific ignore patterns before creating FileSynchronizer
            await this.loadIgnorePatterns(codebasePath);
            throwIfOperationAborted(abortSignal);

            // To be safe, let's initialize if it's not there.
            const newSynchronizer = new FileSynchronizer(
                codebasePath,
                session.effectiveIgnorePatterns,
                session.effectiveExtensions,
                session.oneCIndexScopeProfile,
            );
            await newSynchronizer.initialize();
            session.synchronizer = newSynchronizer;
            this.synchronizers.set(collectionName, newSynchronizer);
        }

        const currentSynchronizer =
            session.synchronizer || this.synchronizers.get(collectionName)!;

        progressCallback?.({
            phase: "Checking for file changes...",
            current: 0,
            total: 100,
            percentage: 0,
        });
        const { added, removed, modified } =
            await currentSynchronizer.checkForChanges();
        throwIfOperationAborted(abortSignal);
        const totalChanges = added.length + removed.length + modified.length;

        if (totalChanges === 0) {
            progressCallback?.({
                phase: "No changes detected",
                current: 100,
                total: 100,
                percentage: 100,
            });
            console.log("[Context] ✅ No file changes detected.");
            return { added: 0, removed: 0, modified: 0 };
        }

        console.log(
            `[Context] 🔄 Found changes: ${added.length} added, ${removed.length} removed, ${modified.length} modified.`,
        );

        const enrichmentSession = await this.getCodebaseIndexEnricherForSession(session).prepare(codebasePath);
        session.enrichmentCompatibility = enrichmentSession.getCompatibilityProof?.();
        session.enrichmentOutcome = enrichmentSession.status;
        session.enrichmentDiagnostics = enrichmentSession.diagnostics;
        await this.recordRlmBslEnrichmentRuntimeStatus(codebasePath, session, "incremental");
        throwIfOperationAborted(abortSignal);

        let processedChanges = 0;
        const updateProgress = (phase: string) => {
            processedChanges++;
            const percentage = Math.round(
                (processedChanges /
                    (removed.length + modified.length + added.length)) *
                    100,
            );
            progressCallback?.({
                phase,
                current: processedChanges,
                total: totalChanges,
                percentage,
            });
        };

        // Handle removed files
        for (const file of removed) {
            throwIfOperationAborted(abortSignal);
            await this.deleteFileChunks(collectionName, file);
            updateProgress(`Removed ${file}`);
        }

        // Handle modified files
        for (const file of modified) {
            throwIfOperationAborted(abortSignal);
            await this.deleteFileChunks(collectionName, file);
            updateProgress(`Deleted old chunks for ${file}`);
        }

        // Handle added and modified files
        const filesToIndex = [...added, ...modified].map((f) =>
            path.join(codebasePath, f),
        );

        if (filesToIndex.length > 0) {
            await this.processFileList(
                filesToIndex,
                codebasePath,
                (filePath, fileIndex, totalFiles) => {
                    updateProgress(
                        `Indexed ${filePath} (${fileIndex}/${totalFiles})`,
                    );
                },
                {
                    abortSignal,
                    allowAcceleration: false,
                    isBackgroundSync: true,
                    enrichmentSession,
                },
            );
        }

        console.log(
            `[Context] ✅ Re-indexing complete. Added: ${added.length}, Removed: ${removed.length}, Modified: ${modified.length}`,
        );
        progressCallback?.({
            phase: "Re-indexing complete!",
            current: totalChanges,
            total: totalChanges,
            percentage: 100,
        });

        return {
            added: added.length,
            removed: removed.length,
            modified: modified.length,
        };
    }

    private async deleteFileChunks(
        collectionName: string,
        relativePath: string,
    ): Promise<void> {
        // Escape backslashes for Milvus query expression (Windows path compatibility)
        const escapedPath = relativePath.replace(/\\/g, "\\\\");
        const results = await this.vectorDatabase.query(
            collectionName,
            `relativePath == "${escapedPath}"`,
            ["id"],
        );

        if (results.length > 0) {
            const ids = results.map((r) => r.id as string).filter((id) => id);
            if (ids.length > 0) {
                await this.vectorDatabase.delete(collectionName, ids);
                console.log(
                    `[Context] Deleted ${ids.length} chunks for file ${relativePath}`,
                );
            }
        }
    }

    /**
     * Semantic search with unified implementation
     * @param codebasePath Codebase path to search in
     * @param query Search query
     * @param topK Number of results to return
     * @param threshold Similarity threshold
     */
    async semanticSearch(
        codebasePath: string,
        query: string,
        topK: number = 5,
        threshold: number = 0.5,
        filterExpr?: string,
        options: SemanticSearchOptions = {},
    ): Promise<SemanticSearchResult[]> {
        codebasePath = normalizeCodebasePath(codebasePath);
        const rankingProfile = resolveRankingProfile({
            searchTimeProfile: options.rankingProfile,
        });
        const retrievalMode = this.getResolvedRetrievalProfile(codebasePath).retrievalMode;
        const isHybrid = retrievalMode === "hybrid_bm25" || retrievalMode === "bge_m3_full";
        const searchType =
            retrievalMode === "bge_m3_full"
                ? "BGE-M3 full multivector search"
                : isHybrid === true ? "hybrid search" : "semantic search";
        console.log(
            `[Context] 🔍 Executing ${searchType}: "${query}" in ${codebasePath}`,
        );

        const collectionName = this.getCollectionName(codebasePath);
        console.log(`[Context] 🔍 Using collection: ${collectionName}`);

        // Check if collection exists and has data
        const hasCollection =
            await this.vectorDatabase.hasCollection(collectionName);
        if (!hasCollection) {
            console.log(
                `[Context] ⚠️  Collection '${collectionName}' does not exist. Please index the codebase first.`,
            );
            return [];
        }

        const collectionDescription = await this.vectorDatabase.getCollectionDescription(collectionName).catch(() => "");
        const codeSymbolProviders = this.collectionHasAvailableRlmBslEnrichment(collectionName, collectionDescription)
            ? []
            : this.codeSymbolProviders;
        const codeSymbolRetrievalPromise = this.getCodeSymbolRetrievalEnabled()
            ? collectCodeSymbolCandidates(
                this.vectorDatabase,
                collectionName,
                codebasePath,
                query,
                this.getCodeSymbolRetrievalOptions(topK),
                codeSymbolProviders,
                filterExpr,
            )
            : Promise.resolve({
                lexicalCandidates: [],
                diagnostics: { providerStatuses: [], providerUnmappedCandidates: [] },
            });

        if (retrievalMode === "bge_m3_full") {
            const multiVectorEmbedding = this.getMultiVectorBatchEmbeddingProvider();
            if (!multiVectorEmbedding) {
                throw new Error("BGE-M3 full retrieval requires an embedding provider with embedMulti support.");
            }

            const queryEmbedding = await multiVectorEmbedding.embedMulti(query);
            if (!queryEmbedding.sparse || !queryEmbedding.colbert) {
                throw new Error("BGE-M3 full mode requires dense, sparse, and ColBERT query vectors.");
            }

            const candidateLimit = this.getBgeM3CandidateLimit(topK);
            const rerankLimit = this.getBgeM3RerankLimit(topK);
            const searchResults = await this.vectorDatabase.bgeM3HybridSearch(
                collectionName,
                [
                    {
                        data: queryEmbedding.dense.vector,
                        anns_field: "dense_vector",
                        param: { nprobe: 10 },
                        limit: candidateLimit,
                    },
                    {
                        data: queryEmbedding.sparse,
                        anns_field: "sparse_vector",
                        param: { drop_ratio_search: 0.2 },
                        limit: candidateLimit,
                    },
                ],
                {
                    rerank: {
                        strategy: "rrf",
                        params: { k: 100 },
                    },
                    limit: candidateLimit,
                    filterExpr,
                },
            );

            this.assertBgeM3ResultsBelongToCodebase(searchResults, codebasePath);
            const rerankedResults = this.rerankBgeM3Results(
                queryEmbedding.colbert.vectors,
                searchResults,
                rerankLimit,
            );

            const semanticResults = rerankedResults.map((result) => ({
                content: result.document.content,
                relativePath: result.document.relativePath,
                startLine: result.document.startLine,
                endLine: result.document.endLine,
                language: result.document.metadata.language || "unknown",
                score: result.score,
                metadata: result.metadata || result.document.metadata,
            }));
            const codeSymbolRetrieval = await codeSymbolRetrievalPromise;
            return fuseCodeSearchResults(
                semanticResults,
                codeSymbolRetrieval.lexicalCandidates,
                query,
                topK,
                codeSymbolRetrieval.diagnostics,
                { rankingProfile },
            );
        }

        if (isHybrid === true) {
            try {
                // Check collection stats to see if it has data
                await this.vectorDatabase.query(
                    collectionName,
                    undefined,
                    ["id"],
                    1,
                );
                console.log(
                    `[Context] 🔍 Collection '${collectionName}' exists and appears to have data`,
                );
            } catch (error) {
                console.log(
                    `[Context] ⚠️  Collection '${collectionName}' exists but may be empty or not properly indexed:`,
                    error,
                );
            }

            // 1. Generate query vector
            console.log(
                `[Context] 🔍 Generating embeddings for query: "${query}"`,
            );
            const queryEmbedding: EmbeddingVector =
                await this.embedding.embed(query);
            console.log(
                `[Context] ✅ Generated embedding vector with dimension: ${queryEmbedding.vector.length}`,
            );
            console.log(
                `[Context] 🔍 First 5 embedding values: [${queryEmbedding.vector.slice(0, 5).join(", ")}]`,
            );

            // 2. Prepare hybrid search requests
            const searchRequests: HybridSearchRequest[] = [
                {
                    data: queryEmbedding.vector,
                    anns_field: "vector",
                    param: { nprobe: 10 },
                    limit: topK,
                },
                {
                    data: query,
                    anns_field: "sparse_vector",
                    param: { drop_ratio_search: 0.2 },
                    limit: topK,
                },
            ];

            console.log(
                `[Context] 🔍 Search request 1 (dense): anns_field="${searchRequests[0].anns_field}", vector_dim=${queryEmbedding.vector.length}, limit=${searchRequests[0].limit}`,
            );
            console.log(
                `[Context] 🔍 Search request 2 (sparse): anns_field="${searchRequests[1].anns_field}", query_text="${query}", limit=${searchRequests[1].limit}`,
            );

            // 3. Execute hybrid search
            console.log(
                `[Context] 🔍 Executing hybrid search with RRF reranking...`,
            );
            const searchResults: HybridSearchResult[] =
                await this.vectorDatabase.hybridSearch(
                    collectionName,
                    searchRequests,
                    {
                        rerank: {
                            strategy: "rrf",
                            params: { k: 100 },
                        },
                        limit: topK,
                        filterExpr,
                    },
                );

            console.log(
                `[Context] 🔍 Raw search results count: ${searchResults.length}`,
            );

            // 4. Convert to semantic search result format
            const results: SemanticSearchResult[] = searchResults.map(
                (result) => ({
                    content: result.document.content,
                    relativePath: result.document.relativePath,
                    startLine: result.document.startLine,
                    endLine: result.document.endLine,
                    language: result.document.metadata.language || "unknown",
                    score: result.score,
                    metadata: result.metadata,
                }),
            );

            const codeSymbolRetrieval = await codeSymbolRetrievalPromise;
            const fusedResults = fuseCodeSearchResults(
                results,
                codeSymbolRetrieval.lexicalCandidates,
                query,
                topK,
                codeSymbolRetrieval.diagnostics,
                { rankingProfile },
            );
            const dedupedResults = this.deduplicateResults(fusedResults);
            console.log(
                `[Context] ✅ Found ${results.length} relevant hybrid results, ${dedupedResults.length} after dedup`,
            );
            if (dedupedResults.length > 0) {
                console.log(
                    `[Context] 🔍 Top result score: ${dedupedResults[0].score}, path: ${dedupedResults[0].relativePath}`,
                );
            }

            return dedupedResults;
        } else {
            // Regular semantic search
            // 1. Generate query vector
            const queryEmbedding: EmbeddingVector =
                await this.embedding.embed(query);

            // 2. Search in vector database
            const searchResults: VectorSearchResult[] =
                await this.vectorDatabase.search(
                    collectionName,
                    queryEmbedding.vector,
                    { topK, threshold, filterExpr },
                );

            // 3. Convert to semantic search result format
            const results: SemanticSearchResult[] = searchResults.map(
                (result) => ({
                    content: result.document.content,
                    relativePath: result.document.relativePath,
                    startLine: result.document.startLine,
                    endLine: result.document.endLine,
                    language: result.document.metadata.language || "unknown",
                    score: result.score,
                    metadata: result.document.metadata,
                }),
            );

            const codeSymbolRetrieval = await codeSymbolRetrievalPromise;
            const fusedResults = fuseCodeSearchResults(
                results,
                codeSymbolRetrieval.lexicalCandidates,
                query,
                topK,
                codeSymbolRetrieval.diagnostics,
                { rankingProfile },
            );
            const dedupedResults = this.deduplicateResults(fusedResults);
            console.log(
                `[Context] ✅ Found ${results.length} relevant results, ${dedupedResults.length} after dedup`,
            );
            return dedupedResults;
        }
    }

    private deduplicateResults(
        results: SemanticSearchResult[],
    ): SemanticSearchResult[] {
        const kept: SemanticSearchResult[] = [];

        for (const result of results) {
            const overlaps = kept.some((existing) => {
                if (existing.relativePath !== result.relativePath) return false;
                const overlapStart = Math.max(existing.startLine, result.startLine);
                const overlapEnd = Math.min(existing.endLine, result.endLine);
                if (overlapStart > overlapEnd) return false;
                const overlapSize = overlapEnd - overlapStart + 1;
                const resultSize = result.endLine - result.startLine + 1;
                return resultSize > 0 && overlapSize / resultSize > 0.5;
            });

            if (!overlaps) {
                kept.push(result);
            }
        }

        return kept;
    }

    /**
     * Check if index exists for codebase
     * @param codebasePath Codebase path to check
     * @returns Whether index exists
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        codebasePath = normalizeCodebasePath(codebasePath);
        const collectionName = this.getCollectionName(codebasePath);
        return await this.vectorDatabase.hasCollection(collectionName);
    }

    /**
     * Clear index
     * @param codebasePath Codebase path to clear index for
     * @param progressCallback Optional progress callback function
     */
    async clearIndex(
        codebasePath: string,
        progressCallback?: (progress: {
            phase: string;
            current: number;
            total: number;
            percentage: number;
        }) => void,
    ): Promise<void> {
        codebasePath = normalizeCodebasePath(codebasePath);
        console.log(`[Context] 🧹 Cleaning index data for ${codebasePath}...`);

        progressCallback?.({
            phase: "Checking existing index...",
            current: 0,
            total: 100,
            percentage: 0,
        });

        const collectionName = this.getCollectionName(codebasePath);
        const collectionExists =
            await this.vectorDatabase.hasCollection(collectionName);

        progressCallback?.({
            phase: "Removing index data...",
            current: 50,
            total: 100,
            percentage: 50,
        });

        if (collectionExists) {
            await this.vectorDatabase.dropCollection(collectionName);
        }

        // Delete snapshot file
        await FileSynchronizer.deleteSnapshot(codebasePath);
        this.clearCodebaseSession(codebasePath);

        progressCallback?.({
            phase: "Index cleared",
            current: 100,
            total: 100,
            percentage: 100,
        });
        console.log("[Context] ✅ Index data cleaned");
    }

    /**
     * Update ignore patterns (merges with default patterns and existing patterns)
     * @param ignorePatterns Array of ignore patterns to add to defaults
     */
    updateIgnorePatterns(
        ignorePatterns: string[],
        codebasePath?: string,
    ): void {
        const normalizedPatterns =
            this.normalizeIgnorePatternsList(ignorePatterns);

        if (codebasePath) {
            const session = this.getOrCreateCodebaseSession(codebasePath);
            session.customIgnorePatterns = normalizedPatterns;
            this.updateSessionEffectiveState(session);
            console.log(
                `[Context] 🚫 Updated codebase-specific ignore patterns for ${session.codebasePath}: ` +
                    `${session.customIgnorePatterns.length} custom, ${session.effectiveIgnorePatterns.length} effective`,
            );
            return;
        }

        this.defaultIgnorePatterns =
            this.buildEffectiveIgnorePatterns(normalizedPatterns);
        console.log(
            `[Context] 🚫 Updated default ignore patterns: ${normalizedPatterns.length} custom + ` +
                `${DEFAULT_IGNORE_PATTERNS.length} built-in = ${this.defaultIgnorePatterns.length} total`,
        );
    }

    /**
     * Add custom ignore patterns (from MCP or other sources) without replacing existing ones
     * @param customPatterns Array of custom ignore patterns to add
     */
    addCustomIgnorePatterns(
        customPatterns: string[],
        codebasePath?: string,
    ): void {
        if (customPatterns.length === 0) return;

        const normalizedPatterns =
            this.normalizeIgnorePatternsList(customPatterns);

        if (codebasePath) {
            const session = this.getOrCreateCodebaseSession(codebasePath);
            session.customIgnorePatterns = this.normalizeIgnorePatternsList([
                ...session.customIgnorePatterns,
                ...normalizedPatterns,
            ]);
            this.updateSessionEffectiveState(session);
            console.log(
                `[Context] 🚫 Added ${normalizedPatterns.length} codebase-specific ignore patterns for ${session.codebasePath}. ` +
                    `Total effective patterns: ${session.effectiveIgnorePatterns.length}`,
            );
            return;
        }

        this.defaultIgnorePatterns = this.buildEffectiveIgnorePatterns([
            ...this.defaultIgnorePatterns.filter(
                (pattern) => !DEFAULT_IGNORE_PATTERNS.includes(pattern),
            ),
            ...normalizedPatterns,
        ]);
        console.log(
            `[Context] 🚫 Added ${normalizedPatterns.length} custom ignore patterns. Total default patterns: ${this.defaultIgnorePatterns.length}`,
        );
    }

    /**
     * Reset ignore patterns to defaults only
     */
    resetIgnorePatternsToDefaults(codebasePath?: string): void {
        if (codebasePath) {
            const session = this.getOrCreateCodebaseSession(codebasePath);
            session.customIgnorePatterns = [];
            session.fileIgnorePatterns = [];
            this.updateSessionEffectiveState(session);
            console.log(
                `[Context] 🔄 Reset ignore patterns to defaults for ${session.codebasePath}: ${session.effectiveIgnorePatterns.length} patterns`,
            );
            return;
        }

        this.defaultIgnorePatterns = [...DEFAULT_IGNORE_PATTERNS];
        console.log(
            `[Context] 🔄 Reset default ignore patterns: ${this.defaultIgnorePatterns.length} patterns`,
        );
    }

    /**
     * Update embedding instance
     * @param embedding New embedding instance
     */
    updateEmbedding(embedding: Embedding): void {
        this.embedding = embedding;
        console.log(
            `[Context] 🔄 Updated embedding provider: ${embedding.getProvider()}`,
        );
    }

    /**
     * Update vector database instance
     * @param vectorDatabase New vector database instance
     */
    updateVectorDatabase(vectorDatabase: VectorDatabase): void {
        this.vectorDatabase = vectorDatabase;
        console.log(`[Context] 🔄 Updated vector database`);
    }

    /**
     * Update splitter instance
     * @param splitter New splitter instance
     */
    updateSplitter(splitter: Splitter): void {
        this.codeSplitter = splitter;
        console.log(`[Context] 🔄 Updated splitter instance`);
    }

    /**
     * Prepare vector collection
     */
    private async prepareCollection(
        codebasePath: string,
        forceReindex: boolean = false,
    ): Promise<void> {
        const resolvedRetrieval = this.getResolvedRetrievalProfile(codebasePath);
        const retrievalMode = resolvedRetrieval.retrievalMode;
        const isHybrid = retrievalMode === "hybrid_bm25" || retrievalMode === "bge_m3_full";
        const collectionType =
            retrievalMode === "bge_m3_full"
                ? "BGE-M3 full multivector"
                : retrievalMode === "bge_m3_dense"
                    ? "BGE-M3 dense"
                    : isHybrid === true
                        ? "hybrid vector"
                        : "vector";
        console.log(
            `[Context] 🔧 Preparing ${collectionType} collection for codebase: ${codebasePath}${forceReindex ? " (FORCE REINDEX)" : ""}`,
        );
        const collectionName = this.getCollectionName(codebasePath);

        // Check if collection already exists
        const collectionExists =
            await this.vectorDatabase.hasCollection(collectionName);

        if (collectionExists && !forceReindex) {
            await this.validateExistingCollection(collectionName, codebasePath, retrievalMode);
            console.log(
                `📋 Collection ${collectionName} already exists, skipping creation`,
            );
            return;
        }

        if (!forceReindex) {
            const incompatibleCollections = [
                this.getCollectionNameForPrefix(codebasePath, "code_chunks"),
                this.getCollectionNameForPrefix(codebasePath, "hybrid_code_chunks"),
                this.getCollectionNameForPrefix(codebasePath, "bge_m3_dense_code_chunks"),
                this.getCollectionNameForPrefix(codebasePath, "bge_m3_code_chunks"),
            ].filter((candidate) => candidate !== collectionName);

            for (const incompatibleCollection of incompatibleCollections) {
                if (await this.vectorDatabase.hasCollection(incompatibleCollection)) {
                    throw new Error(
                        `Retrieval profile change for '${codebasePath}' requires explicit reindexing because existing incompatible collection '${incompatibleCollection}' was found. Re-run indexing with force=true.`,
                    );
                }
            }
        }

        if (forceReindex) {
            const forceReindexCollections = [
                this.getCollectionNameForPrefix(codebasePath, "code_chunks"),
                this.getCollectionNameForPrefix(codebasePath, "hybrid_code_chunks"),
                this.getCollectionNameForPrefix(codebasePath, "bge_m3_dense_code_chunks"),
                this.getCollectionNameForPrefix(codebasePath, "bge_m3_code_chunks"),
            ];

            for (const collectionToDrop of [...new Set(forceReindexCollections)]) {
                if (await this.vectorDatabase.hasCollection(collectionToDrop)) {
                    console.log(
                        `[Context] 🗑️  Dropping existing collection ${collectionToDrop} for force reindex...`,
                    );
                    await this.vectorDatabase.dropCollection(collectionToDrop);
                    console.log(
                        `[Context] ✅ Collection ${collectionToDrop} dropped successfully`,
                    );
                }
            }
        }

        console.log(
            `[Context] 🔍 Detecting embedding dimension for ${this.embedding.getProvider()} provider...`,
        );
        const dimension = await this.embedding.detectDimension();
        console.log(
            `[Context] 📏 Detected dimension: ${dimension} for ${this.embedding.getProvider()}`,
        );
        if (retrievalMode === "bge_m3_full") {
            await this.vectorDatabase.createBgeM3Collection(
                collectionName,
                dimension,
                this.getRetrievalCollectionDescription(codebasePath, resolvedRetrieval),
            );
        } else if (isHybrid === true) {
            await this.vectorDatabase.createHybridCollection(
                collectionName,
                dimension,
                this.getRetrievalCollectionDescription(codebasePath, resolvedRetrieval),
            );
        } else {
            await this.vectorDatabase.createCollection(
                collectionName,
                dimension,
                this.getRetrievalCollectionDescription(codebasePath, resolvedRetrieval),
            );
        }

        console.log(
            `[Context] ✅ Collection ${collectionName} created successfully (dimension: ${dimension})`,
        );
    }

    /**
     * Recursively get all code files in the codebase
     */
    private async getCodeFiles(
        codebasePath: string,
        session: CodebaseSessionState,
        abortSignal?: AbortSignal,
    ): Promise<string[]> {
        const files: string[] = [];
        const traversal = await traversePreIndex(codebasePath, {
            ignorePatterns: session.effectiveIgnorePatterns,
            supportedExtensions: session.effectiveExtensions,
            includeHashes: false,
            abortSignal,
            concurrency: 1,
            oneCIndexScopeProfile: session.oneCIndexScopeProfile,
        });
        files.push(...traversal.files.map((file) => file.absolutePath));
        return files;
    }

    /**
     * Process a list of files with streaming chunk processing
     * @param filePaths Array of file paths to process
     * @param codebasePath Base path for the codebase
     * @param onFileProcessed Callback called when each file is processed
     * @returns Object with processed file count and total chunk count
     */
    private async processFileList(
        filePaths: string[],
        codebasePath: string,
        onFileProcessed?: (
            filePath: string,
            fileIndex: number,
            totalFiles: number,
        ) => void,
        options: ProcessFileListOptions = {},
    ): Promise<{
        processedFiles: number;
        totalChunks: number;
        status: "completed" | "limit_reached";
        codeChunkLimit: number;
        skippedDocumentCount: number;
    }> {
        const abortSignal = options.abortSignal;
        const enrichmentSession = options.enrichmentSession;
        const processRetrievalMode = this.getResolvedRetrievalProfile(codebasePath).retrievalMode;
        const isHybrid = processRetrievalMode === "hybrid_bm25" || processRetrievalMode === "bge_m3_full";
        const CODE_CHUNK_LIMIT = getCodeChunkLimit();
        const acceleratorConfig = getIndexingAcceleratorConfig();
        const embeddingBatchSize = acceleratorConfig.embeddingBatchSize;
        const insertBatchSize = acceleratorConfig.insertBatchSize;
        const accelerationDecision = shouldAccelerateIndexing(acceleratorConfig, {
            isInitialOrForce: options.allowAcceleration === true,
            isBackgroundSync: options.isBackgroundSync === true,
        });
        const effectiveEmbeddingConcurrency = this.getEffectiveEmbeddingConcurrency(
            acceleratorConfig,
            accelerationDecision.active,
            codebasePath,
        );
        const effectiveAcceleratorConfig = {
            ...acceleratorConfig,
            embeddingConcurrency: effectiveEmbeddingConcurrency,
        };
        const effectivePayloadLimits = getEffectiveEmbeddingPayloadLimits(
            acceleratorConfig,
            this.getResolvedRetrievalProfile(codebasePath).retrievalMode,
        );
        const acceleratorRuntime = new IndexingAcceleratorRuntime(
            effectiveAcceleratorConfig,
            accelerationDecision.active,
            accelerationDecision.fallbackReason,
        );
        acceleratorRuntime.recordCodebasePath(codebasePath);
        const vectorWriteCapabilities = this.vectorDatabase.getWriteCapabilities?.();
        const vectorWritePolicy = resolveVectorWritePolicy({
            backend: vectorWriteCapabilities?.backend,
            configuredInsertConcurrency: acceleratorConfig.insertConcurrency,
            capabilities: vectorWriteCapabilities,
            coalescingEnabled: acceleratorConfig.writeCoalescingEnabled,
            coalescingTargetDocuments: acceleratorConfig.writeCoalescingTargetDocuments,
            coalescingMaxDocuments: acceleratorConfig.writeCoalescingMaxDocuments,
            coalescingFlushIntervalMs: acceleratorConfig.writeCoalescingFlushIntervalMs,
        });
        acceleratorRuntime.recordVectorWritePolicy(vectorWritePolicy);
        acceleratorRuntime.recordEffectivePayloadLimits(effectivePayloadLimits);
        acceleratorRuntime.recordChunkLimit(CODE_CHUNK_LIMIT);
        if (options.preIndexTraversal) {
            acceleratorRuntime.recordPreIndex({
                ...options.preIndexTraversal.timings,
                selectedFileCount: options.preIndexTraversal.selectedFileCount,
                hashedFileCount: options.preIndexTraversal.hashedFileCount,
                oneCIndexScope: options.preIndexTraversal.oneCIndexScope,
            });
        }
        const submittedBatches: Promise<void>[] = [];
        const batchErrors: unknown[] = [];
        let acceleratedBatchFailure: unknown;
        let rejectAcceleratedBatchFailure!: (error: unknown) => void;
        const acceleratedBatchFailurePromise = new Promise<never>((_resolve, reject) => {
            rejectAcceleratedBatchFailure = reject;
        });
        acceleratedBatchFailurePromise.catch(() => {
            // The promise is used as a fail-fast race signal for producer work.
        });
        this.lastAcceleratorSnapshot = acceleratorRuntime.getSnapshot();
        console.log(
            `[Context] 🔧 Using INDEX_EMBEDDING_BATCH_SIZE: ${embeddingBatchSize}`,
        );
        console.log(
            `[Context] 🔧 Using INDEX_INSERT_BATCH_SIZE: ${insertBatchSize}`,
        );
        console.log(`[Context] 🔧 Using CODE_CHUNK_LIMIT: ${CODE_CHUNK_LIMIT}`);
        console.log(
            `[Context] ⚡ Index accelerator: mode=${acceleratorConfig.mode}, active=${accelerationDecision.active}, embeddingConcurrency=${effectiveEmbeddingConcurrency}, insertConcurrency=${accelerationDecision.active ? acceleratorConfig.insertConcurrency : 1}, effectiveInsertConcurrency=${accelerationDecision.active ? vectorWritePolicy.effectiveInsertConcurrency : 1}, vectorBackend=${vectorWritePolicy.backend}${vectorWritePolicy.backendClampReason !== "none" ? `, insertClamp=${vectorWritePolicy.backendClampReason}` : ""}${accelerationDecision.fallbackReason ? `, fallback=${accelerationDecision.fallbackReason}` : ""}`,
        );

        let chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }> = [];
        let processedFiles = 0;
        let totalChunks = 0;
        let skippedDocumentCount = 0;
        let limitReached = false;
        let batchSequence = options.startingBatchSequence ?? 0;
        let chunkSequence = 0;
        let productionComplete = false;
        let pendingPayloadSplitReason: IndexingBatchMetadata['payloadSplitReason'];
        const documentIdOccurrences = new Map<string, number>();
        const publishBatchProgress = () => {
            this.updateAcceleratorWorkerSnapshot(acceleratorRuntime);
            this.lastAcceleratorSnapshot = acceleratorRuntime.getSnapshot();
            options.onBatchProgress?.(this.lastAcceleratorSnapshot, {
                productionComplete,
            });
        };
        const createBatchMetadata = (
            batch: Array<{ chunk: CodeChunk; codebasePath: string }>,
            payloadSplitReason?: IndexingBatchMetadata['payloadSplitReason'],
        ): IndexingBatchMetadata => {
            const chunks = batch.map((item) => item.chunk);
            const filePaths = batch
                .map((item) => item.chunk.metadata.filePath)
                .filter((filePath): filePath is string => typeof filePath === "string");
            return {
                id: ++batchSequence,
                chunkCount: batch.length,
                contentCharCount: this.countChunkContentChars(chunks),
                estimatedTokens: this.estimateChunkTokens(chunks),
                firstFile: filePaths[0],
                lastFile: filePaths[filePaths.length - 1],
                effectiveMaxContentChars: effectivePayloadLimits.maxContentChars,
                effectiveMaxEstimatedTokens: effectivePayloadLimits.maxEstimatedTokens,
                payloadSplitReason,
            };
        };
        const recordAcceleratedBatchFailure = (error: unknown) => {
            if (acceleratedBatchFailure === undefined) {
                acceleratedBatchFailure = error;
                rejectAcceleratedBatchFailure(error);
            }
        };
        const throwIfAcceleratedBatchFailed = () => {
            if (acceleratedBatchFailure !== undefined) {
                throw acceleratedBatchFailure;
            }
        };
        const raceWithAcceleratedBatchFailure = <T>(operation: Promise<T>): Promise<T> => {
            if (acceleratedBatchFailure !== undefined) {
                return Promise.reject(acceleratedBatchFailure);
            }
            if (!accelerationDecision.active) {
                return operation;
            }
            return Promise.race([operation, acceleratedBatchFailurePromise]);
        };
        const scheduler = accelerationDecision.active
            ? new EmbeddingBatchScheduler({
                runtime: acceleratorRuntime,
                embeddingConcurrency: effectiveEmbeddingConcurrency,
                insertConcurrency: acceleratorConfig.insertConcurrency,
                insertQueueCapacity: acceleratorConfig.insertQueueCapacity,
                adaptiveBackpressure: acceleratorConfig.adaptiveBackpressure,
                writePolicy: vectorWritePolicy,
                writeCoalescing: vectorWritePolicy.coalescingEnabled
                    ? {
                        enabled: true,
                        targetDocumentCount: vectorWritePolicy.targetCoalescedDocumentCount,
                        maxDocumentCount: vectorWritePolicy.maxCoalescedDocumentCount,
                        flushIntervalMs: vectorWritePolicy.coalescingFlushIntervalMs,
                        getDocumentCount: (preparedInsert: PreparedChunkBatchInsert) => preparedInsert.documents.length,
                        mergeResults: (preparedInserts: PreparedChunkBatchInsert[]) => this.mergePreparedChunkBatchInserts(preparedInserts),
                    }
                    : undefined,
                abortSignal,
                resourcePressureProvider: this.acceleratorResourceSnapshotProvider,
                onProgress: publishBatchProgress,
            })
            : undefined;
        const submitBatch = async (
            batch: Array<{ chunk: CodeChunk; codebasePath: string }>,
            batchMetadata: IndexingBatchMetadata,
            finalBatch: boolean,
        ): Promise<void> => {
            const manifestBatchId = String(batchMetadata.id);
            const plannedDocumentIds = batch
                .map((item) => item.chunk.metadata.documentId)
                .filter((documentId): documentId is string => typeof documentId === "string");
            await options.manifestRecorder?.onBatchPlanned(manifestBatchId, batch);
            if (scheduler) {
                let handle;
                try {
                    handle = await scheduler.submit({
                        metadata: batchMetadata,
                        runEmbedding: async () => {
                            await options.manifestRecorder?.onBatchEmbedding(manifestBatchId);
                            return this.prepareChunkBatchInsert(batch, acceleratorRuntime, batchMetadata);
                        },
                        runInsert: async (preparedInsert) => {
                            await options.manifestRecorder?.onBatchInserting(manifestBatchId);
                            await this.insertPreparedChunkBatch(preparedInsert, acceleratorRuntime, batchMetadata.id, insertBatchSize);
                        },
                        onInsertComplete: async (preparedInsert) => {
                            await options.manifestRecorder?.onBatchInserted(
                                manifestBatchId,
                                preparedInsert.documents.map((document) => document.id),
                            );
                        },
                    });
                } catch (error) {
                    await options.manifestRecorder?.onBatchFailed(manifestBatchId, error);
                    recordAcceleratedBatchFailure(error);
                    throw error;
                }
                const completion = handle.completion.catch(async (error) => {
                    const searchType = isHybrid === true ? "hybrid" : "regular";
                    console.error(
                        `[Context] ❌ Failed to process ${finalBatch ? "final " : ""}chunk batch ${batchMetadata.id} for ${searchType}:`,
                        error,
                    );
                    if (error instanceof Error) {
                        console.error("[Context] Stack trace:", error.stack);
                    }
                    batchErrors.push(error);
                    await options.manifestRecorder?.onBatchFailed(manifestBatchId, error);
                    recordAcceleratedBatchFailure(error);
                }).finally(() => {
                    publishBatchProgress();
                });
                submittedBatches.push(completion);
                publishBatchProgress();
                return;
            }

            const submittedBatch = (async () => {
                await options.manifestRecorder?.onBatchEmbedding(manifestBatchId);
                await options.manifestRecorder?.onBatchInserting(manifestBatchId);
                await this.processChunkBuffer(batch, acceleratorRuntime, batchMetadata, insertBatchSize);
                await options.manifestRecorder?.onBatchInserted(manifestBatchId, plannedDocumentIds);
            })().catch(async (error) => {
                const searchType = isHybrid === true ? "hybrid" : "regular";
                console.error(
                    `[Context] ❌ Failed to process ${finalBatch ? "final " : ""}chunk batch ${batchMetadata.id} for ${searchType}:`,
                    error,
                );
                if (error instanceof Error) {
                    console.error("[Context] Stack trace:", error.stack);
                }
                await options.manifestRecorder?.onBatchFailed(manifestBatchId, error);
                throw error;
            }).finally(() => {
                publishBatchProgress();
            });
            submittedBatches.push(submittedBatch);
            publishBatchProgress();
            await submittedBatch;
        };
        const submitCurrentBatch = async (
            finalBatch: boolean,
            payloadSplitReason?: IndexingBatchMetadata['payloadSplitReason'],
        ): Promise<void> => {
            if (chunkBuffer.length === 0) {
                return;
            }
            const batch = chunkBuffer;
            const batchMetadata = createBatchMetadata(
                batch,
                payloadSplitReason ?? pendingPayloadSplitReason,
            );
            chunkBuffer = [];
            pendingPayloadSplitReason = undefined;
            await submitBatch(batch, batchMetadata, finalBatch);
        };
        const getPayloadLimitExceedReason = (
            batch: Array<{ chunk: CodeChunk; codebasePath: string }>,
            nextChunk: CodeChunk,
        ): IndexingBatchMetadata['payloadSplitReason'] | undefined => {
            const nextContentCharCount = this.countChunkContentChars(batch.map((item) => item.chunk)) + nextChunk.content.length;
            if (
                effectivePayloadLimits.maxContentChars !== undefined &&
                nextContentCharCount > effectivePayloadLimits.maxContentChars
            ) {
                return 'content_chars';
            }
            const nextEstimatedTokens = this.estimateChunkTokens([
                ...batch.map((item) => item.chunk),
                nextChunk,
            ]);
            if (
                effectivePayloadLimits.maxEstimatedTokens !== undefined &&
                nextEstimatedTokens > effectivePayloadLimits.maxEstimatedTokens
            ) {
                return 'estimated_tokens';
            }
            return undefined;
        };
        const getSingleChunkPayloadReason = (
            chunk: CodeChunk,
        ): IndexingBatchMetadata['payloadSplitReason'] | undefined => {
            if (
                effectivePayloadLimits.maxContentChars !== undefined &&
                chunk.content.length > effectivePayloadLimits.maxContentChars
            ) {
                return 'single_chunk_limit_exceeded';
            }
            if (
                effectivePayloadLimits.maxEstimatedTokens !== undefined &&
                this.estimateChunkTokens([chunk]) > effectivePayloadLimits.maxEstimatedTokens
            ) {
                return 'single_chunk_limit_exceeded';
            }
            return undefined;
        };

        try {
            for (let i = 0; i < filePaths.length; i++) {
                throwIfOperationAborted(abortSignal);
                throwIfAcceleratedBatchFailed();
                const filePath = filePaths[i];

                try {
                    const scanStartedAt = Date.now();
                    const content = await raceWithAcceleratedBatchFailure(
                        fs.promises.readFile(filePath, "utf-8"),
                    );
                    acceleratorRuntime.recordScan(Date.now() - scanStartedAt);
                    throwIfOperationAborted(abortSignal);
                    throwIfAcceleratedBatchFailed();
                    const language = this.getLanguageFromExtension(
                        path.extname(filePath),
                    );
                    const splitStartedAt = Date.now();
                    const chunks = await raceWithAcceleratedBatchFailure(
                        this.codeSplitter.split(
                            content,
                            language,
                            filePath,
                        ),
                    );
                    acceleratorRuntime.recordSplit(Date.now() - splitStartedAt);
                    throwIfOperationAborted(abortSignal);
                    throwIfAcceleratedBatchFailed();

                    // Log files with many chunks or large content
                    if (chunks.length > 50) {
                        console.warn(
                            `[Context] ⚠️  File ${filePath} generated ${chunks.length} chunks (${Math.round(content.length / 1024)}KB)`,
                        );
                    } else if (content.length > 100000) {
                        console.log(
                            `📄 Large file ${filePath}: ${Math.round(content.length / 1024)}KB -> ${chunks.length} chunks`,
                        );
                    }

                    // Add chunks to buffer
                    for (const chunk of chunks) {
                        const indexedChunk = this.prepareChunkForIndex(
                            chunk,
                            filePath,
                            codebasePath,
                            chunkSequence,
                            documentIdOccurrences,
                        );
                        const enrichedChunk = this.applyCodebaseEnrichment(indexedChunk, codebasePath, enrichmentSession);
                        const documentId = enrichedChunk.metadata.documentId;
                        if (typeof documentId === "string" && options.skipDocumentIds?.has(documentId)) {
                            chunkSequence++;
                            totalChunks++;
                            skippedDocumentCount++;
                            continue;
                        }
                        const payloadExceedReason = getPayloadLimitExceedReason(chunkBuffer, enrichedChunk);
                        if (chunkBuffer.length > 0 && payloadExceedReason) {
                            throwIfOperationAborted(abortSignal);
                            throwIfAcceleratedBatchFailed();
                            await submitCurrentBatch(false, payloadExceedReason);
                            pendingPayloadSplitReason = payloadExceedReason;
                        }
                        chunkBuffer.push({ chunk: enrichedChunk, codebasePath });
                        chunkSequence++;
                        totalChunks++;
                        const singleChunkPayloadReason = chunkBuffer.length === 1
                            ? getSingleChunkPayloadReason(enrichedChunk)
                            : undefined;
                        if (singleChunkPayloadReason) {
                            throwIfOperationAborted(abortSignal);
                            throwIfAcceleratedBatchFailed();
                            await submitCurrentBatch(false, singleChunkPayloadReason);
                        }

                        // Process batch when buffer reaches INDEX_EMBEDDING_BATCH_SIZE.
                        if (chunkBuffer.length >= embeddingBatchSize) {
                            throwIfOperationAborted(abortSignal);
                            throwIfAcceleratedBatchFailed();
                            await submitCurrentBatch(false, 'chunk_count');
                        }

                        // Check if chunk limit is reached
                        if (totalChunks >= CODE_CHUNK_LIMIT) {
                            console.warn(
                                `[Context] ⚠️  CODE_CHUNK_LIMIT=${CODE_CHUNK_LIMIT} reached after ${totalChunks} chunks and ${processedFiles + 1} processed files. Stopping indexing with a partial searchable index.`,
                            );
                            limitReached = true;
                            break; // Exit the inner loop (over chunks)
                        }
                    }

                    processedFiles++;
                    onFileProcessed?.(filePath, i + 1, filePaths.length);

                    if (limitReached) {
                        break; // Exit the outer loop (over files)
                    }
                } catch (error) {
                    if (error instanceof IndexAbortError) {
                        throw error;
                    }
                    if (isFatalEmbeddingBatchError(error)) {
                        throw error;
                    }
                    if (isIndexingBatchStageError(error)) {
                        throw error;
                    }
                    if (acceleratedBatchFailure !== undefined) {
                        throw acceleratedBatchFailure;
                    }
                    console.warn(
                        `[Context] ⚠️  Skipping file ${filePath}: ${error}`,
                    );
                }
            }

            // Process any remaining chunks in the buffer
            if (chunkBuffer.length > 0) {
                throwIfOperationAborted(abortSignal);
                throwIfAcceleratedBatchFailed();
                const searchType = isHybrid === true ? "hybrid" : "regular";
                console.log(
                    `📝 Processing final batch of ${chunkBuffer.length} chunks for ${searchType}`,
                );
                await submitCurrentBatch(true);
            }
        } catch (error) {
            if (scheduler) {
                await scheduler.cancel(error instanceof Error ? error : new Error(String(error)));
            }
            await Promise.allSettled(submittedBatches);
            publishBatchProgress();
            throw error;
        }

        productionComplete = true;
        publishBatchProgress();
        if (scheduler) {
            await Promise.all(submittedBatches);
            await scheduler.drain();
        } else {
            await Promise.all(submittedBatches);
        }
        if (batchErrors.length > 0) {
            throw batchErrors[0];
        }
        if (limitReached) {
            acceleratorRuntime.recordLimitReached({ totalChunks, processedFiles });
        }
        publishBatchProgress();
        console.log(
            `[Context] ⚡ Accelerator stats: submitted=${this.lastAcceleratorSnapshot.submittedBatches}, completed=${this.lastAcceleratorSnapshot.completedBatches}, failed=${this.lastAcceleratorSnapshot.failedBatches}, preIndexMs=${this.lastAcceleratorSnapshot.preIndexTotalMs}, preIndexScanMs=${this.lastAcceleratorSnapshot.preIndexScanMs}, preIndexHashMs=${this.lastAcceleratorSnapshot.preIndexHashMs}, preIndexFileListMs=${this.lastAcceleratorSnapshot.preIndexFileListMs}, preIndexSelectedFiles=${this.lastAcceleratorSnapshot.preIndexSelectedFileCount}, preIndexHashedFiles=${this.lastAcceleratorSnapshot.preIndexHashedFileCount}, scanMs=${this.lastAcceleratorSnapshot.scanningMs}, splitMs=${this.lastAcceleratorSnapshot.splittingMs}, embeddingMs=${this.lastAcceleratorSnapshot.embeddingMs}, insertMs=${this.lastAcceleratorSnapshot.insertMs}`,
        );
        if (limitReached) {
            console.warn(
                `[Context] ⚠️  Indexing completed with status=limit_reached. Indexed ${processedFiles} files and ${totalChunks} chunks before CODE_CHUNK_LIMIT=${CODE_CHUNK_LIMIT}; search remains available but results may be incomplete. Raise CODE_CHUNK_LIMIT and run a force reindex to include chunks skipped by this run.`,
            );
        }

        return {
            processedFiles,
            totalChunks,
            status: limitReached ? "limit_reached" : "completed",
            codeChunkLimit: CODE_CHUNK_LIMIT,
            skippedDocumentCount,
        };
    }

    private prepareChunkForIndex(
        chunk: CodeChunk,
        filePath: string,
        codebasePath: string,
        chunkIndex: number,
        documentIdOccurrences: Map<string, number>,
    ): CodeChunk {
        const chunkFilePath = chunk.metadata.filePath || filePath;
        const relativePath = path.relative(codebasePath, chunkFilePath);
        const startLine = chunk.metadata.startLine || 0;
        const endLine = chunk.metadata.endLine || 0;
        const baseDocumentId = this.generateId(
            relativePath,
            startLine,
            endLine,
            chunk.content,
        );
        const duplicateOrdinal = documentIdOccurrences.get(baseDocumentId) ?? 0;
        documentIdOccurrences.set(baseDocumentId, duplicateOrdinal + 1);
        const documentId = duplicateOrdinal === 0
            ? baseDocumentId
            : this.generateId(
                relativePath,
                startLine,
                endLine,
                `${chunk.content}\u0000duplicate:${duplicateOrdinal}`,
            );

        return {
            ...chunk,
            metadata: {
                ...chunk.metadata,
                filePath: chunkFilePath,
                documentId,
                chunkIndex,
                duplicateOrdinal,
            },
        };
    }

    private applyCodebaseEnrichment(
        chunk: CodeChunk,
        codebasePath: string,
        enrichmentSession?: CodebaseIndexEnrichmentSession,
    ): CodeChunk {
        const enrichment = enrichmentSession?.enrichChunk(chunk, codebasePath);
        if (!enrichment) {
            return chunk;
        }
        return {
            ...chunk,
            metadata: {
                ...chunk.metadata,
                bsl: enrichment,
            },
        };
    }

    private getPublicChunkMetadata(chunk: CodeChunk): Record<string, unknown> {
        const metadata: Record<string, unknown> = { ...chunk.metadata };
        delete metadata.filePath;
        delete metadata.startLine;
        delete metadata.endLine;
        delete metadata.documentId;
        delete metadata.chunkIndex;
        delete metadata.duplicateOrdinal;
        return metadata;
    }

    /**
     * Process accumulated chunk buffer
     */
    private async processChunkBuffer(
        chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }>,
        acceleratorRuntime?: IndexingAcceleratorRuntime,
        batchMetadata?: IndexingBatchMetadata,
        insertBatchSize: number = chunkBuffer.length,
    ): Promise<void> {
        if (chunkBuffer.length === 0) return;

        // Extract chunks and ensure they all have the same codebasePath
        const chunks = chunkBuffer.map((item) => item.chunk);
        const codebasePath = chunkBuffer[0].codebasePath;

        // Estimate tokens (rough estimation: 1 token ≈ 4 characters)
        const estimatedTokens = this.estimateChunkTokens(chunks);

        const retrievalMode = this.getResolvedRetrievalProfile(codebasePath).retrievalMode;
        const isHybrid = retrievalMode === "hybrid_bm25" || retrievalMode === "bge_m3_full";
        const searchType = isHybrid === true ? "hybrid" : "regular";
        console.log(
            `[Context] 🔄 Processing batch of ${chunks.length} chunks (~${estimatedTokens} tokens) for ${searchType}`,
        );
        acceleratorRuntime?.recordBatchSubmitted(batchMetadata || {
            id: 0,
            chunkCount: chunks.length,
            estimatedTokens,
            firstFile: chunks[0]?.metadata.filePath,
            lastFile: chunks[chunks.length - 1]?.metadata.filePath,
        });
        try {
            const preparedInsert = await this.buildPreparedChunkBatchInsert(
                chunks,
                codebasePath,
                acceleratorRuntime,
                batchMetadata?.id,
            );
            await this.insertPreparedChunkBatch(preparedInsert, acceleratorRuntime, batchMetadata?.id, insertBatchSize);
            acceleratorRuntime?.recordBatchCompleted(batchMetadata?.id);
        } catch (error) {
            acceleratorRuntime?.recordBatchFailed(batchMetadata?.id);
            throw error;
        }
    }

    private prepareChunkBatchInsert(
        chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }>,
        acceleratorRuntime: IndexingAcceleratorRuntime,
        batchMetadata: IndexingBatchMetadata,
    ): Promise<PreparedChunkBatchInsert> {
        const chunks = chunkBuffer.map((item) => item.chunk);
        const codebasePath = chunkBuffer[0].codebasePath;
        const estimatedTokens = this.estimateChunkTokens(chunks);
        const retrievalMode = this.getResolvedRetrievalProfile(codebasePath).retrievalMode;
        const isHybrid = retrievalMode === "hybrid_bm25" || retrievalMode === "bge_m3_full";
        const searchType = isHybrid === true ? "hybrid" : "regular";
        console.log(
            `[Context] 🔄 Processing batch of ${chunks.length} chunks (~${estimatedTokens} tokens) for ${searchType}`,
        );
        return this.buildPreparedChunkBatchInsert(
            chunks,
            codebasePath,
            acceleratorRuntime,
            batchMetadata.id,
        );
    }

    private mergePreparedChunkBatchInserts(preparedInserts: PreparedChunkBatchInsert[]): PreparedChunkBatchInsert {
        if (preparedInserts.length === 0) {
            throw new Error("Cannot coalesce an empty prepared insert list.");
        }
        const [first] = preparedInserts;
        const incompatible = preparedInserts.find((preparedInsert) => (
            preparedInsert.collectionName !== first.collectionName ||
            preparedInsert.insertMode !== first.insertMode ||
            preparedInsert.useBgeM3Upsert !== first.useBgeM3Upsert
        ));
        if (incompatible) {
            throw new Error("Cannot coalesce prepared inserts with different vector write targets.");
        }
        return {
            ...first,
            documents: preparedInserts.flatMap((preparedInsert) => preparedInsert.documents),
        };
    }

    private async runPayloadSafeEmbeddingBatch<T>(
        chunks: CodeChunk[],
        codebasePath: string,
        acceleratorRuntime: IndexingAcceleratorRuntime | undefined,
        batchId: number | undefined,
        embed: (texts: string[]) => Promise<T[]>,
    ): Promise<T[]> {
        try {
            return await embed(chunks.map((chunk) => chunk.content));
        } catch (error) {
            if (!isPayloadSizeEmbeddingError(error)) {
                throw error;
            }

            if (chunks.length <= 1) {
                throw this.createSingleChunkPayloadEmbeddingError(chunks[0], codebasePath, error);
            }

            acceleratorRuntime?.recordBatchPayloadRetrySplit(batchId);
            const midpoint = Math.ceil(chunks.length / 2);
            const left = await this.runPayloadSafeEmbeddingBatch(
                chunks.slice(0, midpoint),
                codebasePath,
                acceleratorRuntime,
                batchId,
                embed,
            );
            const right = await this.runPayloadSafeEmbeddingBatch(
                chunks.slice(midpoint),
                codebasePath,
                acceleratorRuntime,
                batchId,
                embed,
            );
            return [...left, ...right];
        }
    }

    private createSingleChunkPayloadEmbeddingError(
        chunk: CodeChunk,
        codebasePath: string,
        cause: unknown,
    ): Error {
        const filePath = chunk.metadata.filePath
            ? path.relative(codebasePath, chunk.metadata.filePath)
            : 'unknown';
        const chunkIndex = chunk.metadata.chunkIndex ?? 'unknown';
        const message = cause instanceof Error ? cause.message : String(cause);
        const error = new Error(
            `Single embedding chunk exceeded payload-safe retry capacity: ` +
            `file=${filePath}, chunkIndex=${chunkIndex}, ` +
            `contentChars=${chunk.content.length}, estimatedTokens=${this.estimateChunkTokens([chunk])}, ` +
            `retrievalMode=${this.getResolvedRetrievalProfile(codebasePath).retrievalMode}, provider=${this.embedding.getProvider()}: ${message}`,
        );
        if (cause instanceof Error && cause.stack) {
            error.stack = `${error.stack}\nCaused by: ${cause.stack}`;
        }
        return error;
    }

    private async buildPreparedChunkBatchInsert(
        chunks: CodeChunk[],
        codebasePath: string,
        acceleratorRuntime?: IndexingAcceleratorRuntime,
        batchId?: number,
    ): Promise<PreparedChunkBatchInsert> {
        const retrievalMode = this.getResolvedRetrievalProfile(codebasePath).retrievalMode;
        const isHybrid = retrievalMode === "hybrid_bm25";

        // Generate embedding vectors
        if (retrievalMode === "bge_m3_full") {
            const multiVectorEmbedding = this.getMultiVectorBatchEmbeddingProvider();
            if (!multiVectorEmbedding) {
                throw new Error("BGE-M3 full retrieval requires an embedding provider with embedMultiBatch support.");
            }

            let embeddings: MultiVectorEmbedding[];
            try {
                embeddings = await this.runPayloadSafeEmbeddingBatch(
                    chunks,
                    codebasePath,
                    acceleratorRuntime,
                    batchId,
                    (texts) => acceleratorRuntime?.getSnapshot().active && multiVectorEmbedding.embedMultiBatchWithWorkerPool
                        ? acceleratorRuntime.trackEmbedding(() => multiVectorEmbedding.embedMultiBatchWithWorkerPool!(
                            texts,
                            (_workerEndpoint, _error, failure) => acceleratorRuntime.recordBatchRetried(
                                batchId,
                                failure?.reason || "unknown",
                                failure?.retrySafe ?? true,
                                failure?.evidence,
                            ),
                            {
                                logicalBatchId: batchId,
                                chunkCount: chunks.length,
                                contentCharCount: this.countChunkContentChars(chunks),
                                estimatedTokens: this.estimateChunkTokens(chunks),
                                maxContentChars: acceleratorRuntime.getSnapshot().effectiveEmbeddingMaxContentChars,
                                maxEstimatedTokens: acceleratorRuntime.getSnapshot().effectiveEmbeddingMaxEstimatedTokens,
                            },
                        ))
                        : multiVectorEmbedding.embedMultiBatch(texts),
                );
            } catch (error) {
                throw this.createBatchStageError("embedding", batchId, error);
            }
            const documents: VectorDocument[] = chunks.map((chunk, index) => {
                if (!chunk.metadata.filePath) {
                    throw new Error(
                        `Missing filePath in chunk metadata at index ${index}`,
                    );
                }

                const multiVector = embeddings[index];
                if (!multiVector.sparse || !multiVector.colbert) {
                    throw new Error("BGE-M3 full mode requires dense, sparse, and ColBERT vectors for every indexed chunk.");
                }

                const relativePath = path.relative(
                    codebasePath,
                    chunk.metadata.filePath,
                );
                const fileExtension = path.extname(chunk.metadata.filePath);
                const restMetadata = this.getPublicChunkMetadata(chunk);
                const documentId = chunk.metadata.documentId;
                const chunkIndex = chunk.metadata.chunkIndex;
                const duplicateOrdinal = chunk.metadata.duplicateOrdinal;

                return {
                    id: documentId || this.generateId(
                        relativePath,
                        chunk.metadata.startLine || 0,
                        chunk.metadata.endLine || 0,
                        chunk.content,
                    ),
                    content: chunk.content,
                    vector: multiVector.dense.vector,
                    sparseVector: multiVector.sparse,
                    colbertVectors: this.compactBgeM3ColbertVectors(multiVector.colbert.vectors),
                    relativePath,
                    startLine: chunk.metadata.startLine || 0,
                    endLine: chunk.metadata.endLine || 0,
                    fileExtension,
                    metadata: {
                        ...restMetadata,
                        codebasePath,
                        language: chunk.metadata.language || "unknown",
                        chunkIndex: chunkIndex ?? index,
                        ...(duplicateOrdinal && duplicateOrdinal > 0 ? { duplicateOrdinal } : {}),
                        retrievalMode,
                        retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
                    },
                };
            });

            return {
                collectionName: this.getCollectionName(codebasePath),
                documents,
                insertMode: "bge_m3",
                useBgeM3Upsert: Boolean(acceleratorRuntime?.getSnapshot().active && this.vectorDatabase.upsertBgeM3),
            };
        }

        let embeddings: EmbeddingVector[];
        try {
            embeddings = await this.runPayloadSafeEmbeddingBatch(
                chunks,
                codebasePath,
                acceleratorRuntime,
                batchId,
                (texts) => acceleratorRuntime
                    ? acceleratorRuntime.trackEmbedding(() => this.embedding.embedBatch(texts))
                    : this.embedding.embedBatch(texts),
            );
        } catch (error) {
            throw this.createBatchStageError("embedding", batchId, error);
        }

        if (isHybrid === true) {
            // Create hybrid vector documents
            const documents: VectorDocument[] = chunks.map((chunk, index) => {
                if (!chunk.metadata.filePath) {
                    throw new Error(
                        `Missing filePath in chunk metadata at index ${index}`,
                    );
                }

                const relativePath = path.relative(
                    codebasePath,
                    chunk.metadata.filePath,
                );
                const fileExtension = path.extname(chunk.metadata.filePath);
                const restMetadata = this.getPublicChunkMetadata(chunk);
                const documentId = chunk.metadata.documentId;
                const chunkIndex = chunk.metadata.chunkIndex;
                const duplicateOrdinal = chunk.metadata.duplicateOrdinal;

                return {
                    id: documentId || this.generateId(
                        relativePath,
                        chunk.metadata.startLine || 0,
                        chunk.metadata.endLine || 0,
                        chunk.content,
                    ),
                    content: chunk.content, // Full text content for BM25 and storage
                    vector: embeddings[index].vector, // Dense vector
                    relativePath,
                    startLine: chunk.metadata.startLine || 0,
                    endLine: chunk.metadata.endLine || 0,
                    fileExtension,
                    metadata: {
                        ...restMetadata,
                        codebasePath,
                        language: chunk.metadata.language || "unknown",
                        chunkIndex: chunkIndex ?? index,
                        ...(duplicateOrdinal && duplicateOrdinal > 0 ? { duplicateOrdinal } : {}),
                    },
                };
            });

            return {
                collectionName: this.getCollectionName(codebasePath),
                documents,
                insertMode: "hybrid",
                useBgeM3Upsert: false,
            };
        } else {
            // Create regular vector documents
            const documents: VectorDocument[] = chunks.map((chunk, index) => {
                if (!chunk.metadata.filePath) {
                    throw new Error(
                        `Missing filePath in chunk metadata at index ${index}`,
                    );
                }

                const relativePath = path.relative(
                    codebasePath,
                    chunk.metadata.filePath,
                );
                const fileExtension = path.extname(chunk.metadata.filePath);
                const restMetadata = this.getPublicChunkMetadata(chunk);
                const documentId = chunk.metadata.documentId;
                const chunkIndex = chunk.metadata.chunkIndex;
                const duplicateOrdinal = chunk.metadata.duplicateOrdinal;

                return {
                    id: documentId || this.generateId(
                        relativePath,
                        chunk.metadata.startLine || 0,
                        chunk.metadata.endLine || 0,
                        chunk.content,
                    ),
                    vector: embeddings[index].vector,
                    content: chunk.content,
                    relativePath,
                    startLine: chunk.metadata.startLine || 0,
                    endLine: chunk.metadata.endLine || 0,
                    fileExtension,
                    metadata: {
                        ...restMetadata,
                        codebasePath,
                        language: chunk.metadata.language || "unknown",
                        chunkIndex: chunkIndex ?? index,
                        ...(duplicateOrdinal && duplicateOrdinal > 0 ? { duplicateOrdinal } : {}),
                    },
                };
            });

            return {
                collectionName: this.getCollectionName(codebasePath),
                documents,
                insertMode: "regular",
                useBgeM3Upsert: false,
            };
        }
    }

    private async insertPreparedChunkBatch(
        preparedInsert: PreparedChunkBatchInsert,
        acceleratorRuntime?: IndexingAcceleratorRuntime,
        batchId?: number,
        insertBatchSize: number = preparedInsert.documents.length,
    ): Promise<void> {
        const insertDocuments = async (documents: VectorDocument[]) => {
            if (preparedInsert.insertMode === "bge_m3") {
                if (preparedInsert.useBgeM3Upsert && this.vectorDatabase.upsertBgeM3) {
                    await this.vectorDatabase.upsertBgeM3(
                        preparedInsert.collectionName,
                        documents,
                    );
                    return;
                }
                await this.vectorDatabase.insertBgeM3(
                    preparedInsert.collectionName,
                    documents,
                );
                return;
            }
            if (preparedInsert.insertMode === "hybrid") {
                await this.vectorDatabase.insertHybrid(
                    preparedInsert.collectionName,
                    documents,
                );
                return;
            }
            await this.vectorDatabase.insert(
                preparedInsert.collectionName,
                documents,
            );
        };
        const insertBatches = this.splitVectorDocuments(preparedInsert.documents, insertBatchSize);
        acceleratorRuntime?.recordBatchInsertChunkCounts(batchId, insertBatches.map((documents) => documents.length));

        try {
            for (const documents of insertBatches) {
                if (acceleratorRuntime) {
                    await acceleratorRuntime.trackInsert(() => insertDocuments(documents));
                } else {
                    await insertDocuments(documents);
                }
            }
        } catch (error) {
            throw this.createBatchStageError("insert", batchId, error);
        }
    }

    private estimateChunkTokens(chunks: CodeChunk[]): number {
        return chunks.reduce(
            (sum, chunk) => sum + Math.ceil(chunk.content.length / 4),
            0,
        );
    }

    private countChunkContentChars(chunks: CodeChunk[]): number {
        return chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    }

    private splitVectorDocuments(documents: VectorDocument[], batchSize: number): VectorDocument[][] {
        const safeBatchSize = Math.max(1, batchSize);
        const batches: VectorDocument[][] = [];
        for (let index = 0; index < documents.length; index += safeBatchSize) {
            batches.push(documents.slice(index, index + safeBatchSize));
        }
        return batches;
    }

    private createBatchStageError(stage: "embedding" | "insert", batchId: number | undefined, error: unknown): Error {
        const batchLabel = batchId === undefined ? "unknown" : String(batchId);
        const message = error instanceof Error ? error.message : String(error);
        const wrapped = new Error(`Indexing batch ${batchLabel} failed during ${stage}: ${message}`);
        if (error instanceof Error && error.stack) {
            wrapped.stack = `${wrapped.stack}\nCaused by: ${error.stack}`;
        }
        return wrapped;
    }

    /**
     * Get programming language based on file extension
     */
    private getLanguageFromExtension(ext: string): string {
        const languageMap: Record<string, string> = {
            ".ts": "typescript",
            ".tsx": "typescript",
            ".js": "javascript",
            ".jsx": "javascript",
            ".py": "python",
            ".java": "java",
            ".cpp": "cpp",
            ".c": "c",
            ".h": "c",
            ".hpp": "cpp",
            ".cs": "csharp",
            ".go": "go",
            ".rs": "rust",
            ".php": "php",
            ".rb": "ruby",
            ".swift": "swift",
            ".kt": "kotlin",
            ".scala": "scala",
            ".m": "objective-c",
            ".mm": "objective-c",
            ".ipynb": "jupyter",
            ".bsl": "bsl",
            ".os": "bsl",
        };
        return languageMap[ext] || "text";
    }

    /**
     * Generate unique ID based on chunk content and location
     * @param relativePath Relative path to the file
     * @param startLine Start line number
     * @param endLine End line number
     * @param content Chunk content
     * @returns Hash-based unique ID
     */
    private generateId(
        relativePath: string,
        startLine: number,
        endLine: number,
        content: string,
    ): string {
        const combinedString = `${relativePath}:${startLine}:${endLine}:${content}`;
        const hash = crypto
            .createHash("sha256")
            .update(combinedString, "utf-8")
            .digest("hex");
        return `chunk_${hash.substring(0, 16)}`;
    }

    /**
     * Read ignore patterns from file (e.g., .gitignore)
     * @param filePath Path to the ignore file
     * @returns Array of ignore patterns
     */
    static async getIgnorePatternsFromFile(
        filePath: string,
    ): Promise<string[]> {
        try {
            const content = await fs.promises.readFile(filePath, "utf-8");
            return content
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#")); // Filter out empty lines and comments
        } catch (error) {
            console.warn(
                `[Context] ⚠️  Could not read ignore file ${filePath}: ${error}`,
            );
            return [];
        }
    }

    /**
     * Load ignore patterns from various ignore files in the codebase
     * This method preserves any existing custom patterns that were added before
     * @param codebasePath Path to the codebase
     */
    private async loadIgnorePatterns(codebasePath: string): Promise<void> {
        try {
            const session = this.getOrCreateCodebaseSession(codebasePath);
            let fileBasedPatterns: string[] = [];

            // Load all .xxxignore files in codebase directory
            const ignoreFiles = await this.findIgnoreFiles(codebasePath);
            for (const ignoreFile of ignoreFiles) {
                const patterns = await this.loadIgnoreFile(
                    ignoreFile,
                    path.basename(ignoreFile),
                );
                fileBasedPatterns.push(...patterns);
            }

            // Load global ~/.context/.contextignore
            const globalIgnorePatterns = await this.loadGlobalIgnoreFile();
            fileBasedPatterns.push(...globalIgnorePatterns);

            session.fileIgnorePatterns =
                this.normalizeIgnorePatternsList(fileBasedPatterns);
            this.updateSessionEffectiveState(session);

            if (session.fileIgnorePatterns.length > 0) {
                console.log(
                    `[Context] 🚫 Loaded total ${session.fileIgnorePatterns.length} file-based ignore patterns for ${session.codebasePath}. ` +
                        `Effective ignore count: ${session.effectiveIgnorePatterns.length}`,
                );
            } else {
                console.log(
                    `[Context] 📄 No ignore files found for ${session.codebasePath}. Using ${session.effectiveIgnorePatterns.length} effective ignore patterns`,
                );
            }
        } catch (error) {
            console.warn(
                `[Context] ⚠️ Failed to load ignore patterns: ${error}`,
            );
            // Continue with existing session patterns on error.
        }
    }

    /**
     * Find all .xxxignore files in the codebase directory
     * @param codebasePath Path to the codebase
     * @returns Array of ignore file paths
     */
    private async findIgnoreFiles(codebasePath: string): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(codebasePath, {
                withFileTypes: true,
            });
            const ignoreFiles: string[] = [];

            for (const entry of entries) {
                if (
                    entry.isFile() &&
                    entry.name.startsWith(".") &&
                    entry.name.endsWith("ignore")
                ) {
                    ignoreFiles.push(path.join(codebasePath, entry.name));
                }
            }

            if (ignoreFiles.length > 0) {
                console.log(
                    `📄 Found ignore files: ${ignoreFiles.map((f) => path.basename(f)).join(", ")}`,
                );
            }

            return ignoreFiles;
        } catch (error) {
            console.warn(
                `[Context] ⚠️ Failed to scan for ignore files: ${error}`,
            );
            return [];
        }
    }

    /**
     * Load global ignore file from ~/.context/.contextignore
     * @returns Array of ignore patterns
     */
    private async loadGlobalIgnoreFile(): Promise<string[]> {
        try {
            const homeDir = require("os").homedir();
            const globalIgnorePath = path.join(
                homeDir,
                ".context",
                ".contextignore",
            );
            return await this.loadIgnoreFile(
                globalIgnorePath,
                "global .contextignore",
            );
        } catch {
            // Global ignore file is optional, don't log warnings
            return [];
        }
    }

    /**
     * Load ignore patterns from a specific ignore file
     * @param filePath Path to the ignore file
     * @param fileName Display name for logging
     * @returns Array of ignore patterns
     */
    private async loadIgnoreFile(
        filePath: string,
        fileName: string,
    ): Promise<string[]> {
        try {
            await fs.promises.access(filePath);
            console.log(`📄 Found ${fileName} file at: ${filePath}`);

            const ignorePatterns =
                await Context.getIgnorePatternsFromFile(filePath);

            if (ignorePatterns.length > 0) {
                console.log(
                    `[Context] 🚫 Loaded ${ignorePatterns.length} ignore patterns from ${fileName}`,
                );
                return ignorePatterns;
            } else {
                console.log(
                    `📄 ${fileName} file found but no valid patterns detected`,
                );
                return [];
            }
        } catch {
            if (fileName.includes("global")) {
                console.log(`📄 No ${fileName} file found`);
            }
            return [];
        }
    }

    /**
     * Check if a path matches any ignore pattern
     * @param filePath Path to check
     * @param basePath Base path for relative pattern matching
     * @returns True if path should be ignored
     */
    private matchesIgnorePattern(
        filePath: string,
        basePath: string,
        ignorePatterns: string[],
    ): boolean {
        if (ignorePatterns.length === 0) {
            return false;
        }

        const relativePath = path.relative(basePath, filePath);
        const normalizedPath = relativePath.replace(/\\/g, "/"); // Normalize path separators
        const pathParts = normalizedPath.split("/");
        if (pathParts.some((part) => part.startsWith("."))) {
            return true;
        }

        for (const pattern of ignorePatterns) {
            if (this.isPatternMatch(normalizedPath, pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Simple glob pattern matching
     * @param filePath File path to test
     * @param pattern Glob pattern
     * @returns True if pattern matches
     */
    private isPatternMatch(filePath: string, pattern: string): boolean {
        const normalizedPattern = pattern.replace(/\\/g, "/");
        const cleanPath = filePath.replace(/^\/+|\/+$/g, "");
        const cleanPattern = normalizedPattern.replace(/^\/+|\/+$/g, "");
        const isRootAnchored = normalizedPattern.startsWith("/");
        const isDirectoryPattern = normalizedPattern.endsWith("/");

        if (!cleanPath || !cleanPattern) {
            return false;
        }

        // Handle directory patterns (ending with /)
        if (isDirectoryPattern) {
            if (isRootAnchored) {
                return (
                    this.simpleGlobMatch(cleanPath, cleanPattern) ||
                    cleanPath.startsWith(`${cleanPattern}/`)
                );
            }

            return this.matchesDirectoryPattern(cleanPath, cleanPattern);
        }

        if (isRootAnchored) {
            return this.simpleGlobMatch(cleanPath, cleanPattern);
        }

        // Handle file patterns
        if (cleanPattern.includes("/")) {
            // Pattern with path separator - match exact path
            return this.simpleGlobMatch(cleanPath, cleanPattern);
        } else {
            // Pattern without path separator - match filename in any directory
            const fileName = path.basename(cleanPath);
            return this.simpleGlobMatch(fileName, cleanPattern);
        }
    }

    private matchesDirectoryPattern(filePath: string, dirPattern: string): boolean {
        const pathParts = filePath.split("/");
        const dirPartCount = dirPattern.split("/").length;

        for (let i = 0; i <= pathParts.length - dirPartCount; i++) {
            const candidate = pathParts.slice(i, i + dirPartCount).join("/");
            if (this.simpleGlobMatch(candidate, dirPattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Simple glob matching supporting * wildcard
     * @param text Text to test
     * @param pattern Pattern with * wildcards
     * @returns True if pattern matches
     */
    private simpleGlobMatch(text: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars except *
            .replace(/\*/g, ".*"); // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(text);
    }

    /**
     * Get custom extensions from environment variables
     * Supports CUSTOM_EXTENSIONS as comma-separated list
     * @returns Array of custom extensions
     */
    private getCustomExtensionsFromEnv(): string[] {
        const envExtensions = envManager.get("CUSTOM_EXTENSIONS");
        if (!envExtensions) {
            return [];
        }

        try {
            const extensions = envExtensions
                .split(",")
                .map((ext) => ext.trim())
                .filter((ext) => ext.length > 0)
                .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)); // Ensure extensions start with dot

            return extensions;
        } catch (error) {
            console.warn(
                `[Context] ⚠️  Failed to parse CUSTOM_EXTENSIONS: ${error}`,
            );
            return [];
        }
    }

    /**
     * Get custom ignore patterns from environment variables
     * Supports CUSTOM_IGNORE_PATTERNS as comma-separated list
     * @returns Array of custom ignore patterns
     */
    private getCustomIgnorePatternsFromEnv(): string[] {
        const envIgnorePatterns = envManager.get("CUSTOM_IGNORE_PATTERNS");
        if (!envIgnorePatterns) {
            return [];
        }

        try {
            const patterns = envIgnorePatterns
                .split(",")
                .map((pattern) => pattern.trim())
                .filter((pattern) => pattern.length > 0);

            return patterns;
        } catch (error) {
            console.warn(
                `[Context] ⚠️  Failed to parse CUSTOM_IGNORE_PATTERNS: ${error}`,
            );
            return [];
        }
    }

    /**
     * Add custom extensions (from MCP or other sources) without replacing existing ones
     * @param customExtensions Array of custom extensions to add
     */
    addCustomExtensions(
        customExtensions: string[],
        codebasePath?: string,
    ): void {
        if (customExtensions.length === 0) return;

        const normalizedExtensions =
            this.normalizeExtensionsList(customExtensions);

        if (codebasePath) {
            const session = this.getOrCreateCodebaseSession(codebasePath);
            session.customExtensions = this.normalizeExtensionsList([
                ...session.customExtensions,
                ...normalizedExtensions,
            ]);
            this.updateSessionEffectiveState(session);
            console.log(
                `[Context] 📎 Added ${normalizedExtensions.length} codebase-specific extensions for ${session.codebasePath}. ` +
                    `Total effective extensions: ${session.effectiveExtensions.length}`,
            );
            return;
        }

        this.defaultSupportedExtensions =
            this.buildEffectiveExtensions(normalizedExtensions);
        console.log(
            `[Context] 📎 Added ${normalizedExtensions.length} custom extensions. Total default extensions: ${this.defaultSupportedExtensions.length}`,
        );
    }

    /**
     * Get current splitter information
     */
    getSplitterInfo(): {
        type: string;
        hasBuiltinFallback: boolean;
        supportedLanguages?: string[];
    } {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === "AstCodeSplitter") {
            return {
                type: "ast",
                hasBuiltinFallback: true,
                supportedLanguages: AstCodeSplitter.getSupportedLanguages(),
            };
        } else {
            return {
                type: "langchain",
                hasBuiltinFallback: false,
            };
        }
    }

    /**
     * Check if current splitter supports a specific language
     * @param language Programming language
     */
    isLanguageSupported(language: string): boolean {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === "AstCodeSplitter") {
            return AstCodeSplitter.isLanguageSupported(language);
        }

        // LangChain splitter supports most languages
        return true;
    }

    /**
     * Get which strategy would be used for a specific language
     * @param language Programming language
     */
    getSplitterStrategyForLanguage(language: string): {
        strategy: "ast" | "langchain";
        reason: string;
    } {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === "AstCodeSplitter") {
            const isSupported = AstCodeSplitter.isLanguageSupported(language);

            return {
                strategy: isSupported ? "ast" : "langchain",
                reason: isSupported
                    ? "Language supported by AST parser"
                    : "Language not supported by AST, will fallback to LangChain",
            };
        } else {
            return {
                strategy: "langchain",
                reason: "Using LangChain splitter directly",
            };
        }
    }
}
