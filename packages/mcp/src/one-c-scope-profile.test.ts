import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { ToolHandlers } from './handlers.js';
import { SnapshotManager } from './snapshot.js';
import { CodebaseConfigManager } from './codebase-config.js';
import {
    Context as CoreContext,
    Embedding,
    type CodebaseSessionConfig,
    type Context,
    type EmbeddingVector,
    type HybridSearchOptions,
    type HybridSearchRequest,
    type HybridSearchResult,
    type IndexingAcceleratorSnapshot,
    type InitialIndexingManifest,
    type MultiVectorEmbedding,
    type RankingProfile,
    type RetrievalProfile,
    type SearchOptions,
    type SemanticSearchResult,
    type VectorDatabase,
    type VectorSearchResult,
} from '@zilliz/claude-context-core';

class RealBgeM3FullEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'BGE_M3';
    }

    getMode(): string {
        return 'full';
    }

    async embedMulti(): Promise<MultiVectorEmbedding> {
        return {
            dense: { vector: [1, 0, 0], dimension: 3 },
            sparse: { indices: [1], values: [1] },
            colbert: { vectors: [[1, 0]], dimension: 2, tokenCount: 1 },
        };
    }

    async embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]> {
        return texts.map(() => ({
            dense: { vector: [1, 0, 0], dimension: 3 },
            sparse: { indices: [1], values: [1] },
            colbert: { vectors: [[1, 0]], dimension: 2, tokenCount: 1 },
        }));
    }
}

class SearchCapturingVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    searchCollectionName: string | undefined;
    bgeM3SearchCalled = false;

    async createCollection(collectionName: string): Promise<void> { this.collections.add(collectionName); }
    async createHybridCollection(collectionName: string): Promise<void> { this.collections.add(collectionName); }
    async createBgeM3Collection(collectionName: string): Promise<void> { this.collections.add(collectionName); }
    async dropCollection(collectionName: string): Promise<void> { this.collections.delete(collectionName); }
    async hasCollection(collectionName: string): Promise<boolean> { return this.collections.has(collectionName); }
    async listCollections(): Promise<string[]> { return [...this.collections]; }
    async insert(): Promise<void> {}
    async insertHybrid(): Promise<void> {}
    async insertBgeM3(): Promise<void> {}
    async search(collectionName: string, _queryVector: number[], _options?: SearchOptions): Promise<VectorSearchResult[]> {
        this.searchCollectionName = collectionName;
        return [{
            document: {
                id: 'real-context-result',
                vector: [1, 0, 0],
                content: 'export const value = 1;',
                relativePath: 'src/index.ts',
                startLine: 1,
                endLine: 1,
                fileExtension: '.ts',
                metadata: { language: 'typescript' },
            },
            score: 0.9,
        }];
    }
    async hybridSearch(): Promise<HybridSearchResult[]> { return []; }
    async bgeM3HybridSearch(_collectionName: string, _searchRequests: HybridSearchRequest[], _options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
        this.bgeM3SearchCalled = true;
        return [];
    }
    async delete(): Promise<void> {}
    async query(): Promise<Record<string, any>[]> { return [{ 'count(*)': 1 }]; }
    async getCollectionDescription(): Promise<string> { return ''; }
    async checkCollectionLimit(): Promise<boolean> { return true; }
    async getCollectionRowCount(): Promise<number> { return 1; }
}

