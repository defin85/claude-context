import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { ToolHandlers } from './handlers.js';
import { SnapshotManager } from './snapshot.js';
import { CodebaseConfigManager } from './codebase-config.js';
import type { CodebaseSessionConfig, Context, RankingProfile, RetrievalProfile, SemanticSearchResult } from '@zilliz/claude-context-core';

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
        getLastAcceleratorSnapshot: () => undefined,
        getLoadedIgnorePatterns: async () => undefined,
        getIgnorePatterns: () => [],
        getSupportedExtensions: () => ['.ts'],
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

async function createIndexedCodebase(
    previousProfile?: 'full' | 'developer' | 'minimal',
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
    const { codebasePath, handlers } = await createIndexedCodebase('developer', context);

    const result = await handlers.handleSearchCode({
        path: codebasePath,
        query: 'контрагенты',
        rankingProfile: 'generic',
    });

    const structuredContent = getStructuredContent(result);
    assert.equal(structuredContent.rankingProfile, 'generic');
    assert.equal(structuredContent.oneCIndexScopeProfile, 'developer');
});
