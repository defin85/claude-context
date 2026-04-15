import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MilvusRestfulVectorDatabase } from '../packages/core/src/vectordb/milvus-restful-vectordb.ts';
import { MilvusVectorDatabase } from '../packages/core/src/vectordb/milvus-vectordb.ts';
import { ToolHandlers } from '../packages/mcp/src/handlers.ts';
import { SnapshotManager } from '../packages/mcp/src/snapshot.ts';

type Sandbox = {
    rootDir: string;
    homeDir: string;
    workspaceDir: string;
    codebaseDir: string;
    outsideCodebaseDir: string;
};

function getSnapshotPath(manager: SnapshotManager): string {
    return (manager as any).snapshotFilePath as string;
}

function getLegacySnapshotPath(homeDir: string): string {
    return path.join(homeDir, '.context', 'mcp-codebase-snapshot.json');
}

function getResponseText(response: any): string {
    return (response?.content || [])
        .map((item: any) => item?.text || '')
        .join('\n');
}

async function withSandbox(run: (sandbox: Sandbox) => Promise<void>): Promise<void> {
    const previousHome = process.env.HOME;
    const previousScope = process.env.MCP_SNAPSHOT_SCOPE;

    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-merge-'));
    const homeDir = path.join(rootDir, 'home');
    const workspaceDir = path.join(rootDir, 'workspace');
    const codebaseDir = path.join(workspaceDir, 'repo');
    const outsideCodebaseDir = path.join(rootDir, 'outside-repo');

    process.env.HOME = homeDir;
    process.env.MCP_SNAPSHOT_SCOPE = 'workspace';

    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(codebaseDir, { recursive: true });
    await fs.mkdir(outsideCodebaseDir, { recursive: true });

    try {
        await run({
            rootDir,
            homeDir,
            workspaceDir,
            codebaseDir,
            outsideCodebaseDir
        });
    } finally {
        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }

        if (previousScope === undefined) {
            delete process.env.MCP_SNAPSHOT_SCOPE;
        } else {
            process.env.MCP_SNAPSHOT_SCOPE = previousScope;
        }

        await fs.rm(rootDir, { recursive: true, force: true });
    }
}

async function runCheck(name: string, check: () => Promise<void>): Promise<void> {
    await check();
    console.log(`PASS ${name}`);
}