function createFakeContext(
    hasIndex: boolean = true,
    onSemanticSearch?: (args: {
        codebasePath: string;
        query: string;
        topK: number;
        threshold: number;
        filterExpr?: string;
        rankingProfile?: RankingProfile;
    }) => SemanticSearchResult[],
    indexCodebase?: () => Promise<{ indexedFiles: number; totalChunks: number; status: 'completed'; codeChunkLimit?: number }>,
    acceleratorSnapshot?: IndexingAcceleratorSnapshot,
): Context {
    let currentSessionConfig: CodebaseSessionConfig = {};
    return {
        hasIndex: async () => hasIndex,
        getCollectionName: () => 'code_chunks_test',
        getVectorDatabase: () => ({
            listCollections: async () => [],
            checkCollectionLimit: async () => true,
            hasCollection: async () => hasIndex,
            query: async () => [{ 'count(*)': 34 }],
        }),
        configureCodebaseSession: (_codebasePath: string, config: CodebaseSessionConfig) => {
            const retrievalProfile = config.retrievalProfile;
            const retrievalMode = retrievalProfile === 'quality'
                ? 'bge_m3_full'
                : retrievalProfile === 'fast'
                    ? 'dense'
                    : config.retrievalMode || 'hybrid_bm25';
            currentSessionConfig = {
                ...config,
                ...(retrievalProfile ? { retrievalProfile } : {}),
                retrievalMode,
                retrievalSchemaVersion: 1,
            };
            return currentSessionConfig;
        },
        getCodebaseSessionConfig: () => currentSessionConfig,
        semanticSearch: async (
            codebasePath: string,
            query: string,
            topK: number,
            threshold: number,
            filterExpr?: string,
            options?: { rankingProfile?: RankingProfile },
        ) => onSemanticSearch?.({
            codebasePath,
            query,
            topK,
            threshold,
            filterExpr,
            rankingProfile: options?.rankingProfile,
        }) || [],
        getEmbedding: () => ({
            getProvider: () => 'fake',
            getDimension: () => 3,
        }),
        clearIndex: async () => undefined,
        getLastAcceleratorSnapshot: () => acceleratorSnapshot,
        getLoadedIgnorePatterns: async () => undefined,
        getIgnorePatterns: () => [],
        getSupportedExtensions: () => ['.ts', '.bsl', '.json'],
        getPreparedCollection: async () => undefined,
        setSynchronizerForCodebase: () => undefined,
        indexCodebase: indexCodebase || (async () => {
            throw new Error('planned indexing failure');
        }),
    } as unknown as Context;
}

function getStructuredContent(result: unknown): Record<string, unknown> {
    assert.equal(typeof result, 'object');
    assert.notEqual(result, null);
    const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
    assert.equal(typeof structuredContent, 'object');
    assert.notEqual(structuredContent, null);
    return structuredContent as Record<string, unknown>;
}

function createManifestIdentity(codebasePath: string): InitialIndexingManifest['identity'] {
    return {
        codebasePath,
        collectionName: 'code_chunks_test',
        vectorBackend: 'test',
        retrievalMode: 'dense',
        vectorSchemaFingerprint: 'schema-v1',
        embeddingProfileFingerprint: 'test:dense',
        splitterFingerprint: 'test',
        fileSelectionFingerprint: 'files-v1',
        supportedExtensions: ['.ts'],
        ignorePatterns: [],
    };
}

async function createIndexedCodebase(
    previousProfile?: 'full' | 'developer' | 'minimal' | 'v8unpack',
    context?: Context,
    retrievalConfig?: {
        retrievalProfile?: RetrievalProfile;
        retrievalMode?: CodebaseSessionConfig['retrievalMode'];
        retrievalSchemaVersion?: number;
    },
) {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-one-c-scope-'));
    const rawCodebasePath = path.join(workspacePath, 'cf');
    await fs.mkdir(rawCodebasePath, { recursive: true });
    const codebasePath = await fs.realpath(rawCodebasePath);

    const snapshotManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    snapshotManager.setCodebaseIndexed(codebasePath, {
        indexedFiles: 12,
        totalChunks: 34,
        status: 'completed',
        ...(previousProfile && previousProfile !== 'full' ? { oneCIndexScopeProfile: previousProfile } : {}),
    });

    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    if (previousProfile) {
        await codebaseConfigManager.saveConfig(codebasePath, {
            oneCIndexScopeProfile: previousProfile,
            ...retrievalConfig,
        });
    } else if (retrievalConfig) {
        await codebaseConfigManager.saveConfig(codebasePath, retrievalConfig);
    }

    const handlers = new ToolHandlers(
        context || createFakeContext(true),
        snapshotManager,
        codebaseConfigManager,
    );

    return { codebasePath, handlers };
}

