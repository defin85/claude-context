import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { type CodebaseSessionConfig, type Context } from '@zilliz/claude-context-core';
import { CodebaseAccessPolicy } from './access-policy.js';
import { CodebaseConfigManager } from './codebase-config.js';
import {
    isDaemonInterruptedIndexingFailure,
    ToolHandlers,
} from './handlers.js';
import { SnapshotManager } from './snapshot.js';

function createStartupResumeContext(options: {
    hasIndex?: boolean;
    onConfigure?: (config: CodebaseSessionConfig) => void;
    onIndex?: (force?: boolean) => void;
} = {}): Context {
    let currentSessionConfig: CodebaseSessionConfig = {};

    return {
        hasIndex: async () => options.hasIndex ?? true,
        getCollectionName: () => 'code_chunks_test',
        getVectorDatabase: () => ({
            listCollections: async () => [],
            checkCollectionLimit: async () => true,
            hasCollection: async () => options.hasIndex ?? true,
            query: async () => [{ 'count(*)': 1 }],
        }),
        configureCodebaseSession: (_codebasePath: string, config: CodebaseSessionConfig) => {
            currentSessionConfig = {
                ...config,
                retrievalMode: config.retrievalProfile === 'quality' ? 'bge_m3_full' : config.retrievalMode || 'dense',
                retrievalSchemaVersion: 1,
            };
            options.onConfigure?.(currentSessionConfig);
            return currentSessionConfig;
        },
        getCodebaseSessionConfig: () => currentSessionConfig,
        getEmbedding: () => ({
            getProvider: () => 'fake',
            getDimension: () => 3,
        }),
        getLoadedIgnorePatterns: async () => undefined,
        getIgnorePatterns: () => [],
        getSupportedExtensions: () => ['.ts', '.bsl'],
        indexCodebase: async (_codebasePath: string, _progress: unknown, force?: boolean) => {
            options.onIndex?.(force);
            return { indexedFiles: 1, totalChunks: 2, status: 'completed' as const };
        },
    } as unknown as Context;
}

test('daemon interrupted failure classifier is narrow', () => {
    assert.equal(
        isDaemonInterruptedIndexingFailure('MCP runtime shutdown interrupted indexing before completion.'),
        true
    );
    assert.equal(
        isDaemonInterruptedIndexingFailure('Indexing was interrupted or abandoned (owner pid 123 is not alive). Please run index_codebase again.'),
        true
    );
    assert.equal(
        isDaemonInterruptedIndexingFailure('Embedding provider returned 500'),
        false
    );
});

test('startup resume queues interrupted codebase with persisted config and force disabled', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-startup-resume-'));
    const codebasePath = path.join(workspacePath, 'repo');
    await fs.mkdir(codebasePath);

    const snapshotManager = new SnapshotManager({ workspacePath, saveDebounceMs: 10 });
    snapshotManager.setCodebaseIndexFailed(
        codebasePath,
        'MCP runtime shutdown interrupted indexing before completion.',
        42
    );

    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    await codebaseConfigManager.saveConfig(codebasePath, {
        customExtensions: ['.bsl'],
        customIgnorePatterns: ['tmp/**'],
        retrievalProfile: 'quality',
        retrievalMode: 'bge_m3_full',
        retrievalSchemaVersion: 1,
        oneCIndexScopeProfile: 'v8unpack',
        rlmBslEnrichment: { mode: 'optional', command: 'rlm' },
    });

    const configuredSessions: CodebaseSessionConfig[] = [];
    const forceValues: Array<boolean | undefined> = [];
    const handlers = new ToolHandlers(
        createStartupResumeContext({
            onConfigure: (config) => configuredSessions.push(config),
            onIndex: (force) => forceValues.push(force),
        }),
        snapshotManager,
        codebaseConfigManager,
        undefined,
        new CodebaseAccessPolicy({ mode: 'daemon', allowedRoots: [workspacePath] }),
    );

    const results = await handlers.resumeInterruptedIndexingOnStartup();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, 'queued');
    assert.equal(configuredSessions[0].retrievalProfile, 'quality');
    assert.equal(configuredSessions[0].oneCIndexScopeProfile, 'v8unpack');
    assert.deepEqual(configuredSessions[0].customExtensions, ['.bsl']);
    assert.deepEqual(configuredSessions[0].customIgnorePatterns, ['tmp/**']);
    assert.equal(configuredSessions[0].rlmBslEnrichment?.mode, 'optional');
    assert.deepEqual(forceValues, [false]);
});

test('startup resume skips ordinary failed codebases', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-startup-resume-skip-'));
    const codebasePath = path.join(workspacePath, 'repo');
    await fs.mkdir(codebasePath);

    const snapshotManager = new SnapshotManager({ workspacePath, saveDebounceMs: 10 });
    snapshotManager.setCodebaseIndexFailed(codebasePath, 'Embedding provider returned 500', 10);

    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    await codebaseConfigManager.saveConfig(codebasePath, { retrievalProfile: 'quality' });

    let indexCalled = false;
    const handlers = new ToolHandlers(
        createStartupResumeContext({ onIndex: () => { indexCalled = true; } }),
        snapshotManager,
        codebaseConfigManager,
        undefined,
        new CodebaseAccessPolicy({ mode: 'daemon', allowedRoots: [workspacePath] }),
    );

    const results = await handlers.resumeInterruptedIndexingOnStartup();

    assert.deepEqual(results, []);
    assert.equal(indexCalled, false);
});

test('index_codebase persists config before background indexing completes', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-index-config-early-'));
    const codebasePath = path.join(workspacePath, 'repo');
    await fs.mkdir(codebasePath);

    const snapshotManager = new SnapshotManager({ workspacePath, saveDebounceMs: 10 });
    const codebaseConfigManager = new CodebaseConfigManager({ workspacePath });
    const handlers = new ToolHandlers(
        createStartupResumeContext({ hasIndex: false }),
        snapshotManager,
        codebaseConfigManager,
        undefined,
        new CodebaseAccessPolicy({ mode: 'daemon', allowedRoots: [workspacePath] }),
    );

    const result = await handlers.handleIndexCodebase({
        path: codebasePath,
        customExtensions: ['.bsl'],
        ignorePatterns: ['tmp/**'],
        retrievalProfile: 'quality',
        oneCIndexScopeProfile: 'v8unpack',
    });

    assert.equal(result.isError, undefined);
    const persistedConfig = await codebaseConfigManager.getConfig(codebasePath);
    assert.equal(persistedConfig?.retrievalProfile, 'quality');
    assert.equal(persistedConfig?.oneCIndexScopeProfile, 'v8unpack');
    assert.deepEqual(persistedConfig?.customExtensions, ['.bsl']);
    assert.deepEqual(persistedConfig?.customIgnorePatterns, ['tmp/**']);
});
