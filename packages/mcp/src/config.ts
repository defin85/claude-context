import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    envManager,
    getIndexingAcceleratorConfig,
    parseRetrievalProfile,
    resolveRetrievalProfile,
} from "@zilliz/claude-context-core";
import type { ResolvedRetrievalProfile, RetrievalProfile } from "@zilliz/claude-context-core";
import type { RlmBslEnrichmentConfig } from "@zilliz/claude-context-core";
import type { OneCIndexScopeProfile, OneCIndexScopeSummary } from "@zilliz/claude-context-core";
import { McpRuntimeMode } from './access-policy.js';
import { normalizeCodebasePath } from './utils.js';

export type EmbeddingProviderName = 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama' | 'BGE_M3';
export type BgeM3Mode = 'full' | 'dense';
export type VectorDatabaseBackend = 'milvus' | 'lancedb' | 'qdrant';

export interface ContextMcpConfig {
    name: string;
    version: string;
    // Embedding provider configuration
    embeddingProvider: EmbeddingProviderName;
    embeddingModel: string;
    // Provider-specific API keys
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    voyageaiApiKey?: string;
    geminiApiKey?: string;
    geminiBaseUrl?: string;
    // Ollama configuration
    ollamaModel?: string;
    ollamaHost?: string;
    ollamaDimension?: number;
    // BGE-M3 configuration
    bgeM3Endpoint?: string;
    bgeM3WorkerEndpoints: string[];
    bgeM3Model?: string;
    bgeM3Mode: BgeM3Mode;
    bgeM3CandidateLimit: number;
    bgeM3RerankLimit?: number;
    bgeM3StoreColbert: boolean;
    retrievalProfile?: RetrievalProfile;
    resolvedRetrievalProfile: ResolvedRetrievalProfile;
    rlmBslEnrichment?: RlmBslEnrichmentConfig;
    acceleratorMode: 'off' | 'auto';
    indexEmbeddingBatchSize: number;
    indexInsertBatchSize: number;
    acceleratorEmbeddingConcurrency: number;
    acceleratorInsertConcurrency: number;
    acceleratorInsertQueueCapacity: number;
    acceleratorMaxBgeM3Workers: number;
    acceleratorVramLimitPercent: number;
    acceleratorRetryBudget: number;
    acceleratorBackgroundSync: boolean;
    acceleratorAdaptiveBackpressure: boolean;
    acceleratorAdaptiveMinEmbeddingConcurrency: number;
    acceleratorAdaptiveHighPressureThreshold: number;
    acceleratorAdaptiveLowPressureThreshold: number;
    acceleratorAdaptiveHealthySampleCount: number;
    acceleratorAdaptiveCooldownMs: number;
    acceleratorAdaptiveInsertBacklogThreshold: number;
    acceleratorAdaptiveInsertBacklogMinBatches: number;
    acceleratorAdaptiveInsertLatencyMsThreshold: number;
    acceleratorAdaptiveRetryRateThreshold: number;
    acceleratorAdaptiveRetryRateMinBatches: number;
    acceleratorAdaptiveRejectedWorkersThreshold: number;
    acceleratorAdaptiveMemoryFreePercentThreshold: number;
    acceleratorAdaptiveVramUsageLimitPercent: number;
    acceleratorManagedBgeM3Workers: boolean;
    acceleratorManagedWorkerLifecycle: 'systemd' | 'child';
    acceleratorManagedWorkerStartPort: number;
    acceleratorAllowUnmeasuredVram: boolean;
    acceleratorWorkerStartTimeoutMs: number;
    acceleratorWorkerStopDebounceMs: number;
    acceleratorWorkerIdleTimeoutMs: number;
    acceleratorWorkerPressureCheckMs: number;
    acceleratorWorkerVramSafetyMarginMiB: number;
    bgeM3SidecarPython: string;
    bgeM3SidecarScript: string;
    bgeM3Device?: string;
    bgeM3UseFp16: boolean;
    // Vector database configuration
    vectorDatabaseBackend?: VectorDatabaseBackend;
    lancedbUri?: string;
    qdrantUrl?: string;
    qdrantApiKey?: string;
    milvusAddress?: string; // Optional, can be auto-resolved from token
    milvusToken?: string;
}

export interface McpDaemonConfig {
    host: string;
    port: number;
    endpointPath: string;
    dashboard: McpDashboardConfig;
    allowRoots: string[];
    maxIndexingConcurrency: number;
    maxSearchConcurrency: number;
    bearerToken: string;
    tokenSha256: string;
    generatedBearerToken: boolean;
    stateWorkspacePath: string;
}

export interface McpDashboardConfig {
    enabled: boolean;
    routePrefix: string;
    apiPrefix: string;
    staticDir?: string;
}

export interface McpRuntimeConfig {
    mode: McpRuntimeMode;
    daemon?: McpDaemonConfig;
}

interface ParsedCliOptions {
    runtimeMode?: McpRuntimeMode;
    daemonHost?: string;
    daemonPort?: number;
    daemonPath?: string;
    daemonToken?: string;
    daemonMaxIndexingConcurrency?: number;
    daemonMaxSearchConcurrency?: number;
    daemonAllowRoots: string[];
    dashboardEnabled?: boolean;
    dashboardRoute?: string;
    dashboardStaticDir?: string;
}

// Legacy format (v1) - for backward compatibility
export interface CodebaseSnapshotV1 {
    indexedCodebases: string[];
    indexingCodebases: string[] | Record<string, number>;  // Array (legacy) or Map of codebase path to progress percentage
    lastUpdated: string;
}

// New format (v2) - structured with codebase information

// Base interface for common fields
interface CodebaseInfoBase {
    lastUpdated: string;
}

export interface IndexingOwnerInfo {
    runtimeId: string;
    pid: number;
    startedAt: string;
    heartbeatAt: string;
    clientSessionId?: string;
}

export interface IndexingProgressDetails {
    phase: string;
    current: number;
    total: number;
    percentage: number;
}

// Indexing state - when indexing is in progress
export interface CodebaseInfoIndexing extends CodebaseInfoBase {
    status: 'indexing';
    indexingPercentage: number;  // Current progress percentage
    progressDetails?: IndexingProgressDetails;
    owner?: IndexingOwnerInfo;
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
    oneCIndexScope?: OneCIndexScopeSummary;
    reducedCoverageWarning?: string;
}

// Indexed state - when indexing completed successfully
export interface CodebaseInfoIndexed extends CodebaseInfoBase {
    status: 'indexed';
    indexedFiles?: number;       // Number of files indexed when known
    totalChunks?: number;        // Total number of chunks generated when known
    codeChunkLimit?: number;     // CODE_CHUNK_LIMIT used by the indexing run when known
    indexStatus: 'completed' | 'limit_reached';  // Status from indexing result
    statsState?: 'known' | 'unknown';  // Whether file/chunk statistics are available locally
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
    oneCIndexScope?: OneCIndexScopeSummary;
    reducedCoverageWarning?: string;
}