test('codebase config persists retrieval profile next to mode and schema', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-retrieval-profile-config-'));
    const codebasePath = await fs.realpath(workspacePath);
    const manager = new CodebaseConfigManager({ workspacePath });

    await manager.saveConfig(codebasePath, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });

    const loaded = await manager.getConfig(codebasePath);
    assert.equal(loaded?.retrievalProfile, 'fast');
    assert.equal(loaded?.retrievalMode, 'dense');
    assert.equal(loaded?.retrievalSchemaVersion, 1);
});

test('clear_index removes configured-only codebase without clearing cloud index', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-clear-configured-only-'));
    const rawCodebasePath = path.join(workspacePath, 'configured-only');
    await fs.mkdir(rawCodebasePath, { recursive: true });
    const codebasePath = await fs.realpath(rawCodebasePath);
    const snapshotManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    await codebaseConfigManager.saveConfig(codebasePath, {
        retrievalProfile: 'quality',
        retrievalMode: 'bge_m3_full',
        retrievalSchemaVersion: 1,
    });
    let clearIndexCalled = false;
    const context = {
        ...createFakeContext(false),
        clearIndex: async () => {
            clearIndexCalled = true;
        },
    } as unknown as Context;
    const handlers = new ToolHandlers(context, snapshotManager, codebaseConfigManager);

    const result = await handlers.handleClearIndex({ path: codebasePath });

    assert.equal((result as { isError?: boolean }).isError, undefined);
    assert.equal(getStructuredContent(result).cleared, true);
    assert.equal(clearIndexCalled, false);
    assert.equal(await codebaseConfigManager.hasConfig(codebasePath), false);
    assert.equal(snapshotManager.getCodebaseStatus(codebasePath), 'not_found');
});

test('index_codebase rejects incompatible retrieval profile changes without force', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, undefined, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        retrievalProfile: 'quality',
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /retrievalProfile change requires force=true/);
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.retrievalProfile, 'quality');
    assert.equal(structuredContent.persistedRetrievalProfile, 'fast');
    assert.equal(structuredContent.forceRequired, true);
});

test('index_codebase rejects incompatible retrieval profile when snapshot is missing', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-retrieval-profile-drift-'));
    const rawCodebasePath = path.join(workspacePath, 'cf');
    await fs.mkdir(rawCodebasePath, { recursive: true });
    const codebasePath = await fs.realpath(rawCodebasePath);
    const snapshotManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    await codebaseConfigManager.saveConfig(codebasePath, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });
    const handlers = new ToolHandlers(
        createFakeContext(false),
        snapshotManager,
        codebaseConfigManager,
    );

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        retrievalProfile: 'quality',
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /retrievalProfile change requires force=true/);
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.retrievalProfile, 'quality');
    assert.equal(structuredContent.persistedRetrievalProfile, 'fast');
    assert.equal(structuredContent.forceRequired, true);
});

test('get_indexing_status reports persisted retrieval profile', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, undefined, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });

    const result = await handlers.handleGetIndexingStatus({ path: codebasePath });

    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.retrievalProfile, 'fast');
    assert.equal(structuredContent.retrievalMode, 'dense');
    assert.equal(structuredContent.retrievalSchemaVersion, 1);
    assert.match(result.content[0].text, /Retrieval profile: fast/);
});

test('get_indexing_status reports initial indexing mode and resume counters', async () => {
    let codebasePath = '';
    const context = {
        ...createFakeContext(true),
        getLastInitialIndexingManifest: () => ({
            selectedMode: 'initial_resume',
            runState: 'indexing',
            identity: createManifestIdentity(codebasePath),
            confirmedDocumentIds: ['doc-1'],
            batches: [
                { state: 'inserted', documentIds: ['doc-1'] },
                { state: 'failed', documentIds: ['doc-2'] },
            ],
            traversal: {
                selectedFileCount: 2,
                hashedFileCount: 2,
            },
        }),
    } as unknown as Context;
    const indexed = await createIndexedCodebase(undefined, context);
    codebasePath = indexed.codebasePath;

    const result = await indexed.handlers.handleGetIndexingStatus({ path: indexed.codebasePath });

    const initialIndexing = getStructuredContent(result).initialIndexing as Record<string, unknown>;
    assert.equal(initialIndexing.mode, 'initial_resume');
    assert.equal(typeof initialIndexing.manifestIdentifier, 'string');
    assert.equal(initialIndexing.confirmedDocumentCount, 1);
    assert.equal(initialIndexing.remainingDocumentCount, 1);
    assert.equal(initialIndexing.failedBatchCount, 1);
});