async function main(): Promise<void> {
    await runCheck('snapshot load does not save unchanged v2 state', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const snapshotPath = getSnapshotPath(manager);
            await fs.mkdir(path.dirname(snapshotPath), { recursive: true });

            await fs.writeFile(snapshotPath, JSON.stringify({
                formatVersion: 'v2',
                codebases: {
                    [codebaseDir]: {
                        status: 'indexed',
                        indexStatus: 'completed',
                        statsState: 'unknown',
                        lastUpdated: '2026-04-15T00:00:00.000Z'
                    }
                },
                lastUpdated: '2026-04-15T00:00:00.000Z'
            }, null, 2));

            let saveCalls = 0;
            (manager as any).saveCodebaseSnapshot = async () => {
                saveCalls += 1;
            };

            manager.loadCodebaseSnapshot();
            assert.equal(saveCalls, 0);
            assert.equal(manager.getCodebaseStatus(codebaseDir), 'indexed');
        });
    });

    await runCheck('snapshot load still persists true migration from v1', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const snapshotPath = getSnapshotPath(manager);
            await fs.mkdir(path.dirname(snapshotPath), { recursive: true });

            await fs.writeFile(snapshotPath, JSON.stringify({
                indexedCodebases: [codebaseDir],
                indexingCodebases: [],
                lastUpdated: '2026-04-15T00:00:00.000Z'
            }, null, 2));

            let saveCalls = 0;
            (manager as any).saveCodebaseSnapshot = async () => {
                saveCalls += 1;
            };

            manager.loadCodebaseSnapshot();
            assert.equal(saveCalls, 1);
            assert.equal(manager.getCodebaseStatus(codebaseDir), 'indexed');
        });
    });

    await runCheck('workspace migration keeps only in-workspace codebases', async () => {
        await withSandbox(async ({ homeDir, workspaceDir, codebaseDir, outsideCodebaseDir }) => {
            await fs.mkdir(path.dirname(getLegacySnapshotPath(homeDir)), { recursive: true });
            await fs.writeFile(getLegacySnapshotPath(homeDir), JSON.stringify({
                formatVersion: 'v2',
                codebases: {
                    [codebaseDir]: {
                        status: 'indexed',
                        indexStatus: 'completed',
                        statsState: 'unknown',
                        lastUpdated: '2026-04-15T00:00:00.000Z'
                    },
                    [outsideCodebaseDir]: {
                        status: 'indexed',
                        indexStatus: 'completed',
                        statsState: 'unknown',
                        lastUpdated: '2026-04-15T00:00:00.000Z'
                    }
                },
                lastUpdated: '2026-04-15T00:00:00.000Z'
            }, null, 2));

            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            manager.loadCodebaseSnapshot();

            assert.equal(manager.getCodebaseStatus(codebaseDir), 'indexed');
            assert.equal(manager.getCodebaseStatus(outsideCodebaseDir), 'not_found');
        });
    });

    await runCheck('delete resurrection is blocked by pendingDeletes merge semantics', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir, outsideCodebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const snapshotPath = getSnapshotPath(manager);

            manager.setCodebaseIndexedWithoutStats(codebaseDir);
            manager.setCodebaseIndexedWithoutStats(outsideCodebaseDir);
            await manager.saveCodebaseSnapshot('seed');

            const staleSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
            manager.removeCodebaseCompletely(codebaseDir);

            await fs.writeFile(snapshotPath, JSON.stringify(staleSnapshot, null, 2));
            await manager.saveCodebaseSnapshot('delete-merge');

            const mergedSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
            assert.equal(Boolean(mergedSnapshot.codebases[codebaseDir]), false);
            assert.equal(Boolean(mergedSnapshot.codebases[outsideCodebaseDir]), true);
        });
    });

    await runCheck('search repairs missing snapshot when VectorDB still has data', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const vectorDb = {
                listCollections: async () => [],
                query: async () => [],
                hasCollection: async () => true,
                getCollectionDescription: async () => ''
            };
            const context = {
                getVectorDatabase: () => vectorDb,
                hasIndex: async () => true,
                semanticSearch: async () => [{
                    relativePath: 'src/example.ts',
                    startLine: 1,
                    endLine: 3,
                    content: 'const repaired = true;',
                    language: 'typescript'
                }],
                getEmbedding: () => ({ getProvider: () => 'stub' }),
                getCollectionName: () => 'stub_collection'
            };

            const handlers = new ToolHandlers(context as any, manager);
            const response = await handlers.handleSearchCode({ path: codebaseDir, query: 'repaired' });

            assert.match(getResponseText(response), /Found 1 results/);
            assert.equal(manager.getCodebaseStatus(codebaseDir), 'indexed');
        });
    });

    await runCheck('search returns explicit lost-collection error for stale snapshot', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            manager.setCodebaseIndexedWithoutStats(codebaseDir);
            await manager.saveCodebaseSnapshot('seed');

            const vectorDb = {
                listCollections: async () => [],
                hasCollection: async () => false,
                query: async () => [],
                getCollectionDescription: async () => ''
            };
            const context = {
                getVectorDatabase: () => vectorDb,
                hasIndex: async () => false,
                semanticSearch: async () => {
                    throw new Error('semanticSearch should not run for lost collection');
                },
                getEmbedding: () => ({ getProvider: () => 'stub' }),
                getCollectionName: () => 'lost_collection'
            };

            const handlers = new ToolHandlers(context as any, manager);
            const response = await handlers.handleSearchCode({ path: codebaseDir, query: 'lost' });

            assert.equal(response.isError, true);
            assert.match(getResponseText(response), /has been lost/);
        });
    });

    await runCheck('force reindex is not blocked by stale indexing state', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            manager.setCodebaseIndexing(codebaseDir, 42);
            await manager.saveCodebaseSnapshot('seed');

            const vectorDb = {
                listCollections: async () => [],
                checkCollectionLimit: async () => true,
                query: async () => [],
                getCollectionDescription: async () => ''
            };
            const context = {
                getVectorDatabase: () => vectorDb,
                hasIndex: async () => false,
                clearIndex: async () => undefined,
                addCustomExtensions: () => undefined,
                addCustomIgnorePatterns: () => undefined
            };

            const handlers = new ToolHandlers(context as any, manager);
            (handlers as any).startBackgroundIndexing = () => undefined;

            const response = await handlers.handleIndexCodebase({ path: codebaseDir, force: true });

            assert.notEqual(response.isError, true);
            assert.match(getResponseText(response), /Started background indexing/);
            assert.equal(manager.getCodebaseStatus(codebaseDir), 'indexing');
        });
    });

    await runCheck('Milvus query helpers handle omitted filters for aggregate queries', async () => {
        const grpcDb = Object.create(MilvusVectorDatabase.prototype) as any;
        grpcDb.ensureInitialized = async () => undefined;
        grpcDb.ensureLoaded = async () => undefined;

        let grpcAggregateParams: Record<string, unknown> | undefined;
        grpcDb.client = {
            query: async (params: Record<string, unknown>) => {
                grpcAggregateParams = params;
                return { status: { error_code: 'Success' }, data: [{ 'count(*)': 5 }] };
            }
        };

        const grpcAggregateResult = await grpcDb.query('collection', undefined, ['count(*)']);
        assert.deepEqual(grpcAggregateResult, [{ 'count(*)': 5 }]);
        assert.equal('filter' in (grpcAggregateParams || {}), false);
        assert.equal('limit' in (grpcAggregateParams || {}), false);

        const restDb = Object.create(MilvusRestfulVectorDatabase.prototype) as any;
        restDb.ensureInitialized = async () => undefined;
        restDb.ensureLoaded = async () => undefined;
        restDb.config = { database: 'default' };

        let restAggregateRequest: Record<string, unknown> | undefined;
        restDb.makeRequest = async (_endpoint: string, _method: 'GET' | 'POST', data?: Record<string, unknown>) => {
            restAggregateRequest = data;
            return { code: 0, data: [{ 'count(*)': 7 }] };
        };

        const restAggregateResult = await restDb.query('collection', undefined, ['count(*)']);
        assert.deepEqual(restAggregateResult, [{ 'count(*)': 7 }]);
        assert.equal('filter' in (restAggregateRequest || {}), false);
        assert.equal(restAggregateRequest?.limit, 0);
    });

    console.log('All upstream merge verification checks passed.');
}

void main().catch((error) => {
    console.error('Upstream merge verification failed.');
    console.error(error);
    process.exitCode = 1;
});
