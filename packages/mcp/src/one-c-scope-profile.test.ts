import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { ToolHandlers } from './handlers.js';
import { SnapshotManager } from './snapshot.js';
import { CodebaseConfigManager } from './codebase-config.js';
import type { CodebaseSessionConfig, Context } from '@zilliz/claude-context-core';

function createFakeContext(hasIndex: boolean = true): Context {
    return {
        hasIndex: async () => hasIndex,
        getCollectionName: () => 'code_chunks_test',
        getVectorDatabase: () => ({
            listCollections: async () => [],
            checkCollectionLimit: async () => true,
            hasCollection: async () => hasIndex,
            query: async () => [{ 'count(*)': 34 }],
        }),
        configureCodebaseSession: (_codebasePath: string, config: CodebaseSessionConfig) => config,
        clearIndex: async () => undefined,
        getLastAcceleratorSnapshot: () => undefined,
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

async function createIndexedCodebase(previousProfile?: 'full' | 'developer' | 'minimal') {
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
        });
    }

    const handlers = new ToolHandlers(
        createFakeContext(true),
        snapshotManager,
        codebaseConfigManager,
    );

    return { codebasePath, handlers };
}

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