test('get_indexing_status reports persisted initial indexing manifest when last in-memory manifest is absent', async () => {
    let codebasePath = '';
    const context = {
        ...createFakeContext(true),
        getInitialIndexingManifestForCodebase: async () => ({
            selectedMode: 'initial_resume',
            runState: 'failed',
            identity: createManifestIdentity(codebasePath),
            confirmedDocumentIds: ['doc-1'],
            batches: [
                { id: '1', state: 'inserted', filePaths: ['first.ts'], documentIds: ['doc-1'], updatedAt: '2026-01-01T00:00:00.000Z' },
                { id: '2', state: 'failed', filePaths: ['second.ts'], documentIds: ['doc-2'], updatedAt: '2026-01-01T00:00:00.000Z' },
            ],
            traversal: {
                selectedFileCount: 2,
                hashedFileCount: 2,
                selectedFileFingerprint: 'files-v1',
            },
            manifestVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        } satisfies InitialIndexingManifest),
    } as unknown as Context;
    const indexed = await createIndexedCodebase(undefined, context);
    codebasePath = indexed.codebasePath;

    const result = await indexed.handlers.handleGetIndexingStatus({ path: indexed.codebasePath });

    const initialIndexing = getStructuredContent(result).initialIndexing as Record<string, unknown>;
    assert.equal(initialIndexing.mode, 'initial_resume');
    assert.equal(initialIndexing.runState, 'failed');
    assert.equal(typeof initialIndexing.manifestIdentifier, 'string');
    assert.equal(initialIndexing.confirmedDocumentCount, 1);
    assert.equal(initialIndexing.remainingDocumentCount, 1);
});

test('index_codebase lets existing compatible indexes reach core mode planner', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-existing-index-planner-'));
    const rawCodebasePath = path.join(workspacePath, 'cf');
    await fs.mkdir(rawCodebasePath, { recursive: true });
    const codebasePath = await fs.realpath(rawCodebasePath);
    const snapshotManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    snapshotManager.setCodebaseIndexed(codebasePath, {
        indexedFiles: 2,
        totalChunks: 2,
        status: 'completed',
    });
    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    await codebaseConfigManager.saveConfig(codebasePath, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });
    let indexCalled = false;
    const context = createFakeContext(true, undefined, async () => {
        indexCalled = true;
        return {
            indexedFiles: 0,
            totalChunks: 0,
            status: 'completed',
            codeChunkLimit: 900000,
            initialIndexing: {
                mode: 'incremental_changes',
                resumeEligible: false,
                manifestCompatibility: 'missing',
                confirmedDocumentCount: 2,
                skippedDocumentCount: 0,
                remainingDocumentCount: 0,
                unconfirmedDocumentCount: 0,
                failedBatchCount: 0,
                batchCount: 1,
            },
        };
    });
    const handlers = new ToolHandlers(context, snapshotManager, codebaseConfigManager);

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        retrievalProfile: 'fast',
    });

    assert.equal(result.isError, undefined);
    for (let attempt = 0; attempt < 20 && !indexCalled; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(indexCalled, true);
});