// Index failed state - when indexing failed
export interface CodebaseInfoIndexFailed extends CodebaseInfoBase {
    status: 'indexfailed';
    errorMessage: string;        // Error message from the failure
    lastAttemptedPercentage?: number;  // Progress when failure occurred
}

// Union type for all codebase information states
export type CodebaseInfo = CodebaseInfoIndexing | CodebaseInfoIndexed | CodebaseInfoIndexFailed;

export interface CodebaseSnapshotV2 {
    formatVersion: 'v2';
    codebases: Record<string, CodebaseInfo>;  // codebasePath -> CodebaseInfo
    deletedCodebases?: Record<string, string>;  // codebasePath -> deletion timestamp
    lastUpdated: string;
}

// Union type for all supported formats
export type CodebaseSnapshot = CodebaseSnapshotV1 | CodebaseSnapshotV2;

// Helper function to get default model for each provider
export function getDefaultModelForProvider(provider: string): string {
    switch (provider) {
        case 'OpenAI':
            return 'text-embedding-3-small';
        case 'VoyageAI':
            return 'voyage-code-3';
        case 'Gemini':
            return 'gemini-embedding-001';
        case 'Ollama':
            return 'nomic-embed-text';
        case 'BGE_M3':
            return 'BAAI/bge-m3';
        default:
            return 'text-embedding-3-small';
    }
}