test('index_codebase resumes partial initial index without sync config when manifest is resumable', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-resume-no-sync-config-'));
    const rawCodebasePath = path.join(workspacePath, 'cf');
    await fs.mkdir(rawCodebasePath, { recursive: true });
    const codebasePath = await fs.realpath(rawCodebasePath);
    const snapshotManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    let indexCalled = false;
    const context = {
        ...createFakeContext(true, undefined, async () => {
            indexCalled = true;
            return {
                indexedFiles: 1,
                totalChunks: 1,
                status: 'completed',
                codeChunkLimit: 900000,
                initialIndexing: {
                    mode: 'initial_resume',
                    resumeEligible: true,
                    manifestCompatibility: 'compatible',
                    confirmedDocumentCount: 1,
                    skippedDocumentCount: 1,
                    remainingDocumentCount: 0,
                    unconfirmedDocumentCount: 0,
                    failedBatchCount: 0,
                    batchCount: 1,
                },
            };
        }),
        getInitialIndexingManifestForCodebase: async () => ({
            selectedMode: 'initial_full',
            runState: 'failed',
            identity: createManifestIdentity(codebasePath),
            confirmedDocumentIds: ['doc-1'],
            batches: [
                { id: '1', state: 'inserted', filePaths: ['first.ts'], documentIds: ['doc-1'], updatedAt: '2026-01-01T00:00:00.000Z' },
            ],
            traversal: {
                selectedFileCount: 1,
                hashedFileCount: 1,
                selectedFileFingerprint: 'files-v1',
            },
            manifestVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        } satisfies InitialIndexingManifest),
    } as unknown as Context;
    const handlers = new ToolHandlers(context, snapshotManager, codebaseConfigManager);

    const result = await handlers.handleIndexCodebase({ path: codebasePath });

    assert.equal(result.isError, undefined);
    for (let attempt = 0; attempt < 20 && !indexCalled; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(indexCalled, true);
});

test('get_indexing_status omits accelerator snapshot from a different codebase', async () => {
    const otherPath = path.join(os.tmpdir(), 'other-codebase');
    const context = createFakeContext(true, undefined, undefined, {
        codebasePath: otherPath,
        batches: [{ id: 1, chunkCount: 1, attempts: 1, state: 'queued', firstFile: path.join(otherPath, 'src', 'other.ts') }],
    } as IndexingAcceleratorSnapshot);
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, context);

    const result = await handlers.handleGetIndexingStatus({ path: codebasePath });

    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.accelerator, undefined);
});

test('force retrieval profile change preserves old config when indexing fails', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, createFakeContext(true), {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        force: true,
        retrievalProfile: 'quality',
    });

    assert.equal((result as { isError?: boolean }).isError, undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const configManager = (handlers as unknown as { codebaseConfigManager: CodebaseConfigManager }).codebaseConfigManager;
    const loaded = await configManager.getConfig(codebasePath);
    assert.equal(loaded?.retrievalProfile, 'fast');
    assert.equal(loaded?.retrievalMode, 'dense');
});

test('force retrieval profile change saves new config after successful indexing', async () => {
    const context = createFakeContext(true, undefined, async () => ({
        indexedFiles: 1,
        totalChunks: 1,
        status: 'completed',
    }));
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, context, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        force: true,
        retrievalProfile: 'quality',
    });

    assert.equal((result as { isError?: boolean }).isError, undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const configManager = (handlers as unknown as { codebaseConfigManager: CodebaseConfigManager }).codebaseConfigManager;
    const loaded = await configManager.getConfig(codebasePath);
    assert.equal(loaded?.retrievalProfile, 'quality');
    assert.equal(loaded?.retrievalMode, 'bge_m3_full');
    assert.equal(loaded?.retrievalSchemaVersion, 1);
});

test('index_codebase rejects incompatible 1C scope changes without force', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase('developer');

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        oneCIndexScopeProfile: 'minimal',
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /1C indexing scope profile change requires force=true/);
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.oneCIndexScopeProfile, 'minimal');
    assert.equal(structuredContent.persistedOneCIndexScopeProfile, 'developer');
});

test('index_codebase accepts v8unpack 1C scope profile and persists it', async () => {
    const context = createFakeContext(false, undefined, async () => ({
        indexedFiles: 3,
        totalChunks: 5,
        status: 'completed',
    }));
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, context);
    await fs.mkdir(path.join(codebasePath, 'CommonModule', 'Обмен'), { recursive: true });
    await fs.writeFile(path.join(codebasePath, 'CommonModule', 'Обмен', 'CommonModule.obj.bsl'), 'Процедура Обмен() КонецПроцедуры');

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        force: true,
        oneCIndexScopeProfile: 'v8unpack',
    });

    assert.equal((result as { isError?: boolean }).isError, undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const configManager = (handlers as unknown as { codebaseConfigManager: CodebaseConfigManager }).codebaseConfigManager;
    const loaded = await configManager.getConfig(codebasePath);
    assert.equal(loaded?.oneCIndexScopeProfile, 'v8unpack');
});

test('index_codebase MCP schema lists v8unpack 1C scope profile', async () => {
    const indexSource = await fs.readFile(new URL('./index.ts', import.meta.url), 'utf8');

    assert.match(indexSource, /enum: \['full', 'developer', 'minimal', 'v8unpack'\]/);
    assert.match(indexSource, /For non-1C repositories, omit this parameter or use the default 'full'/);
    assert.match(indexSource, /For ordinary Designer\/EDT 1C exports, prefer 'developer'/);
});

test('index_codebase rejects full-to-reduced 1C scope changes without force', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase();

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        oneCIndexScopeProfile: 'developer',
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /force=true/);
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.oneCIndexScopeProfile, 'developer');
    assert.equal(structuredContent.persistedOneCIndexScopeProfile, 'full');
});

test('index_codebase rejects reduced-to-full 1C scope changes without force', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase('minimal');

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        oneCIndexScopeProfile: 'full',
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /force=true/);
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.oneCIndexScopeProfile, 'full');
    assert.equal(structuredContent.persistedOneCIndexScopeProfile, 'minimal');
});

test('get_indexing_status reports reduced 1C scope warning', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase('developer');

    const result = await handlers.handleGetIndexingStatus({
        path: codebasePath,
    });

    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.oneCIndexScopeProfile, 'developer');
    assert.match(String(structuredContent.reducedCoverageWarning), /developer/);
    assert.match(String(structuredContent.reducedCoverageWarning), /may not contain all files/);
    assert.match(result.content[0].text, /1C scope/);
});

test('get_indexing_status reports v8unpack as scoped 1C coverage', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase('v8unpack');

    const result = await handlers.handleGetIndexingStatus({
        path: codebasePath,
    });

    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.oneCIndexScopeProfile, 'v8unpack');
    assert.match(String(structuredContent.reducedCoverageWarning), /v8unpack/);
    assert.match(String(structuredContent.reducedCoverageWarning), /may not contain all files/);
});

test('search_code accepts ranking profile and reports resolved profile', async () => {
    let capturedRankingProfile: RankingProfile | undefined;
    const context = createFakeContext(true, (args) => {
        capturedRankingProfile = args.rankingProfile;
        return [{
            relativePath: 'src/Documents/Foo.ts',
            language: 'typescript',
            startLine: 1,
            endLine: 3,
            score: 0.7,
            content: 'export function foo() {}',
            metadata: { rankingProfile: args.rankingProfile },
        }];
    });
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, context);

    const result = await handlers.handleSearchCode({
        path: codebasePath,
        query: 'foo',
        rankingProfile: 'generic',
    });

    assert.equal((result as { isError?: boolean }).isError, undefined);
    assert.equal(capturedRankingProfile, 'generic');
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.rankingProfile, 'generic');
    assert.equal((structuredContent.results as Array<Record<string, unknown>>)[0].relativePath, 'src/Documents/Foo.ts');
});