// Helper function to get embedding model with provider-specific environment variable priority
export function getEmbeddingModelForProvider(provider: string): string {
    switch (provider) {
        case 'Ollama':
            // For Ollama, prioritize OLLAMA_MODEL over EMBEDDING_MODEL for backward compatibility
            const ollamaModel = envManager.get('OLLAMA_MODEL') || envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 Ollama model selection: OLLAMA_MODEL=${envManager.get('OLLAMA_MODEL') || 'NOT SET'}, EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${ollamaModel}`);
            return ollamaModel;
        case 'BGE_M3':
            const bgeM3Model = envManager.get('BGE_M3_MODEL') || envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 BGE-M3 model selection: BGE_M3_MODEL=${envManager.get('BGE_M3_MODEL') || 'NOT SET'}, EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${bgeM3Model}`);
            return bgeM3Model;
        case 'OpenAI':
        case 'VoyageAI':
        case 'Gemini':
        default:
            // For all other providers, use EMBEDDING_MODEL or default
            const selectedModel = envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 ${provider} model selection: EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${selectedModel}`);
            return selectedModel;
    }
}

function getPositiveIntegerFromEnv(name: string): number | undefined {
    const rawValue = envManager.get(name);
    if (!rawValue) {
        return undefined;
    }

    const parsedValue = Number(rawValue);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
        return parsedValue;
    }

    console.warn(`[DEBUG] ⚠️  Ignoring invalid ${name}: ${rawValue}. Expected a positive integer.`);
    return undefined;
}

function getPositiveIntegerFromEnvWithDefault(name: string, fallback: number): number {
    return getPositiveIntegerFromEnv(name) || fallback;
}

function getPositiveNumberFromEnvWithDefault(name: string, fallback: number): number {
    const rawValue = envManager.get(name);
    if (!rawValue) {
        return fallback;
    }

    const parsedValue = Number(rawValue);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
        return parsedValue;
    }

    console.warn(`[DEBUG] ⚠️  Ignoring invalid ${name}: ${rawValue}. Expected a positive number.`);
    return fallback;
}

function getBooleanFromEnv(name: string, fallback: boolean): boolean {
    const rawValue = envManager.get(name);
    if (!rawValue) {
        return fallback;
    }

    const normalized = rawValue.toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    console.warn(`[DEBUG] ⚠️  Ignoring invalid ${name}: ${rawValue}. Expected true or false.`);
    return fallback;
}

function getBgeM3ModeFromEnv(): BgeM3Mode {
    const mode = envManager.get('BGE_M3_MODE') || 'full';
    if (mode === 'full' || mode === 'dense') {
        return mode;
    }

    throw new Error(`Invalid BGE_M3_MODE '${mode}'. Expected 'full' or 'dense'.`);
}

export function createMcpConfig(): ContextMcpConfig {
    // Debug: Print all environment variables related to Context
    console.log(`[DEBUG] 🔍 Environment Variables Debug:`);
    console.log(`[DEBUG]   EMBEDDING_PROVIDER: ${envManager.get('EMBEDDING_PROVIDER') || 'NOT SET'}`);
    console.log(`[DEBUG]   EMBEDDING_MODEL: ${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   EMBEDDING_DIMENSION: ${envManager.get('EMBEDDING_DIMENSION') || 'NOT SET'}`);
    console.log(`[DEBUG]   OLLAMA_MODEL: ${envManager.get('OLLAMA_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   BGE_M3_ENDPOINT: ${envManager.get('BGE_M3_ENDPOINT') || 'NOT SET'}`);
    console.log(`[DEBUG]   BGE_M3_MODEL: ${envManager.get('BGE_M3_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   BGE_M3_MODE: ${envManager.get('BGE_M3_MODE') || 'NOT SET'}`);
    console.log(`[DEBUG]   RETRIEVAL_PROFILE: ${envManager.get('RETRIEVAL_PROFILE') || 'NOT SET'}`);
    console.log(`[DEBUG]   HYBRID_MODE: ${envManager.get('HYBRID_MODE') || 'NOT SET'}`);
    console.log(`[DEBUG]   VECTOR_DATABASE_BACKEND: ${envManager.get('VECTOR_DATABASE_BACKEND') || 'NOT SET'}`);
    console.log(`[DEBUG]   LANCEDB_URI: ${envManager.get('LANCEDB_URI') || 'NOT SET'}`);
    console.log(`[DEBUG]   QDRANT_URL: ${envManager.get('QDRANT_URL') || 'NOT SET'}`);
    console.log(`[DEBUG]   GEMINI_API_KEY: ${envManager.get('GEMINI_API_KEY') ? 'SET (length: ' + envManager.get('GEMINI_API_KEY')!.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   OPENAI_API_KEY: ${envManager.get('OPENAI_API_KEY') ? 'SET (length: ' + envManager.get('OPENAI_API_KEY')!.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   MILVUS_ADDRESS: ${envManager.get('MILVUS_ADDRESS') || 'NOT SET'}`);
    console.log(`[DEBUG]   NODE_ENV: ${envManager.get('NODE_ENV') || 'NOT SET'}`);

    const embeddingProvider = (envManager.get('EMBEDDING_PROVIDER') as EmbeddingProviderName) || 'OpenAI';
    const retrievalProfile = parseRetrievalProfile(envManager.get('RETRIEVAL_PROFILE'), 'RETRIEVAL_PROFILE');
    const rawBgeM3Mode = envManager.get('BGE_M3_MODE');
    const rawBgeM3StoreColbert = envManager.get('BGE_M3_STORE_COLBERT');
    const rawHybridMode = envManager.get('HYBRID_MODE');
    const bgeM3Mode = getBgeM3ModeFromEnv();
    const bgeM3StoreColbert = getBooleanFromEnv('BGE_M3_STORE_COLBERT', true);
    const hybridMode = rawHybridMode === undefined || rawHybridMode === null
        ? true
        : rawHybridMode.toLowerCase() === 'true';
    const resolvedRetrievalProfile = resolveRetrievalProfile({
        embeddingProvider,
        retrievalProfile,
        bgeM3Mode,
        bgeM3StoreColbert,
        hybridMode,
        explicitBgeM3Mode: Boolean(rawBgeM3Mode),
        explicitBgeM3StoreColbert: Boolean(rawBgeM3StoreColbert),
        explicitHybridMode: Boolean(rawHybridMode),
    });
    const acceleratorMode = parseAcceleratorMode(envManager.get('INDEX_ACCELERATOR_MODE') || envManager.get('BGE_M3_ACCELERATOR'));
    const indexingAcceleratorConfig = getIndexingAcceleratorConfig();

    const config: ContextMcpConfig = {
        name: envManager.get('MCP_SERVER_NAME') || "Context MCP Server",
        version: envManager.get('MCP_SERVER_VERSION') || "1.0.0",
        // Embedding provider configuration
        embeddingProvider,
        embeddingModel: getEmbeddingModelForProvider(embeddingProvider),
        // Provider-specific API keys
        openaiApiKey: envManager.get('OPENAI_API_KEY'),
        openaiBaseUrl: envManager.get('OPENAI_BASE_URL'),
        voyageaiApiKey: envManager.get('VOYAGEAI_API_KEY'),
        geminiApiKey: envManager.get('GEMINI_API_KEY'),
        geminiBaseUrl: envManager.get('GEMINI_BASE_URL'),
        // Ollama configuration
        ollamaModel: envManager.get('OLLAMA_MODEL'),
        ollamaHost: envManager.get('OLLAMA_HOST'),
        ollamaDimension: getPositiveIntegerFromEnv('EMBEDDING_DIMENSION'),
        // BGE-M3 configuration
        bgeM3Endpoint: envManager.get('BGE_M3_ENDPOINT'),
        bgeM3WorkerEndpoints: parseEndpointList(envManager.get('BGE_M3_WORKER_ENDPOINTS')),
        bgeM3Model: envManager.get('BGE_M3_MODEL'),
        bgeM3Mode: resolvedRetrievalProfile.bgeM3Mode,
        bgeM3CandidateLimit: getPositiveIntegerFromEnvWithDefault('BGE_M3_CANDIDATE_LIMIT', 100),
        bgeM3RerankLimit: getPositiveIntegerFromEnv('BGE_M3_RERANK_LIMIT'),
        bgeM3StoreColbert: resolvedRetrievalProfile.storeColbert,
        retrievalProfile,
        resolvedRetrievalProfile,
        rlmBslEnrichment: createRlmBslEnrichmentConfigFromEnv(),
        acceleratorMode,
        indexEmbeddingBatchSize: indexingAcceleratorConfig.embeddingBatchSize,
        indexInsertBatchSize: indexingAcceleratorConfig.insertBatchSize,
        acceleratorEmbeddingConcurrency: getPositiveIntegerFromEnvWithDefault('INDEX_EMBEDDING_CONCURRENCY', acceleratorMode === 'auto' ? 2 : 1),
        acceleratorInsertConcurrency: getPositiveIntegerFromEnvWithDefault('INDEX_INSERT_CONCURRENCY', 1),
        acceleratorInsertQueueCapacity: getPositiveIntegerFromEnvWithDefault('INDEX_INSERT_QUEUE_CAPACITY', 2),
        acceleratorMaxBgeM3Workers: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_MAX_WORKERS', 1),
        acceleratorVramLimitPercent: Math.max(1, Math.min(100, getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT', 75))),
        acceleratorRetryBudget: getPositiveIntegerFromEnvWithDefault('INDEX_ACCELERATOR_RETRY_BUDGET', 1),
        acceleratorBackgroundSync: getBooleanFromEnv('INDEX_ACCELERATE_BACKGROUND_SYNC', false),
        acceleratorAdaptiveBackpressure: getBooleanFromEnv('INDEX_ADAPTIVE_BACKPRESSURE', acceleratorMode === 'auto'),
        acceleratorAdaptiveMinEmbeddingConcurrency: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_MIN_EMBEDDING_CONCURRENCY', 1),
        acceleratorAdaptiveHighPressureThreshold: getPositiveNumberFromEnvWithDefault('INDEX_ADAPTIVE_HIGH_PRESSURE_THRESHOLD', 1),
        acceleratorAdaptiveLowPressureThreshold: getPositiveNumberFromEnvWithDefault('INDEX_ADAPTIVE_LOW_PRESSURE_THRESHOLD', 0.5),
        acceleratorAdaptiveHealthySampleCount: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_HEALTHY_SAMPLE_COUNT', 3),
        acceleratorAdaptiveCooldownMs: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_COOLDOWN_MS', 5000),
        acceleratorAdaptiveInsertBacklogThreshold: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_INSERT_BACKLOG_THRESHOLD', 2),
        acceleratorAdaptiveInsertBacklogMinBatches: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_INSERT_BACKLOG_MIN_BATCHES', 30),
        acceleratorAdaptiveInsertLatencyMsThreshold: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_INSERT_LATENCY_MS_THRESHOLD', 30000),
        acceleratorAdaptiveRetryRateThreshold: getPositiveNumberFromEnvWithDefault('INDEX_ADAPTIVE_RETRY_RATE_THRESHOLD', 0.5),
        acceleratorAdaptiveRetryRateMinBatches: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_RETRY_RATE_MIN_BATCHES', 10),
        acceleratorAdaptiveRejectedWorkersThreshold: getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_REJECTED_WORKERS_THRESHOLD', 1),
        acceleratorAdaptiveMemoryFreePercentThreshold: Math.max(1, Math.min(100, getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_MEMORY_FREE_PERCENT_THRESHOLD', 3))),
        acceleratorAdaptiveVramUsageLimitPercent: Math.max(1, Math.min(100, getPositiveIntegerFromEnvWithDefault('INDEX_ADAPTIVE_VRAM_USAGE_LIMIT_PERCENT', 90))),
        acceleratorManagedBgeM3Workers: getBooleanFromEnv('BGE_M3_ACCELERATOR_MANAGED_WORKERS', false),
        acceleratorManagedWorkerLifecycle: parseManagedWorkerLifecycle(envManager.get('BGE_M3_ACCELERATOR_WORKER_LIFECYCLE')),
        acceleratorManagedWorkerStartPort: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_START_PORT', 8001),
        acceleratorAllowUnmeasuredVram: getBooleanFromEnv('BGE_M3_ACCELERATOR_ALLOW_UNMEASURED_VRAM', false),
        acceleratorWorkerStartTimeoutMs: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_WORKER_START_TIMEOUT_MS', 180000),
        acceleratorWorkerStopDebounceMs: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_WORKER_STOP_DEBOUNCE_MS', 15000),
        acceleratorWorkerIdleTimeoutMs: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_WORKER_IDLE_TIMEOUT_MS', 300000),
        acceleratorWorkerPressureCheckMs: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_WORKER_PRESSURE_CHECK_MS', 15000),
        acceleratorWorkerVramSafetyMarginMiB: getPositiveIntegerFromEnvWithDefault('BGE_M3_ACCELERATOR_WORKER_VRAM_SAFETY_MARGIN_MIB', 1024),
        bgeM3SidecarPython: envManager.get('BGE_M3_SIDECAR_PYTHON') || 'python3',
        bgeM3SidecarScript: envManager.get('BGE_M3_SIDECAR_SCRIPT') || path.resolve(process.cwd(), 'python', 'bge_m3_sidecar.py'),
        bgeM3Device: envManager.get('BGE_M3_DEVICE'),
        bgeM3UseFp16: getBooleanFromEnv('BGE_M3_USE_FP16', true),
        // Vector database configuration
        vectorDatabaseBackend: parseVectorDatabaseBackend(envManager.get('VECTOR_DATABASE_BACKEND')),
        lancedbUri: envManager.get('LANCEDB_URI') || path.join(os.homedir(), '.context', 'lancedb'),
        qdrantUrl: envManager.get('QDRANT_URL') || 'http://127.0.0.1:6333',
        qdrantApiKey: envManager.get('QDRANT_API_KEY'),
        milvusAddress: envManager.get('MILVUS_ADDRESS'), // Optional, can be resolved from token
        milvusToken: envManager.get('MILVUS_TOKEN')
    };

    if (!retrievalProfile && config.embeddingProvider === 'BGE_M3' && config.bgeM3Mode === 'full' && !config.bgeM3StoreColbert) {
        throw new Error('BGE_M3_STORE_COLBERT=false is incompatible with BGE_M3_MODE=full because full retrieval requires stored ColBERT vectors for reranking.');
    }

    return config;
}

function createRlmBslEnrichmentConfigFromEnv(): RlmBslEnrichmentConfig | undefined {
    const mode = envManager.get('RLM_BSL_ENRICHMENT_MODE');
    if (!mode || mode === 'disabled') {
        return undefined;
    }
    if (mode !== 'optional' && mode !== 'required') {
        throw new Error(`Invalid RLM_BSL_ENRICHMENT_MODE '${mode}'. Expected 'disabled', 'optional', or 'required'.`);
    }

    return {
        mode,
        command: envManager.get('RLM_BSL_ENRICHMENT_COMMAND') || envManager.get('RLM_TOOLS_BSL_COMMAND'),
        args: parseJsonStringArrayEnv('RLM_BSL_ENRICHMENT_ARGS_JSON'),
        timeoutMs: getPositiveIntegerFromEnvWithDefault('RLM_BSL_ENRICHMENT_TIMEOUT_MS', 5000),
        limits: {
            maxFiles: getPositiveIntegerFromEnvWithDefault('RLM_BSL_ENRICHMENT_MAX_FILES', 100000),
            maxSymbolsPerFile: getPositiveIntegerFromEnvWithDefault('RLM_BSL_ENRICHMENT_MAX_SYMBOLS_PER_FILE', 500),
            maxSynonymsPerFile: getPositiveIntegerFromEnvWithDefault('RLM_BSL_ENRICHMENT_MAX_SYNONYMS_PER_FILE', 50),
            maxStringLength: getPositiveIntegerFromEnvWithDefault('RLM_BSL_ENRICHMENT_MAX_STRING_LENGTH', 1024),
            maxDiagnosticsBytes: getPositiveIntegerFromEnvWithDefault('RLM_BSL_ENRICHMENT_MAX_DIAGNOSTICS_BYTES', 16384)
        }
    };
}

function parseJsonStringArrayEnv(name: string): string[] | undefined {
    const rawValue = envManager.get(name);
    if (!rawValue) {
        return undefined;
    }
    const parsedValue = JSON.parse(rawValue);
    if (Array.isArray(parsedValue) && parsedValue.every((item) => typeof item === 'string')) {
        return parsedValue;
    }
    throw new Error(`Invalid ${name}. Expected a JSON string array.`);
}

function parseVectorDatabaseBackend(rawValue: string | undefined): VectorDatabaseBackend {
    if (!rawValue || rawValue === 'qdrant') {
        return 'qdrant';
    }
    if (rawValue === 'milvus') {
        return 'milvus';
    }
    if (rawValue === 'lancedb') {
        return 'lancedb';
    }
    throw new Error(`Invalid VECTOR_DATABASE_BACKEND '${rawValue}'. Expected 'milvus', 'lancedb', or 'qdrant'.`);
}

function parseAcceleratorMode(rawValue: string | undefined): 'off' | 'auto' {
    if (!rawValue || rawValue === 'off') {
        return 'off';
    }
    if (rawValue === 'auto') {
        return 'auto';
    }
    console.warn(`[DEBUG] ⚠️  Ignoring invalid accelerator mode '${rawValue}'. Expected 'off' or 'auto'.`);
    return 'off';
}

function parseManagedWorkerLifecycle(rawValue: string | undefined): 'systemd' | 'child' {
    if (!rawValue || rawValue === 'systemd') {
        return 'systemd';
    }
    if (rawValue === 'child') {
        return 'child';
    }
    console.warn(`[DEBUG] ⚠️  Ignoring invalid BGE_M3_ACCELERATOR_WORKER_LIFECYCLE '${rawValue}'. Expected 'systemd' or 'child'.`);
    return 'systemd';
}

function parseEndpointList(rawValue: string | undefined): string[] {
    if (!rawValue) {
        return [];
    }
    return [...new Set(rawValue
        .split(/[,\s]+/)
        .map((endpoint) => endpoint.trim())
        .filter(Boolean))];
}

function parsePositivePort(rawValue: string | undefined, fallback: number): number {
    if (!rawValue) {
        return fallback;
    }

    const parsedValue = Number(rawValue);
    if (Number.isInteger(parsedValue) && parsedValue > 0 && parsedValue <= 65535) {
        return parsedValue;
    }

    throw new Error(`Invalid daemon port '${rawValue}'. Expected an integer between 1 and 65535.`);
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number, label: string): number {
    if (!rawValue) {
        return fallback;
    }

    const parsedValue = Number(rawValue);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
        return parsedValue;
    }

    throw new Error(`Invalid ${label} '${rawValue}'. Expected a positive integer.`);
}

function parseRuntimeMode(rawValue: string | undefined): McpRuntimeMode | undefined {
    if (!rawValue) {
        return undefined;
    }

    if (rawValue === 'stdio' || rawValue === 'daemon') {
        return rawValue;
    }

    throw new Error(`Invalid MCP runtime mode '${rawValue}'. Expected 'stdio' or 'daemon'.`);
}

function parseCliOptions(args: string[]): ParsedCliOptions {
    const parsed: ParsedCliOptions = {
        daemonAllowRoots: []
    };

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];
        const next = () => {
            const value = args[index + 1];
            if (!value) {
                throw new Error(`Missing value for CLI option '${current}'.`);
            }
            index += 1;
            return value;
        };

        switch (current) {
            case '--mode':
                parsed.runtimeMode = parseRuntimeMode(next());
                break;
            case '--daemon-host':
                parsed.daemonHost = next();
                break;
            case '--daemon-port':
                parsed.daemonPort = parsePositivePort(next(), 39393);
                break;
            case '--daemon-path':
                parsed.daemonPath = next();
                break;
            case '--daemon-token':
                parsed.daemonToken = next();
                break;
            case '--daemon-max-indexing':
                parsed.daemonMaxIndexingConcurrency = parsePositiveInteger(next(), 1, 'daemon max indexing concurrency');
                break;
            case '--daemon-max-search':
                parsed.daemonMaxSearchConcurrency = parsePositiveInteger(next(), 4, 'daemon max search concurrency');
                break;
            case '--allow-root':
                parsed.daemonAllowRoots.push(next());
                break;
            case '--dashboard':
                parsed.dashboardEnabled = true;
                break;
            case '--dashboard-route':
                parsed.dashboardRoute = next();
                break;
            case '--dashboard-static-dir':
                parsed.dashboardStaticDir = next();
                break;
            case '--help':
            case '-h':
                break;
            default:
                if (current.startsWith('--')) {
                    throw new Error(`Unknown CLI option '${current}'.`);
                }
                break;
        }
    }

    return parsed;
}

function normalizeDaemonPath(rawPath: string | undefined): string {
    const candidate = (rawPath || '/mcp').trim();
    if (!candidate.startsWith('/')) {
        throw new Error(`Invalid daemon endpoint path '${candidate}'. Expected an absolute path like '/mcp'.`);
    }
    return normalizeRoutePath(candidate);
}

function normalizeRoutePath(rawPath: string): string {
    const candidate = rawPath.trim();
    if (!candidate.startsWith('/')) {
        throw new Error(`Invalid route path '${candidate}'. Expected an absolute path like '/dashboard'.`);
    }

    if (candidate.length > 1 && candidate.endsWith('/')) {
        return candidate.slice(0, -1);
    }

    return candidate;
}

function hasRouteCollision(left: string, right: string): boolean {
    return left === right
        || left.startsWith(`${right}/`)
        || right.startsWith(`${left}/`);
}

function normalizeDashboardConfig(
    rawEnabled: boolean | undefined,
    rawRoute: string | undefined,
    rawStaticDir: string | undefined,
    daemonEndpointPath: string
): McpDashboardConfig {
    const routePrefix = normalizeRoutePath(rawRoute || '/dashboard');
    if (hasRouteCollision(routePrefix, daemonEndpointPath)) {
        throw new Error(`Dashboard route '${routePrefix}' conflicts with daemon MCP endpoint '${daemonEndpointPath}'.`);
    }

    return {
        enabled: rawEnabled ?? false,
        routePrefix,
        apiPrefix: `${routePrefix}/api`,
        ...(rawStaticDir ? { staticDir: rawStaticDir } : {})
    };
}

function normalizeDaemonHost(rawHost: string | undefined): string {
    if (!rawHost || rawHost === 'localhost') {
        return '127.0.0.1';
    }

    if (rawHost === '127.0.0.1') {
        return rawHost;
    }

    throw new Error(`Invalid daemon host '${rawHost}'. Only 127.0.0.1 is supported in this phase.`);
}

function normalizeAllowRoots(rawRoots: string[]): string[] {
    return [...new Set(rawRoots
        .map((root) => root.trim())
        .filter(Boolean)
        .map((root) => normalizeCodebasePath(root)))];
}

export function createMcpRuntimeConfig(args: string[] = []): McpRuntimeConfig {
    const cliOptions = parseCliOptions(args);
    const runtimeMode = cliOptions.runtimeMode
        || parseRuntimeMode(envManager.get('MCP_RUNTIME_MODE'))
        || 'stdio';

    if (runtimeMode === 'stdio') {
        return { mode: 'stdio' };
    }

    const envAllowRoots = (envManager.get('MCP_DAEMON_ALLOW_ROOTS') || '')
        .split(path.delimiter)
        .map((item) => item.trim())
        .filter(Boolean);
    const allowRoots = normalizeAllowRoots([
        ...envAllowRoots,
        ...cliOptions.daemonAllowRoots
    ]);

    if (allowRoots.length === 0) {
        throw new Error(
            'Daemon mode requires at least one allowed root. Set MCP_DAEMON_ALLOW_ROOTS or pass --allow-root.'
        );
    }

    const bearerToken = cliOptions.daemonToken
        || envManager.get('MCP_DAEMON_TOKEN')
        || crypto.randomBytes(24).toString('hex');
    const generatedBearerToken = !cliOptions.daemonToken && !envManager.get('MCP_DAEMON_TOKEN');

    const endpointPath = normalizeDaemonPath(cliOptions.daemonPath || envManager.get('MCP_DAEMON_PATH'));
    const dashboardConfig = normalizeDashboardConfig(
        cliOptions.dashboardEnabled ?? getBooleanFromEnv('MCP_DASHBOARD_ENABLED', false),
        cliOptions.dashboardRoute || envManager.get('MCP_DASHBOARD_ROUTE'),
        cliOptions.dashboardStaticDir || envManager.get('MCP_DASHBOARD_STATIC_DIR'),
        endpointPath
    );

    return {
        mode: 'daemon',
        daemon: {
            host: normalizeDaemonHost(cliOptions.daemonHost || envManager.get('MCP_DAEMON_HOST')),
            port: cliOptions.daemonPort || parsePositivePort(envManager.get('MCP_DAEMON_PORT'), 39393),
            endpointPath,
            dashboard: dashboardConfig,
            allowRoots,
            maxIndexingConcurrency: cliOptions.daemonMaxIndexingConcurrency || parsePositiveInteger(envManager.get('MCP_DAEMON_MAX_INDEXING_CONCURRENCY'), 1, 'daemon max indexing concurrency'),
            maxSearchConcurrency: cliOptions.daemonMaxSearchConcurrency || parsePositiveInteger(envManager.get('MCP_DAEMON_MAX_SEARCH_CONCURRENCY'), 4, 'daemon max search concurrency'),
            bearerToken,
            tokenSha256: crypto.createHash('sha256').update(bearerToken).digest('hex'),
            generatedBearerToken,
            stateWorkspacePath: path.join(os.homedir(), '.context', 'mcp', 'daemon')
        }
    };
}

export function logConfigurationSummary(config: ContextMcpConfig): void {
    // Log configuration summary before starting server
    console.log(`[MCP] 🚀 Starting Context MCP Server`);
    console.log(`[MCP] Configuration Summary:`);
    console.log(`[MCP]   Server: ${config.name} v${config.version}`);
    console.log(`[MCP]   Embedding Provider: ${config.embeddingProvider}`);
    console.log(`[MCP]   Embedding Model: ${config.embeddingModel}`);
    console.log(`[MCP]   Vector Database Backend: ${config.vectorDatabaseBackend}`);
    console.log(`[MCP]   Retrieval Profile: ${config.retrievalProfile || 'unset (low-level compatibility)'}`);
    console.log(`[MCP]   Resolved Retrieval: profile=${config.resolvedRetrievalProfile.retrievalProfile}, mode=${config.resolvedRetrievalProfile.retrievalMode}, schema=${config.resolvedRetrievalProfile.retrievalSchemaVersion}`);
    console.log(`[MCP]   RLM BSL Enrichment: ${config.rlmBslEnrichment?.mode || 'disabled'}`);
    if (config.rlmBslEnrichment?.command) {
        console.log(`[MCP]   RLM BSL Export Command: configured`);
    }
    switch (config.vectorDatabaseBackend) {
        case 'qdrant':
            console.log(`[MCP]   Qdrant URL: ${config.qdrantUrl || 'http://127.0.0.1:6333'}`);
            break;
        case 'lancedb':
            console.log(`[MCP]   LanceDB URI: ${config.lancedbUri || path.join(os.homedir(), '.context', 'lancedb')}`);
            break;
        case 'milvus':
            console.log(`[MCP]   Milvus Address: ${config.milvusAddress || (config.milvusToken ? '[Auto-resolve from token]' : '[Not configured]')}`);
            break;
    }

    // Log provider-specific configuration without exposing sensitive data
    switch (config.embeddingProvider) {
        case 'OpenAI':
            console.log(`[MCP]   OpenAI API Key: ${config.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            if (config.openaiBaseUrl) {
                console.log(`[MCP]   OpenAI Base URL: ${config.openaiBaseUrl}`);
            }
            break;
        case 'VoyageAI':
            console.log(`[MCP]   VoyageAI API Key: ${config.voyageaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Gemini':
            console.log(`[MCP]   Gemini API Key: ${config.geminiApiKey ? '✅ Configured' : '❌ Missing'}`);
            if (config.geminiBaseUrl) {
                console.log(`[MCP]   Gemini Base URL: ${config.geminiBaseUrl}`);
            }
            break;
        case 'Ollama':
            console.log(`[MCP]   Ollama Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}`);
            console.log(`[MCP]   Ollama Model: ${config.embeddingModel}`);
            if (config.ollamaDimension) {
                console.log(`[MCP]   Ollama Embedding Dimension: ${config.ollamaDimension}`);
            }
            break;
        case 'BGE_M3':
            console.log(`[MCP]   BGE-M3 Endpoint: ${config.bgeM3Endpoint || '❌ Missing'}`);
            console.log(`[MCP]   BGE-M3 Mode: ${config.bgeM3Mode === 'full' ? 'full dense+sparse+ColBERT' : 'dense-only'}`);
            console.log(`[MCP]   BGE-M3 Candidate Limit: ${config.bgeM3CandidateLimit}`);
            console.log(`[MCP]   BGE-M3 Rerank Limit: ${config.bgeM3RerankLimit || '[search limit]'}`);
            console.log(`[MCP]   BGE-M3 Store ColBERT: ${config.bgeM3StoreColbert ? 'true' : 'false'}`);
            if (config.bgeM3WorkerEndpoints.length > 0) {
                console.log(`[MCP]   BGE-M3 Worker Endpoints: ${config.bgeM3WorkerEndpoints.join(', ')}`);
            }
            break;
    }

    console.log(`[MCP] 🔧 Initializing server components...`);
}

export function logRuntimeConfigurationSummary(runtimeConfig: McpRuntimeConfig): void {
    console.log(`[MCP]   Runtime Mode: ${runtimeConfig.mode}`);

    if (runtimeConfig.mode !== 'daemon' || !runtimeConfig.daemon) {
        return;
    }

    const daemon = runtimeConfig.daemon;
    console.log(`[MCP]   Daemon Transport: Streamable HTTP`);
    console.log(`[MCP]   Daemon Endpoint: http://${daemon.host}:${daemon.port}${daemon.endpointPath}`);
    console.log(`[MCP]   Daemon Allowed Roots: ${daemon.allowRoots.join(', ')}`);
    console.log(`[MCP]   Daemon Max Indexing Concurrency: ${daemon.maxIndexingConcurrency}`);
    console.log(`[MCP]   Daemon Max Search Concurrency: ${daemon.maxSearchConcurrency}`);
    console.log(`[MCP]   Daemon Token SHA256: ${daemon.tokenSha256}`);
    console.log(`[MCP]   Daemon State Root: ${daemon.stateWorkspacePath}`);
    console.log(`[MCP]   Dashboard Enabled: ${daemon.dashboard.enabled ? 'true' : 'false'}`);
    if (daemon.dashboard.enabled) {
        console.log(`[MCP]   Dashboard Route: http://${daemon.host}:${daemon.port}${daemon.dashboard.routePrefix}`);
        console.log(`[MCP]   Dashboard API Prefix: ${daemon.dashboard.apiPrefix}`);
        console.log(`[MCP]   Dashboard Static Dir: ${daemon.dashboard.staticDir || '[embedded build]'} `);
    }

    if (daemon.generatedBearerToken) {
        console.log(`[MCP]   Generated Daemon Bearer Token: ${daemon.bearerToken}`);
    }
}

export function logAcceleratorConfiguration(config: ContextMcpConfig): void {
    console.log(`[MCP]   Accelerator Mode: ${config.acceleratorMode}`);
    console.log(`[MCP]   Index Embedding Batch Size: ${config.indexEmbeddingBatchSize}`);
    console.log(`[MCP]   Index Insert Batch Size: ${config.indexInsertBatchSize}`);
    console.log(`[MCP]   Accelerator Embedding Concurrency: ${config.acceleratorEmbeddingConcurrency}`);
    console.log(`[MCP]   Accelerator Insert Concurrency: ${config.acceleratorInsertConcurrency}`);
    console.log(`[MCP]   Accelerator Insert Queue Capacity: ${config.acceleratorInsertQueueCapacity}`);
    console.log(`[MCP]   Accelerator Max BGE-M3 Workers: ${config.acceleratorMaxBgeM3Workers}`);
    console.log(`[MCP]   Accelerator VRAM Limit: ${config.acceleratorVramLimitPercent}%`);
    console.log(`[MCP]   Accelerator Retry Budget: ${config.acceleratorRetryBudget}`);
    console.log(`[MCP]   Accelerator Background Sync: ${config.acceleratorBackgroundSync ? 'true' : 'false'}`);
    console.log(`[MCP]   Accelerator Adaptive Backpressure: ${config.acceleratorAdaptiveBackpressure ? 'true' : 'false'}`);
    if (config.acceleratorAdaptiveBackpressure) {
        console.log(`[MCP]   Accelerator Adaptive Min Embedding Concurrency: ${config.acceleratorAdaptiveMinEmbeddingConcurrency}`);
        console.log(`[MCP]   Accelerator Adaptive Pressure Thresholds: high=${config.acceleratorAdaptiveHighPressureThreshold} low=${config.acceleratorAdaptiveLowPressureThreshold}`);
        console.log(`[MCP]   Accelerator Adaptive Recovery: healthySamples=${config.acceleratorAdaptiveHealthySampleCount} cooldownMs=${config.acceleratorAdaptiveCooldownMs}`);
        console.log(`[MCP]   Accelerator Adaptive Insert Thresholds: backlog=${config.acceleratorAdaptiveInsertBacklogThreshold} backlogMinBatches=${config.acceleratorAdaptiveInsertBacklogMinBatches} latencyMs=${config.acceleratorAdaptiveInsertLatencyMsThreshold}`);
        console.log(`[MCP]   Accelerator Adaptive Worker Thresholds: retryRate=${config.acceleratorAdaptiveRetryRateThreshold} retryMinBatches=${config.acceleratorAdaptiveRetryRateMinBatches} rejectedWorkers=${config.acceleratorAdaptiveRejectedWorkersThreshold}`);
        console.log(`[MCP]   Accelerator Adaptive Guardrails: memoryFreePercent=${config.acceleratorAdaptiveMemoryFreePercentThreshold} vramUsagePercent=${config.acceleratorAdaptiveVramUsageLimitPercent}`);
    }
    console.log(`[MCP]   Accelerator Managed BGE-M3 Workers: ${config.acceleratorManagedBgeM3Workers ? 'true' : 'false'}`);
    if (config.acceleratorManagedBgeM3Workers) {
        console.log(`[MCP]   Accelerator Worker Lifecycle: ${config.acceleratorManagedWorkerLifecycle}`);
        console.log(`[MCP]   Accelerator Worker Start Port: ${config.acceleratorManagedWorkerStartPort}`);
        console.log(`[MCP]   Accelerator Worker Start Timeout: ${config.acceleratorWorkerStartTimeoutMs}ms`);
        console.log(`[MCP]   Accelerator Worker Stop Debounce: ${config.acceleratorWorkerStopDebounceMs}ms`);
        console.log(`[MCP]   Accelerator Worker Idle Timeout: ${config.acceleratorWorkerIdleTimeoutMs}ms`);
        console.log(`[MCP]   Accelerator Worker Pressure Check: ${config.acceleratorWorkerPressureCheckMs}ms`);
        console.log(`[MCP]   Accelerator Worker VRAM Safety Margin: ${config.acceleratorWorkerVramSafetyMarginMiB}MiB`);
        console.log(`[MCP]   Accelerator Allow Unmeasured VRAM: ${config.acceleratorAllowUnmeasuredVram ? 'true' : 'false'}`);
        console.log(`[MCP]   BGE-M3 Sidecar Script: ${config.bgeM3SidecarScript}`);
    }
}

export function showHelpMessage(): void {
    console.log(`
Context MCP Server

Usage: npx @zilliz/claude-context-mcp@latest [options]

Options:
  --help, -h                          Show this help message
  --daemon-discover                   Print active daemon client bootstrap JSON and exit
  --daemon-status                     Print daemon runtime/operator status JSON and exit
  --daemon-cleanup-stale              Remove stale daemon registry/discovery/runtime artifacts and recover stale snapshot ownership
  --daemon-stop                       Ask the active daemon to shut down gracefully and exit
  --daemon-restart                    Gracefully restart daemon mode using the current CLI/env config (or active discovery metadata)
  --daemon-cancel <absolute-path>     Cancel queued/active daemon indexing work for one codebase and exit
  --mode <stdio|daemon>               Runtime mode (default: stdio)
  --daemon-host <host>                Daemon host (daemon mode only, default: 127.0.0.1)
  --daemon-port <port>                Daemon port (daemon mode only, default: 39393)
  --daemon-path <path>                Daemon MCP endpoint path (default: /mcp)
  --daemon-token <token>              Bearer token for daemon authentication
  --daemon-max-indexing <count>       Max concurrent indexing/sync jobs in daemon mode
  --daemon-max-search <count>         Max concurrent search requests in daemon mode
  --allow-root <absolute-path>        Allowed codebase root for daemon mode; repeatable
  --dashboard                         Enable the local web dashboard in daemon mode
  --dashboard-route <path>            Dashboard route prefix (default: /dashboard)
  --dashboard-static-dir <path>       Static dashboard build directory

Environment Variables:
  MCP_SERVER_NAME         Server name
  MCP_SERVER_VERSION      Server version
  MCP_RUNTIME_MODE        Runtime mode: stdio or daemon
  MCP_DAEMON_HOST         Daemon host (phase-3 currently only supports 127.0.0.1)
  MCP_DAEMON_PORT         Daemon port
  MCP_DAEMON_PATH         Daemon MCP endpoint path
  MCP_DAEMON_TOKEN        Bearer token for daemon authentication
  MCP_DAEMON_MAX_INDEXING_CONCURRENCY Max concurrent indexing/sync jobs in daemon mode
  MCP_DAEMON_MAX_SEARCH_CONCURRENCY   Max concurrent search requests in daemon mode
  MCP_DAEMON_ALLOW_ROOTS  Allowed codebase roots for daemon mode, separated by '${path.delimiter}'
  MCP_DASHBOARD_ENABLED   Enable the local web dashboard in daemon mode
  MCP_DASHBOARD_ROUTE     Dashboard route prefix (default: /dashboard)
  MCP_DASHBOARD_STATIC_DIR Static dashboard build directory
  
  Embedding Provider Configuration:
  EMBEDDING_PROVIDER      Embedding provider: OpenAI, VoyageAI, Gemini, Ollama, BGE_M3 (default: OpenAI)
  EMBEDDING_MODEL         Embedding model name (works for all providers)
  EMBEDDING_DIMENSION     Optional embedding dimension override for Ollama
  RETRIEVAL_PROFILE       Retrieval performance profile: fast, balanced, or quality (unset preserves low-level settings)
  
  Provider-specific API Keys:
  OPENAI_API_KEY          OpenAI API key (required for OpenAI provider)
  OPENAI_BASE_URL         OpenAI API base URL (optional, for custom endpoints)
  VOYAGEAI_API_KEY        VoyageAI API key (required for VoyageAI provider)
  GEMINI_API_KEY          Google AI API key (required for Gemini provider)
  GEMINI_BASE_URL         Gemini API base URL (optional, for custom endpoints)
  
  Ollama Configuration:
  OLLAMA_HOST             Ollama server host (default: http://127.0.0.1:11434)
  OLLAMA_MODEL            Ollama model name (alternative to EMBEDDING_MODEL for Ollama)

  BGE-M3 Configuration:
  BGE_M3_ENDPOINT         Local BGE-M3 sidecar endpoint (required for BGE_M3 provider)
  BGE_M3_MODEL            BGE-M3 model name (default: BAAI/bge-m3)
  BGE_M3_MODE             BGE-M3 mode: full or dense (default: full)
  BGE_M3_CANDIDATE_LIMIT  Max first-stage candidates for ColBERT reranking (default: 100)
  BGE_M3_RERANK_LIMIT     Max candidates to return after reranking (default: search limit)
  BGE_M3_STORE_COLBERT    Store ColBERT token vectors for full mode; full mode requires true (default: true)
  BGE_M3_WORKER_ENDPOINTS Additional BGE-M3 sidecar endpoints, separated by comma or whitespace
  BGE_M3_ACCELERATOR      Legacy alias for INDEX_ACCELERATOR_MODE
  INDEX_ACCELERATOR_MODE  Accelerator mode: off or auto (default: off)
  INDEX_EMBEDDING_BATCH_SIZE Chunks per embedding request (default: EMBEDDING_BATCH_SIZE or 100)
  INDEX_INSERT_BATCH_SIZE Chunks per vector insert request (default: INDEX_EMBEDDING_BATCH_SIZE)
  INDEX_EMBEDDING_MAX_CONTENT_CHARS Payload-safe content-character cap per embedding request (default: auto; BGE-M3 full effective default: 1000000)
  INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS Payload-safe estimated-token cap per embedding request (default: auto; BGE-M3 full effective default: 250000)
  INDEX_EMBEDDING_CONCURRENCY Max in-flight embedding batches (default: 2 in auto, else 1)
  INDEX_INSERT_CONCURRENCY Max in-flight insert batches (default: 1; raise only after Milvus safety validation)
  INDEX_INSERT_QUEUE_CAPACITY Max queued insert batches waiting for insert lanes (default: 2)
  INDEX_ADAPTIVE_BACKPRESSURE Enable adaptive indexing backpressure in auto mode (default: true in auto)
  INDEX_ADAPTIVE_MIN_EMBEDDING_CONCURRENCY Minimum adaptive embedding concurrency (default: 1)
  INDEX_ADAPTIVE_HIGH_PRESSURE_THRESHOLD Pressure score that decreases effective concurrency (default: 1)
  INDEX_ADAPTIVE_LOW_PRESSURE_THRESHOLD Pressure score considered healthy for recovery (default: 0.5)
  INDEX_ADAPTIVE_HEALTHY_SAMPLE_COUNT Healthy samples before recovery (default: 3)
  INDEX_ADAPTIVE_COOLDOWN_MS Minimum recovery cooldown after throttling (default: 5000)
  INDEX_ADAPTIVE_INSERT_BACKLOG_THRESHOLD Insert backlog pressure threshold (default: 2)
  INDEX_ADAPTIVE_INSERT_BACKLOG_MIN_BATCHES Minimum submitted batches before insert-backlog pressure applies (default: 30)
  INDEX_ADAPTIVE_INSERT_LATENCY_MS_THRESHOLD Insert latency pressure threshold (default: 30000)
  INDEX_ADAPTIVE_RETRY_RATE_THRESHOLD Retry rate pressure threshold (default: 0.5)
  INDEX_ADAPTIVE_RETRY_RATE_MIN_BATCHES Minimum submitted batches before retry-rate pressure applies (default: 10)
  INDEX_ADAPTIVE_REJECTED_WORKERS_THRESHOLD Rejected worker pressure threshold (default: 1)
  INDEX_ADAPTIVE_MEMORY_FREE_PERCENT_THRESHOLD Memory free-percent guardrail (default: 3)
  INDEX_ADAPTIVE_VRAM_USAGE_LIMIT_PERCENT VRAM usage guardrail when measured (default: 90)
  BGE_M3_ACCELERATOR_MAX_WORKERS Total BGE-M3 worker budget including primary (default: 1)
  BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT Managed worker VRAM ceiling (default: 75)
  BGE_M3_ACCELERATOR_MANAGED_WORKERS Start extra BGE-M3 sidecars when eligible (default: false)
  BGE_M3_ACCELERATOR_WORKER_LIFECYCLE Managed worker lifecycle: systemd or child (default: systemd)
  BGE_M3_ACCELERATOR_START_PORT First managed sidecar loopback port (default: 8001)
  BGE_M3_ACCELERATOR_ALLOW_UNMEASURED_VRAM Allow managed startup without nvidia-smi metrics (default: false)
  BGE_M3_ACCELERATOR_WORKER_START_TIMEOUT_MS Health wait timeout for managed workers (default: 180000)
  BGE_M3_ACCELERATOR_WORKER_PRESSURE_CHECK_MS Runtime VRAM pressure check interval for managed workers (default: 15000)
  BGE_M3_SIDECAR_PYTHON  Python executable for managed sidecars (default: python3)
  BGE_M3_SIDECAR_SCRIPT  Sidecar script path (default: ./python/bge_m3_sidecar.py)
  
  Vector Database Configuration:
  VECTOR_DATABASE_BACKEND Vector database backend: qdrant, milvus, or lancedb (default: qdrant)
  QDRANT_URL             Qdrant endpoint (default: http://127.0.0.1:6333)
  QDRANT_API_KEY         Qdrant API key (optional)
  LANCEDB_URI            Local LanceDB directory (default: ~/.context/lancedb)
  MILVUS_ADDRESS          Milvus address (optional, can be auto-resolved from token)
  MILVUS_TOKEN            Milvus token (optional, used for authentication and address resolution)

Examples:
  # Start MCP server with OpenAI (default) and Qdrant (default vector database)
  OPENAI_API_KEY=sk-xxx QDRANT_URL=http://127.0.0.1:6333 npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with OpenAI and specific model
  OPENAI_API_KEY=sk-xxx EMBEDDING_MODEL=text-embedding-3-large MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with VoyageAI and specific model
  EMBEDDING_PROVIDER=VoyageAI VOYAGEAI_API_KEY=pa-xxx EMBEDDING_MODEL=voyage-3-large MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with Gemini and specific model
  EMBEDDING_PROVIDER=Gemini GEMINI_API_KEY=xxx EMBEDDING_MODEL=gemini-embedding-001 MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with Ollama and specific model (using OLLAMA_MODEL)
  EMBEDDING_PROVIDER=Ollama OLLAMA_MODEL=mxbai-embed-large MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with Ollama and specific model (using EMBEDDING_MODEL)
  EMBEDDING_PROVIDER=Ollama EMBEDDING_MODEL=nomic-embed-text MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest

  # Start MCP server with local BGE-M3 sidecar in full dense+sparse+ColBERT mode
  EMBEDDING_PROVIDER=BGE_M3 BGE_M3_ENDPOINT=http://127.0.0.1:8000 MILVUS_ADDRESS=localhost:19530 npx @zilliz/claude-context-mcp@latest

  # Start shared daemon mode for two repositories
  MCP_RUNTIME_MODE=daemon MCP_DAEMON_TOKEN=local-secret MCP_DAEMON_ALLOW_ROOTS=/repo/a${path.delimiter}/repo/b npx @zilliz/claude-context-mcp@latest

  # Print direct-connect daemon bootstrap data for updated clients
  npx @zilliz/claude-context-mcp@latest --daemon-discover

  # Inspect daemon runtime and workload state without reading logs
  npx @zilliz/claude-context-mcp@latest --daemon-status

  # Cancel one repository workload, clean stale artifacts, or restart the daemon
  npx @zilliz/claude-context-mcp@latest --daemon-cancel /repo/a
  npx @zilliz/claude-context-mcp@latest --daemon-cleanup-stale
  npx @zilliz/claude-context-mcp@latest --daemon-restart --mode daemon --allow-root /repo/a
  npx @zilliz/claude-context-mcp@latest --daemon-stop
        `);
}