test('search_code applies persisted retrieval profile before searching', async () => {
    let configuredRetrievalProfile: RetrievalProfile | undefined;
    const context = createFakeContext(true, (args) => [{
        relativePath: 'src/index.ts',
        language: 'typescript',
        startLine: 1,
        endLine: 1,
        score: 0.9,
        content: 'export const value = 1;',
        metadata: { rankingProfile: args.rankingProfile },
    }]);
    const originalConfigure = context.configureCodebaseSession.bind(context);
    (context as unknown as {
        configureCodebaseSession: (codebasePath: string, config: CodebaseSessionConfig) => CodebaseSessionConfig;
    }).configureCodebaseSession = (codebasePath, config) => {
        configuredRetrievalProfile = config.retrievalProfile;
        return originalConfigure(codebasePath, config);
    };
    const { codebasePath, handlers } = await createIndexedCodebase(undefined, context, {
        retrievalProfile: 'fast',
        retrievalMode: 'dense',
        retrievalSchemaVersion: 1,
    });

    const result = await handlers.handleSearchCode({
        path: codebasePath,
        query: 'value',
    });

    assert.equal(configuredRetrievalProfile, 'fast');
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.retrievalProfile, 'fast');
    assert.equal(structuredContent.retrievalMode, 'dense');
    assert.equal(structuredContent.retrievalSchemaVersion, 1);
});

test('search_code applies persisted BGE-M3 fast profile through real Context collection selection', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-real-context-retrieval-'));
    const rawCodebasePath = path.join(workspacePath, 'cf');
    await fs.mkdir(rawCodebasePath, { recursive: true });
    const codebasePath = await fs.realpath(rawCodebasePath);
    const snapshotManager = new SnapshotManager({
        workspacePath,
        saveDebounceMs: 10,
    });
    snapshotManager.setCodebaseIndexed(codebasePath, {
        indexedFiles: 1,
        totalChunks: 1,
        status: 'completed',
    });
    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    await codebaseConfigManager.saveConfig(codebasePath, {
        retrievalProfile: 'fast',
        retrievalMode: 'bge_m3_dense',
        retrievalSchemaVersion: 1,
    });
    const vectorDatabase = new SearchCapturingVectorDatabase();
    const context = new CoreContext({
        embedding: new RealBgeM3FullEmbedding(),
        vectorDatabase,
    });
    context.configureCodebaseSession(codebasePath, {
        retrievalProfile: 'fast',
        retrievalMode: 'bge_m3_dense',
        retrievalSchemaVersion: 1,
    });
    vectorDatabase.collections.add(context.getCollectionName(codebasePath));
    const handlers = new ToolHandlers(
        context,
        snapshotManager,
        codebaseConfigManager,
    );

    const result = await handlers.handleSearchCode({
        path: codebasePath,
        query: 'value',
    });

    assert.equal((result as { isError?: boolean }).isError, undefined);
    assert.match(vectorDatabase.searchCollectionName || '', /^bge_m3_dense_code_chunks_/);
    assert.equal(vectorDatabase.bgeM3SearchCalled, false);
    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.retrievalProfile, 'fast');
    assert.equal(structuredContent.retrievalMode, 'bge_m3_dense');
});


test('search_code rejects invalid ranking profile before search', async () => {
    const { codebasePath, handlers } = await createIndexedCodebase();

    const result = await handlers.handleSearchCode({
        path: codebasePath,
        query: 'foo',
        rankingProfile: 'typescript',
    });

    assert.equal((result as { isError?: boolean }).isError, true);
    assert.match(result.content[0].text, /Invalid rankingProfile/);
});

test('search_code keeps ranking profile independent from 1C indexing scope', async () => {
    const context = createFakeContext(true, (args) => [{
        relativePath: 'src/cf/Catalogs/Контрагенты/Ext/ObjectModule.bsl',
        language: 'bsl',
        startLine: 1,
        endLine: 3,
        score: 0.7,
        content: 'Процедура Обработка() КонецПроцедуры',
        metadata: { rankingProfile: args.rankingProfile },
    }]);
    const { codebasePath, handlers } = await createIndexedCodebase('v8unpack', context);

    const result = await handlers.handleSearchCode({
        path: codebasePath,
        query: 'контрагенты',
        rankingProfile: 'generic',
    });

    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.rankingProfile, 'generic');
    assert.equal(structuredContent.oneCIndexScopeProfile, 'v8unpack');
});
