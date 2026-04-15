import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '../packages/core/src/context.ts';
import { OllamaEmbedding } from '../packages/core/src/embedding/ollama-embedding.ts';
import { FileSynchronizer } from '../packages/core/src/sync/synchronizer.ts';
import { MilvusRestfulVectorDatabase } from '../packages/core/src/vectordb/milvus-restful-vectordb.ts';
import { MilvusVectorDatabase } from '../packages/core/src/vectordb/milvus-vectordb.ts';
import type {
    HybridSearchOptions,
    HybridSearchRequest,
    HybridSearchResult,
    SearchOptions,
    VectorDatabase,
    VectorDocument,
    VectorSearchResult
} from '../packages/core/src/vectordb/types.ts';
import { CodebaseConfigManager } from '../packages/mcp/src/codebase-config.ts';
import { CodebaseAccessPolicy } from '../packages/mcp/src/access-policy.ts';
import type { CodebaseSnapshotV2 } from '../packages/mcp/src/config.ts';
import { createMcpRuntimeConfig } from '../packages/mcp/src/config.ts';
import { DaemonRegistryManager } from '../packages/mcp/src/daemon-registry.ts';
import { ToolHandlers } from '../packages/mcp/src/handlers.ts';
import { RuntimeStatusManager } from '../packages/mcp/src/runtime-status.ts';
import { SnapshotManager } from '../packages/mcp/src/snapshot.ts';
import type { IndexingOwnershipClaimResult } from '../packages/mcp/src/snapshot.ts';
import { SyncManager } from '../packages/mcp/src/sync.ts';
import { WorkloadManager } from '../packages/mcp/src/workload-manager.ts';

type Sandbox = {
    rootDir: string;
    homeDir: string;
    workspaceDir: string;
    codebaseDir: string;
    outsideCodebaseDir: string;
};

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const snapshotWorkerScriptPath = path.join(scriptsDir, 'snapshot-worker.ts');
const repoRequire = createRequire(import.meta.url);

function getSnapshotPath(manager: SnapshotManager): string {
    return (manager as any).snapshotFilePath as string;
}

function getLegacySnapshotPath(homeDir: string): string {
    return path.join(homeDir, '.context', 'mcp-codebase-snapshot.json');
}

function getRuntimeStatusPath(homeDir: string): string {
    return path.join(homeDir, '.context', 'mcp', 'runtime', `${process.pid}.json`);
}

function createCodebaseConfigManager(workspaceDir: string): CodebaseConfigManager {
    return new CodebaseConfigManager({ workspacePath: workspaceDir });
}

function createDaemonCodebaseConfigManager(workspaceDir: string): CodebaseConfigManager {
    return new CodebaseConfigManager({ workspacePath: workspaceDir, scope: 'daemon' });
}

function createWorkspaceFolder(fsPath: string, name: string = path.basename(fsPath)) {
    return {
        name,
        uri: { fsPath }
    };
}

function createExtensionContext(initialState: Record<string, unknown> = {}) {
    const store = new Map(Object.entries(initialState));

    return {
        workspaceState: {
            get<T>(key: string): T | undefined {
                return store.get(key) as T | undefined;
            },
            async update(key: string, value: unknown): Promise<void> {
                if (value === undefined) {
                    store.delete(key);
                    return;
                }

                store.set(key, value);
            }
        },
        subscriptions: [] as Array<{ dispose?: () => void }>
    };
}

function clearRequireCache(modulePath: string): void {
    try {
        delete repoRequire.cache[repoRequire.resolve(modulePath)];
    } catch {
        // Ignore modules that were never loaded.
    }
}

async function flushAsyncWork(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function withMockedVscode<T>(run: (helpers: {
    vscode: any;
    loadModule: <TModule = any>(modulePath: string) => TModule;
}) => Promise<T>): Promise<T> {
    const mockModuleDir = path.join(repoRoot, 'node_modules', 'vscode');
    const mockModulePath = path.join(mockModuleDir, 'index.js');

    try {
        await fs.access(mockModuleDir);
        throw new Error(`Refusing to overwrite existing vscode module at ${mockModuleDir}`);
    } catch (error: any) {
        if (error?.message?.startsWith('Refusing to overwrite existing vscode module')) {
            throw error;
        }
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }

    const vscode: any = {
        __errorMessages: [] as string[],
        __infoMessages: [] as string[],
        __warningMessages: [] as string[],
        __progressReports: [] as any[],
        __openedTargets: [] as any[],
        __revealedRanges: [] as any[],
        __executedCommands: [] as any[],
        __quickPickResult: undefined as any,
        __warningResult: 'Yes' as any,
        __infoResult: undefined as any,
        __inputBoxResult: undefined as any,
        ProgressLocation: {
            Notification: 1
        },
        StatusBarAlignment: {
            Right: 1
        },
        TextEditorRevealType: {
            InCenter: 1
        },
        Disposable: class Disposable {
            private readonly disposer: () => void;

            constructor(disposer?: () => void) {
                this.disposer = disposer || (() => undefined);
            }

            dispose(): void {
                this.disposer();
            }
        },
        Position: class Position {
            line: number;
            character: number;

            constructor(line: number, character: number) {
                this.line = line;
                this.character = character;
            }
        },
        Selection: class Selection {
            start: any;
            end: any;

            constructor(start: any, end: any) {
                this.start = start;
                this.end = end;
            }
        },
        Range: class Range {
            start: any;
            end: any;

            constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
                this.start = { line: startLine, character: startCharacter };
                this.end = { line: endLine, character: endCharacter };
            }
        },
        Uri: {
            file(fsPath: string) {
                return {
                    fsPath,
                    toString() {
                        return fsPath;
                    }
                };
            },
            joinPath(base: { fsPath: string }, ...segments: string[]) {
                const fsPath = path.join(base.fsPath, ...segments);
                return {
                    fsPath,
                    toString() {
                        return fsPath;
                    }
                };
            }
        },
        commands: {
            async executeCommand(...args: any[]) {
                vscode.__executedCommands.push(args);
            }
        },
        workspace: {
            workspaceFolders: [] as any[],
            getConfiguration() {
                return {
                    get(_key: string, defaultValue: any) {
                        return defaultValue;
                    }
                };
            },
            async openTextDocument(target: any) {
                vscode.__openedTargets.push(target);
                return {
                    uri: typeof target === 'string' ? { fsPath: target } : target
                };
            }
        },
        window: {
            async showQuickPick(items: any[]) {
                return vscode.__quickPickResult !== undefined ? vscode.__quickPickResult : items[0];
            },
            showErrorMessage(message: string) {
                vscode.__errorMessages.push(message);
                return undefined;
            },
            async showInformationMessage(message: string, ...actions: any[]) {
                vscode.__infoMessages.push(message);
                if (vscode.__infoResult !== undefined) {
                    return vscode.__infoResult;
                }
                return actions[0];
            },
            async showWarningMessage(message: string, ...actions: any[]) {
                vscode.__warningMessages.push(message);
                if (vscode.__warningResult !== undefined) {
                    return vscode.__warningResult;
                }
                return actions[0];
            },
            async showInputBox() {
                return vscode.__inputBoxResult;
            },
            async withProgress(_options: any, task: (progress: { report: (value: any) => void }) => Promise<any>) {
                return task({
                    report(value: any) {
                        vscode.__progressReports.push(value);
                    }
                });
            },
            async showTextDocument(document: any) {
                const editor = {
                    document,
                    selection: undefined as any,
                    revealRange(range: any) {
                        vscode.__revealedRanges.push(range);
                    }
                };

                return editor;
            }
        }
    };

    (globalThis as any).__CLAUDE_CONTEXT_VSCODE_MOCK__ = vscode;

    await fs.mkdir(mockModuleDir, { recursive: true });
    await fs.writeFile(mockModulePath, 'module.exports = globalThis.__CLAUDE_CONTEXT_VSCODE_MOCK__;\n');
    clearRequireCache('vscode');

    try {
        return await run({
            vscode,
            loadModule: <TModule = any>(modulePath: string): TModule => {
                clearRequireCache(modulePath);
                return repoRequire(modulePath) as TModule;
            }
        });
    } finally {
        clearRequireCache('vscode');
        delete (globalThis as any).__CLAUDE_CONTEXT_VSCODE_MOCK__;
        await fs.rm(mockModuleDir, { recursive: true, force: true });
    }
}

class InMemoryVectorDatabase implements VectorDatabase {
    private readonly collections = new Map<string, Map<string, VectorDocument>>();
    private readonly descriptions = new Map<string, string>();

    async createCollection(collectionName: string, _dimension: number, description?: string): Promise<void> {
        this.collections.set(collectionName, new Map());
        this.descriptions.set(collectionName, description || '');
    }

    async createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        await this.createCollection(collectionName, dimension, description);
    }

    async dropCollection(collectionName: string): Promise<void> {
        this.collections.delete(collectionName);
        this.descriptions.delete(collectionName);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        return this.collections.has(collectionName);
    }

    async listCollections(): Promise<string[]> {
        return Array.from(this.collections.keys());
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        this.insertDocuments(collectionName, documents);
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        this.insertDocuments(collectionName, documents);
    }

    async search(
        _collectionName: string,
        _queryVector: number[],
        _options?: SearchOptions
    ): Promise<VectorSearchResult[]> {
        return [];
    }

    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions
    ): Promise<HybridSearchResult[]> {
        return [];
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        const collection = this.collections.get(collectionName);
        if (!collection) {
            return;
        }

        for (const id of ids) {
            collection.delete(id);
        }
    }

    async query(
        collectionName: string,
        filter: string | undefined,
        outputFields: string[],
        limit?: number
    ): Promise<Record<string, any>[]> {
        const collection = this.collections.get(collectionName);
        if (!collection) {
            return [];
        }

        let documents = Array.from(collection.values());
        const relativePathMatch = filter?.match(/^relativePath == "(.+)"$/);
        if (relativePathMatch) {
            const expectedRelativePath = relativePathMatch[1].replace(/\\\\/g, '\\');
            documents = documents.filter((document) => document.relativePath === expectedRelativePath);
        }

        const rows = documents.map((document) => {
            const row: Record<string, any> = {};
            for (const field of outputFields) {
                row[field] = (document as any)[field];
            }
            return row;
        });

        if (typeof limit === 'number') {
            return rows.slice(0, limit);
        }

        return rows;
    }

    async getCollectionDescription(collectionName: string): Promise<string> {
        return this.descriptions.get(collectionName) || '';
    }

    async checkCollectionLimit(): Promise<boolean> {
        return true;
    }

    private insertDocuments(collectionName: string, documents: VectorDocument[]): void {
        const collection = this.collections.get(collectionName);
        if (!collection) {
            throw new Error(`Collection ${collectionName} does not exist`);
        }

        for (const document of documents) {
            collection.set(document.id, document);
        }
    }
}

function getResponseText(response: any): string {
    return (response?.content || [])
        .map((item: any) => item?.text || '')
        .join('\n');
}

async function waitForFile(filePath: string, timeoutMs: number = 10000): Promise<void> {
    const startedAt = Date.now();

    while (true) {
        try {
            await fs.access(filePath);
            return;
        } catch {
            if ((Date.now() - startedAt) >= timeoutMs) {
                throw new Error(`Timed out waiting for file: ${filePath}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

function spawnSnapshotWorker(command: string, args: string[]): { completion: Promise<void> } {
    const child = spawn(
        'pnpm',
        ['--filter', '@zilliz/claude-context-mcp', 'exec', 'tsx', snapshotWorkerScriptPath, command, ...args],
        {
            cwd: repoRoot,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    const completion = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(
                `snapshot worker '${command}' failed with exit code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
            ));
        });
    });

    return { completion };
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

    await runCheck('workspace migration preserves valid absolute paths from legacy snapshot', async () => {
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
            assert.equal(manager.getCodebaseStatus(outsideCodebaseDir), 'indexed');
        });
    });

    await runCheck('workspace migration canonicalizes absolute legacy paths before persisting', async () => {
        await withSandbox(async ({ homeDir, workspaceDir, codebaseDir }) => {
            const canonicalPath = codebaseDir;
            const aliasedPath = `${workspaceDir}/repo/../repo`;

            await fs.mkdir(path.dirname(getLegacySnapshotPath(homeDir)), { recursive: true });
            await fs.writeFile(getLegacySnapshotPath(homeDir), JSON.stringify({
                formatVersion: 'v2',
                codebases: {
                    [aliasedPath]: {
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

            assert.equal(manager.getCodebaseStatus(canonicalPath), 'indexed');

            const migratedSnapshot = JSON.parse(await fs.readFile(getSnapshotPath(manager), 'utf8'));
            assert.equal(Boolean(migratedSnapshot.codebases[canonicalPath]), true);
            assert.equal(Boolean(migratedSnapshot.codebases[aliasedPath]), false);
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

    await runCheck('delete resurrection is blocked across separate worker processes', async () => {
        await withSandbox(async ({ rootDir, workspaceDir, codebaseDir, outsideCodebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            manager.setCodebaseIndexedWithoutStats(codebaseDir);
            manager.setCodebaseIndexedWithoutStats(outsideCodebaseDir);
            await manager.saveCodebaseSnapshot('seed-multi-process-delete');

            const touchReadyFile = path.join(rootDir, 'touch.ready');
            const touchReleaseFile = path.join(rootDir, 'touch.release');
            const touchResultFile = path.join(rootDir, 'touch.result.json');
            const removeResultFile = path.join(rootDir, 'remove.result.json');

            const touchWorker = spawnSnapshotWorker('load-and-touch-after-signal', [
                workspaceDir,
                outsideCodebaseDir,
                touchReadyFile,
                touchReleaseFile,
                touchResultFile
            ]);

            await waitForFile(touchReadyFile);

            const removeWorker = spawnSnapshotWorker('remove-and-save', [
                workspaceDir,
                codebaseDir,
                removeResultFile
            ]);
            await removeWorker.completion;

            await fs.writeFile(touchReleaseFile, 'release');
            await touchWorker.completion;

            const touchResult = await readJsonFile<{ status: string }>(touchResultFile);
            const removeResult = await readJsonFile<{ status: string }>(removeResultFile);
            const mergedSnapshot = await readJsonFile<CodebaseSnapshotV2>(getSnapshotPath(manager));

            assert.equal(removeResult.status, 'not_found');
            assert.equal(touchResult.status, 'indexed');
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

            const handlers = new ToolHandlers(context as any, manager, createCodebaseConfigManager(workspaceDir));
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

            const handlers = new ToolHandlers(context as any, manager, createCodebaseConfigManager(workspaceDir));
            const response = await handlers.handleSearchCode({ path: codebaseDir, query: 'lost' });

            assert.equal(response.isError, true);
            assert.match(getResponseText(response), /has been lost/);
        });
    });

    await runCheck('force reindex is not blocked by stale indexing state', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-stale-seed' });
            const claimed = await manager.acquireIndexingOwnership(codebaseDir, 42);
            assert.equal(claimed.acquired, true);

            const snapshotPath = getSnapshotPath(manager);
            const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
            snapshot.codebases[codebaseDir].owner.pid = 999999;
            snapshot.codebases[codebaseDir].owner.heartbeatAt = '2020-01-01T00:00:00.000Z';
            snapshot.codebases[codebaseDir].lastUpdated = '2020-01-01T00:00:00.000Z';
            await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

            const restartedManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-stale-seed' });
            restartedManager.loadCodebaseSnapshot();

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
                configureCodebaseSession: () => undefined
            };

            const handlers = new ToolHandlers(context as any, restartedManager, createCodebaseConfigManager(workspaceDir));
            (handlers as any).startBackgroundIndexing = () => undefined;

            const response = await handlers.handleIndexCodebase({ path: codebaseDir, force: true });

            assert.notEqual(response.isError, true);
            assert.match(getResponseText(response), /Started background indexing/);
            assert.equal(restartedManager.getCodebaseStatus(codebaseDir), 'indexing');
        });
    });

    await runCheck('handleIndexCodebase refuses force reindex while another runtime owns live indexing even when cloud index exists', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const ownerManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-owner' });
            const contenderManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-contender' });

            const ownerClaim = await ownerManager.acquireIndexingOwnership(codebaseDir, 12);
            assert.equal(ownerClaim.acquired, true);

            const vectorDb = {
                listCollections: async () => [],
                checkCollectionLimit: async () => true,
                query: async () => [],
                getCollectionDescription: async () => ''
            };
            const context = {
                getVectorDatabase: () => vectorDb,
                hasIndex: async () => true,
                clearIndex: async () => undefined,
                configureCodebaseSession: () => undefined,
                getCollectionName: () => 'stub_collection'
            };

            const handlers = new ToolHandlers(context as any, contenderManager, createCodebaseConfigManager(workspaceDir));
            (handlers as any).startBackgroundIndexing = () => undefined;

            const response = await handlers.handleIndexCodebase({ path: codebaseDir, force: true });

            assert.equal(response.isError, true);
            assert.match(getResponseText(response), /already being indexed by another MCP runtime/);

            const inspection = await ownerManager.inspectIndexingOwnership(codebaseDir);
            assert.equal(inspection.state, 'owned-by-current-runtime');
            assert.equal(inspection.currentOwner?.runtimeId, 'runtime-owner');
        });
    });

    await runCheck('indexing ownership blocks second runtime while owner is live', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const ownerManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-owner' });
            const contenderManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-contender' });

            const ownerClaim = await ownerManager.acquireIndexingOwnership(codebaseDir, 12);
            assert.equal(ownerClaim.acquired, true);

            const contenderClaim = await contenderManager.acquireIndexingOwnership(codebaseDir, 18);
            assert.equal(contenderClaim.acquired, false);
            assert.equal(contenderClaim.reason, 'blocked-live-owner');
            assert.equal(contenderClaim.currentOwner?.runtimeId, 'runtime-owner');
        });
    });

    await runCheck('indexing ownership blocks a second worker process while owner is live', async () => {
        await withSandbox(async ({ rootDir, workspaceDir, codebaseDir }) => {
            const ownerReadyFile = path.join(rootDir, 'owner.ready');
            const ownerReleaseFile = path.join(rootDir, 'owner.release');
            const ownerResultFile = path.join(rootDir, 'owner.result.json');
            const contenderResultFile = path.join(rootDir, 'contender.result.json');

            const ownerWorker = spawnSnapshotWorker('acquire-hold', [
                workspaceDir,
                codebaseDir,
                ownerReadyFile,
                ownerReleaseFile,
                ownerResultFile,
                'worker-owner'
            ]);

            await waitForFile(ownerReadyFile);

            const contenderWorker = spawnSnapshotWorker('acquire-once', [
                workspaceDir,
                codebaseDir,
                contenderResultFile,
                'worker-contender'
            ]);
            await contenderWorker.completion;

            const contenderResult = await readJsonFile<IndexingOwnershipClaimResult>(contenderResultFile);
            assert.equal(contenderResult.acquired, false);
            assert.equal(contenderResult.reason, 'blocked-live-owner');
            assert.equal(contenderResult.currentOwner?.runtimeId, 'worker-owner');

            await fs.writeFile(ownerReleaseFile, 'release');
            await ownerWorker.completion;
        });
    });

    await runCheck('stale indexing ownership can be reclaimed deterministically', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const staleManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-stale-owner' });
            const recoveryManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-recovery' });

            const staleClaim = await staleManager.acquireIndexingOwnership(codebaseDir, 33);
            assert.equal(staleClaim.acquired, true);

            const snapshotPath = getSnapshotPath(staleManager);
            const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
            snapshot.codebases[codebaseDir].owner.pid = 999999;
            snapshot.codebases[codebaseDir].owner.heartbeatAt = '2020-01-01T00:00:00.000Z';
            snapshot.codebases[codebaseDir].lastUpdated = '2020-01-01T00:00:00.000Z';
            await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

            const recoveryClaim = await recoveryManager.acquireIndexingOwnership(codebaseDir, 44);
            assert.equal(recoveryClaim.acquired, true);
            assert.equal(recoveryClaim.reason, 'reclaimed-stale-owner');
            assert.equal(recoveryClaim.currentOwner?.runtimeId, 'runtime-recovery');
        });
    });

    await runCheck('clear_index is blocked while another runtime owns live indexing', async () => {
        await withSandbox(async ({ rootDir, workspaceDir, codebaseDir }) => {
            const ownerReadyFile = path.join(rootDir, 'clear-owner.ready');
            const ownerReleaseFile = path.join(rootDir, 'clear-owner.release');
            const ownerResultFile = path.join(rootDir, 'clear-owner.result.json');

            const ownerWorker = spawnSnapshotWorker('acquire-hold', [
                workspaceDir,
                codebaseDir,
                ownerReadyFile,
                ownerReleaseFile,
                ownerResultFile,
                'worker-owner'
            ]);

            await waitForFile(ownerReadyFile);

            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-clear-attempt' });
            manager.loadCodebaseSnapshot();

            const handlers = new ToolHandlers(
                {
                    hasIndex: async () => false
                } as any,
                manager,
                createCodebaseConfigManager(workspaceDir)
            );

            const response = await handlers.handleClearIndex({ path: codebaseDir });

            assert.equal(response.isError, true);
            assert.match(getResponseText(response), /currently being indexed/);
            assert.match(getResponseText(response), /worker-owner/);
            assert.equal(manager.getCodebaseStatus(codebaseDir), 'indexing');

            await fs.writeFile(ownerReleaseFile, 'release');
            await ownerWorker.completion;
        });
    });

    await runCheck('clear_index removes snapshot-only failed codebase state when no cloud index exists', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-clear-failed' });
            manager.setCodebaseIndexFailed(codebaseDir, 'simulated failure', 0);
            await manager.saveCodebaseSnapshot('seed-clear-failed');

            const configManager = createCodebaseConfigManager(workspaceDir);
            await configManager.saveConfig(codebaseDir, {
                customExtensions: ['.bsl'],
                customIgnorePatterns: ['tmp/**']
            });

            const handlers = new ToolHandlers(
                {
                    hasIndex: async () => false
                } as any,
                manager,
                configManager
            );

            const response = await handlers.handleClearIndex({ path: codebaseDir });

            assert.notEqual(response.isError, true);
            assert.match(getResponseText(response), /Successfully cleared codebase/);
            assert.equal(manager.getCodebaseStatus(codebaseDir), 'not_found');
            assert.equal(await configManager.hasConfig(codebaseDir), false);
        });
    });

    await runCheck('shutdown cleanup marks only current runtime owned indexing jobs as failed', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir, outsideCodebaseDir }) => {
            const currentRuntime = new SnapshotManager({
                workspacePath: workspaceDir,
                saveDebounceMs: 0,
                runtimeId: 'runtime-shutdown-current'
            });
            const otherRuntime = new SnapshotManager({
                workspacePath: workspaceDir,
                saveDebounceMs: 0,
                runtimeId: 'runtime-shutdown-other'
            });

            const currentClaim = await currentRuntime.acquireIndexingOwnership(codebaseDir, 42);
            const otherClaim = await otherRuntime.acquireIndexingOwnership(outsideCodebaseDir, 7);
            assert.equal(currentClaim.acquired, true);
            assert.equal(otherClaim.acquired, true);

            const failedCodebases = await currentRuntime.failCurrentRuntimeOwnedIndexingCodebases('runtime shutdown');

            assert.deepEqual(failedCodebases, [codebaseDir]);

            currentRuntime.loadCodebaseSnapshot();
            otherRuntime.loadCodebaseSnapshot();

            const currentInfo = currentRuntime.getCodebaseInfo(codebaseDir);
            assert.equal(currentInfo?.status, 'indexfailed');
            if (!currentInfo || currentInfo.status !== 'indexfailed') {
                throw new Error('Expected current runtime codebase to be marked as indexfailed.');
            }
            assert.equal(currentInfo.lastAttemptedPercentage, 42);
            assert.match(currentInfo.errorMessage, /runtime shutdown/);

            const otherInfo = otherRuntime.getCodebaseInfo(outsideCodebaseDir);
            assert.equal(otherInfo?.status, 'indexing');
            if (!otherInfo || otherInfo.status !== 'indexing') {
                throw new Error('Expected other runtime codebase to remain in indexing state.');
            }
            assert.equal(otherInfo.indexingPercentage, 7);
        });
    });

    await runCheck('runtime status file records process metadata and known codebases', async () => {
        await withSandbox(async ({ homeDir, workspaceDir, codebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-status' });
            manager.setCodebaseIndexedWithoutStats(codebaseDir);
            await manager.saveCodebaseSnapshot('seed-runtime-status');

            const runtimeStatus = new RuntimeStatusManager({
                runtimeId: manager.getRuntimeId(),
                workspacePath: workspaceDir,
                snapshotManager: manager
            });

            await runtimeStatus.refresh('test-runtime-status');

            const payload = JSON.parse(await fs.readFile(getRuntimeStatusPath(homeDir), 'utf8'));
            assert.equal(payload.runtimeId, 'runtime-status');
            assert.equal(payload.pid, process.pid);
            assert.equal(payload.reason, 'test-runtime-status');
            assert.equal(payload.knownCodebases.length, 1);
            assert.equal(payload.knownCodebases[0].path, codebaseDir);
            assert.equal(payload.knownCodebases[0].info.status, 'indexed');
        });
    });

    await runCheck('runtime status refresh uses collision-safe temp files under concurrent writes', async () => {
        await withSandbox(async ({ homeDir, workspaceDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-status-race' });
            const runtimeStatus = new RuntimeStatusManager({
                runtimeId: manager.getRuntimeId(),
                workspacePath: workspaceDir,
                snapshotManager: manager
            });

            await Promise.all([
                runtimeStatus.refresh('concurrent-a'),
                runtimeStatus.refresh('concurrent-b'),
                runtimeStatus.refresh('concurrent-c')
            ]);

            const payload = JSON.parse(await fs.readFile(getRuntimeStatusPath(homeDir), 'utf8'));
            assert.equal(payload.runtimeId, 'runtime-status-race');
            assert.match(payload.reason, /^concurrent-/);
        });
    });

    await runCheck('daemon runtime config requires explicit allow roots and normalizes daemon options', async () => {
        await withSandbox(async ({ codebaseDir }) => {
            const previousMode = process.env.MCP_RUNTIME_MODE;
            const previousRoots = process.env.MCP_DAEMON_ALLOW_ROOTS;
            const previousToken = process.env.MCP_DAEMON_TOKEN;

            try {
                delete process.env.MCP_RUNTIME_MODE;
                delete process.env.MCP_DAEMON_ALLOW_ROOTS;
                delete process.env.MCP_DAEMON_TOKEN;

                assert.throws(
                    () => createMcpRuntimeConfig(['--mode', 'daemon']),
                    /requires at least one allowed root/
                );

                const runtimeConfig = createMcpRuntimeConfig([
                    '--mode', 'daemon',
                    '--allow-root', `${codebaseDir}/../repo`,
                    '--daemon-token', 'daemon-secret'
                ]);

                assert.equal(runtimeConfig.mode, 'daemon');
                assert.equal(runtimeConfig.daemon?.host, '127.0.0.1');
                assert.equal(runtimeConfig.daemon?.endpointPath, '/mcp');
                assert.deepEqual(runtimeConfig.daemon?.allowRoots, [codebaseDir]);
                assert.equal(runtimeConfig.daemon?.bearerToken, 'daemon-secret');
                assert.equal(runtimeConfig.daemon?.generatedBearerToken, false);
            } finally {
                if (previousMode === undefined) {
                    delete process.env.MCP_RUNTIME_MODE;
                } else {
                    process.env.MCP_RUNTIME_MODE = previousMode;
                }

                if (previousRoots === undefined) {
                    delete process.env.MCP_DAEMON_ALLOW_ROOTS;
                } else {
                    process.env.MCP_DAEMON_ALLOW_ROOTS = previousRoots;
                }

                if (previousToken === undefined) {
                    delete process.env.MCP_DAEMON_TOKEN;
                } else {
                    process.env.MCP_DAEMON_TOKEN = previousToken;
                }
            }
        });
    });

    await runCheck('daemon registry writes endpoint metadata without exposing bearer token', async () => {
        await withSandbox(async ({ homeDir, workspaceDir, codebaseDir }) => {
            const snapshotManager = new SnapshotManager({
                workspacePath: workspaceDir,
                scope: 'daemon',
                saveDebounceMs: 0,
                runtimeId: 'daemon-runtime'
            });
            const runtimeStatusManager = new RuntimeStatusManager({
                runtimeId: 'daemon-runtime',
                workspacePath: workspaceDir,
                snapshotManager,
                mode: 'daemon',
                daemon: {
                    host: '127.0.0.1',
                    port: 39393,
                    endpointPath: '/mcp',
                    allowedRoots: [codebaseDir],
                    tokenSha256: 'sha256-value'
                }
            });

            await runtimeStatusManager.refresh('daemon-registry-test');

            const registryManager = new DaemonRegistryManager({
                runtimeId: 'daemon-runtime',
                host: '127.0.0.1',
                port: 39393,
                endpointPath: '/mcp',
                allowedRoots: [codebaseDir],
                tokenSha256: 'sha256-value',
                runtimeStatusFilePath: runtimeStatusManager.getRuntimeStatusFilePath(),
                snapshotFilePath: snapshotManager.getSnapshotFilePath()
            });

            await registryManager.refresh();

            const registryPayload = await readJsonFile<any>(registryManager.getRegistryFilePath());
            assert.equal(registryPayload.transport, 'streamable-http');
            assert.equal(registryPayload.endpointUrl, 'http://127.0.0.1:39393/mcp');
            assert.equal(registryPayload.auth.tokenSha256, 'sha256-value');
            assert.deepEqual(registryPayload.allowedRoots, [codebaseDir]);
            assert.equal(JSON.stringify(registryPayload).includes('daemon-secret'), false);

            await registryManager.remove();
            await assert.rejects(fs.access(registryManager.getRegistryFilePath()));
            assert.equal(path.dirname(registryManager.getRegistryFilePath()), path.join(homeDir, '.context', 'mcp', 'daemon', 'registry'));
        });
    });

    await runCheck('daemon storage scope uses dedicated snapshot and per-codebase config paths', async () => {
        await withSandbox(async ({ homeDir, workspaceDir, codebaseDir }) => {
            const snapshotManager = new SnapshotManager({
                workspacePath: workspaceDir,
                scope: 'daemon',
                saveDebounceMs: 0
            });
            snapshotManager.setCodebaseIndexedWithoutStats(codebaseDir);
            await snapshotManager.saveCodebaseSnapshot('daemon-scope-seed');

            const configManager = createDaemonCodebaseConfigManager(workspaceDir);
            await configManager.saveConfig(codebaseDir, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['docs/**']
            });

            assert.equal(
                snapshotManager.getSnapshotFilePath(),
                path.join(homeDir, '.context', 'mcp', 'daemon', 'mcp-codebase-snapshot.json')
            );

            const daemonConfigDir = path.join(homeDir, '.context', 'mcp', 'daemon', 'codebase-session-config');
            const configEntries = await fs.readdir(daemonConfigDir);
            assert.equal(configEntries.length, 1);
        });
    });

    await runCheck('daemon path allowlist rejects out-of-scope tool requests fail-closed', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir, outsideCodebaseDir }) => {
            const manager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const handlers = new ToolHandlers(
                {
                    hasIndex: async () => false
                } as any,
                manager,
                createCodebaseConfigManager(workspaceDir),
                undefined,
                new CodebaseAccessPolicy({
                    mode: 'daemon',
                    allowedRoots: [codebaseDir]
                })
            );

            const response = await handlers.handleGetIndexingStatus({ path: outsideCodebaseDir });

            assert.equal(response.isError, true);
            assert.match(getResponseText(response), /outside the configured daemon allowlist/);
            assert.match(getResponseText(response), new RegExp(codebaseDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        });
    });

    await runCheck('WorkloadManager queues indexing jobs with interactive priority ahead of background sync', async () => {
        const workloadManager = new WorkloadManager({
            mode: 'daemon',
            maxIndexingConcurrency: 1,
            maxSearchConcurrency: 2
        });

        let releaseFirst!: () => void;
        const firstCompletion = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const executionOrder: string[] = [];
        const firstTask = workloadManager.enqueueInteractiveIndexing('/repo/first', async () => {
            executionOrder.push('first-start');
            await firstCompletion;
            executionOrder.push('first-finish');
        });

        const backgroundSync = workloadManager.runBackgroundSync('/repo/sync', async () => {
            executionOrder.push('sync-run');
        });
        const interactiveQueued = workloadManager.enqueueInteractiveIndexing('/repo/interactive', async () => {
            executionOrder.push('interactive-run');
        });

        assert.equal(firstTask.startedImmediately, true);
        assert.equal(interactiveQueued.startedImmediately, false);
        assert.equal(interactiveQueued.queuePosition, 1);

        const queuedBeforeRelease = workloadManager.getSnapshot().indexing.queuedJobs.map((job) => job.type);
        assert.deepEqual(queuedBeforeRelease, ['interactive-index', 'background-sync']);

        releaseFirst();
        await firstTask.completion;
        await interactiveQueued.completion;
        await backgroundSync;

        assert.deepEqual(executionOrder, ['first-start', 'first-finish', 'interactive-run', 'sync-run']);
    });

    await runCheck('WorkloadManager boosts background sync priority for recently interactive repositories', async () => {
        const workloadManager = new WorkloadManager({
            mode: 'daemon',
            maxIndexingConcurrency: 1,
            maxSearchConcurrency: 2,
            interactivePriorityWindowMs: 60_000,
            interactiveRepoPriorityBoost: 40
        });

        let releaseFirst!: () => void;
        const firstCompletion = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const executionOrder: string[] = [];
        const firstTask = workloadManager.enqueueInteractiveIndexing('/repo/blocker', async () => {
            executionOrder.push('blocker-start');
            await firstCompletion;
            executionOrder.push('blocker-finish');
        });

        await workloadManager.runSearch('/repo/hot', async () => undefined);

        const coldBackground = workloadManager.runBackgroundSync('/repo/cold', async () => {
            executionOrder.push('cold-sync');
        });
        const hotBackground = workloadManager.runBackgroundSync('/repo/hot', async () => {
            executionOrder.push('hot-sync');
        });

        const queuedBeforeRelease = workloadManager.getSnapshot().indexing.queuedJobs.map((job) => ({
            codebasePath: job.codebasePath,
            priority: job.priority
        }));
        assert.deepEqual(queuedBeforeRelease, [
            { codebasePath: '/repo/hot', priority: 60 },
            { codebasePath: '/repo/cold', priority: 100 }
        ]);

        releaseFirst();
        await firstTask.completion;
        await hotBackground;
        await coldBackground;

        assert.deepEqual(executionOrder, ['blocker-start', 'blocker-finish', 'hot-sync', 'cold-sync']);
    });

    await runCheck('WorkloadManager backs off flaky background sync repositories instead of immediate retry', async () => {
        const workloadManager = new WorkloadManager({
            mode: 'daemon',
            maxIndexingConcurrency: 1,
            maxSearchConcurrency: 2,
            backgroundSyncBaseBackoffMs: 50,
            backgroundSyncMaxBackoffMs: 50
        });

        await assert.rejects(
            workloadManager.runBackgroundSync('/repo/flaky', async () => {
                throw new Error('expected background sync failure');
            }),
            /expected background sync failure/
        );

        const executionOrder: string[] = [];
        let releaseHealthy!: () => void;
        const healthyGate = new Promise<void>((resolve) => {
            releaseHealthy = resolve;
        });
        const flakyRetry = workloadManager.runBackgroundSync('/repo/flaky', async () => {
            executionOrder.push('flaky-retry');
        });
        const healthySync = workloadManager.runBackgroundSync('/repo/healthy', async () => {
            executionOrder.push('healthy-sync');
            await healthyGate;
        });

        await flushAsyncWork();

        const queuedJobs = workloadManager.getSnapshot().indexing.queuedJobs;
        assert.equal(workloadManager.getSnapshot().indexing.activeJobs[0]?.codebasePath, '/repo/healthy');
        assert.equal(queuedJobs.length, 1);
        assert.equal(queuedJobs[0].codebasePath, '/repo/flaky');
        assert.ok(typeof queuedJobs[0].readyAt === 'string');

        releaseHealthy();
        await healthySync;
        await flakyRetry;

        assert.deepEqual(executionOrder, ['healthy-sync', 'flaky-retry']);
    });

    await runCheck('WorkloadManager enforces bounded search concurrency', async () => {
        const workloadManager = new WorkloadManager({
            mode: 'daemon',
            maxIndexingConcurrency: 1,
            maxSearchConcurrency: 1
        });

        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        let concurrentSearches = 0;
        let maxConcurrentSearches = 0;
        const searchEvents: string[] = [];

        const firstSearch = workloadManager.runSearch('/repo/a', async () => {
            concurrentSearches += 1;
            maxConcurrentSearches = Math.max(maxConcurrentSearches, concurrentSearches);
            searchEvents.push('search-1-start');
            await firstGate;
            searchEvents.push('search-1-finish');
            concurrentSearches -= 1;
        });

        const secondSearch = workloadManager.runSearch('/repo/b', async () => {
            concurrentSearches += 1;
            maxConcurrentSearches = Math.max(maxConcurrentSearches, concurrentSearches);
            searchEvents.push('search-2-start');
            concurrentSearches -= 1;
        });

        await flushAsyncWork();
        assert.equal(workloadManager.getSnapshot().search.activeCount, 1);
        assert.equal(workloadManager.getSnapshot().search.queuedCount, 1);

        releaseFirst();
        await firstSearch;
        await secondSearch;

        assert.equal(maxConcurrentSearches, 1);
        assert.deepEqual(searchEvents, ['search-1-start', 'search-1-finish', 'search-2-start']);
    });

    await runCheck('daemon index_codebase returns queued response when indexing lane is busy', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir, outsideCodebaseDir }) => {
            const snapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0, runtimeId: 'runtime-daemon-queue' });
            const workloadManager = new WorkloadManager({
                mode: 'daemon',
                maxIndexingConcurrency: 1,
                maxSearchConcurrency: 2
            });

            let releaseExisting!: () => void;
            const existingGate = new Promise<void>((resolve) => {
                releaseExisting = resolve;
            });
            const existingTask = workloadManager.enqueueInteractiveIndexing(codebaseDir, async () => {
                await existingGate;
            });

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
                configureCodebaseSession: () => undefined
            };

            const handlers = new ToolHandlers(
                context as any,
                snapshotManager,
                createCodebaseConfigManager(workspaceDir),
                undefined,
                new CodebaseAccessPolicy({
                    mode: 'daemon',
                    allowedRoots: [codebaseDir, outsideCodebaseDir]
                }),
                workloadManager
            );
            (handlers as any).startBackgroundIndexing = async () => undefined;

            const response = await handlers.handleIndexCodebase({ path: outsideCodebaseDir, force: true });

            assert.notEqual(response.isError, true);
            assert.match(getResponseText(response), /queued at position 1/);
            assert.equal(snapshotManager.getCodebaseStatus(outsideCodebaseDir), 'indexing');

            releaseExisting();
            await existingTask.completion;
        });
    });

    await runCheck('Context keeps per-codebase session config isolated', async () => {
        await withSandbox(async ({ codebaseDir, outsideCodebaseDir }) => {
            const context = new Context({
                embedding: {
                    getProvider: () => 'stub',
                    getDimension: () => 1
                } as any,
                vectorDatabase: {
                    hasCollection: async () => false
                } as any
            });

            context.configureCodebaseSession(codebaseDir, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['alpha/**']
            });
            context.configureCodebaseSession(outsideCodebaseDir, {
                customExtensions: ['.astro'],
                customIgnorePatterns: ['beta/**']
            });

            assert.equal(context.getSupportedExtensions(codebaseDir).includes('.vue'), true);
            assert.equal(context.getSupportedExtensions(codebaseDir).includes('.astro'), false);
            assert.equal(context.getSupportedExtensions(outsideCodebaseDir).includes('.astro'), true);
            assert.equal(context.getSupportedExtensions(outsideCodebaseDir).includes('.vue'), false);

            assert.equal(context.getIgnorePatterns(codebaseDir).includes('alpha/**'), true);
            assert.equal(context.getIgnorePatterns(codebaseDir).includes('beta/**'), false);
            assert.equal(context.getIgnorePatterns(outsideCodebaseDir).includes('beta/**'), true);
            assert.equal(context.getIgnorePatterns(outsideCodebaseDir).includes('alpha/**'), false);

            assert.equal(context.getSupportedExtensions().includes('.vue'), false);
            assert.equal(context.getIgnorePatterns().includes('alpha/**'), false);
        });
    });

    await runCheck('OllamaEmbedding splits overflowing batch requests and preserves input order', async () => {
        const embedding = new OllamaEmbedding({
            model: 'nomic-embed-text'
        });

        (embedding as any).dimensionDetected = true;
        (embedding as any).dimension = 3;
        (embedding as any).client = {
            embed: async ({ input }: { input: string | string[] }) => {
                if (Array.isArray(input) && input.length > 1) {
                    throw new Error('input length exceeds the context length');
                }

                const items = Array.isArray(input) ? input : [input];
                return {
                    embeddings: items.map((item) => [item.length, item.length + 1, item.length + 2])
                };
            }
        };

        const result = await embedding.embedBatch(['aa', 'bbbb']);

        assert.deepEqual(result.map((item) => item.vector), [
            [2, 3, 4],
            [4, 5, 6]
        ]);
    });

    await runCheck('Context rethrows fatal embedding context-limit errors instead of silently dropping batches', async () => {
        await withSandbox(async ({ codebaseDir }) => {
            const filePath = path.join(codebaseDir, 'fatal-batch.ts');
            await fs.writeFile(filePath, 'export const fatalBatch = true;\n');

            const fatalError = new Error('embedding context limit exceeded');
            (fatalError as Error & { code?: string }).code = 'EMBEDDING_CONTEXT_LIMIT_EXCEEDED';

            const context = new Context({
                embedding: {
                    getProvider: () => 'stub',
                    getDimension: () => 1,
                    embedBatch: async () => {
                        throw fatalError;
                    }
                } as any,
                vectorDatabase: {
                    insert: async () => undefined,
                    insertHybrid: async () => undefined,
                    hasCollection: async () => true
                } as any,
                codeSplitter: {
                    split: async (_content: string, _language: string, resolvedFilePath: string) => [{
                        content: 'chunk',
                        metadata: {
                            filePath: resolvedFilePath,
                            startLine: 1,
                            endLine: 1,
                            language: 'typescript'
                        }
                    }]
                } as any
            });

            await assert.rejects(
                () => (context as any).processFileList([filePath], codebaseDir),
                /embedding context limit exceeded/
            );
        });
    });

    await runCheck('CodebaseConfigManager persists and removes per-codebase config', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const configManager = createCodebaseConfigManager(workspaceDir);

            await configManager.saveConfig(codebaseDir, {
                customExtensions: ['vue'],
                customIgnorePatterns: ['alpha/**']
            });

            const restored = await configManager.getConfig(codebaseDir);
            assert.deepEqual(restored, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['alpha/**']
            });

            await configManager.removeConfig(codebaseDir);
            assert.equal(await configManager.hasConfig(codebaseDir), false);
        });
    });

    await runCheck('SyncManager skips indexed codebase when persisted session config is missing', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const snapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const configManager = createCodebaseConfigManager(workspaceDir);
            snapshotManager.setCodebaseIndexedWithoutStats(codebaseDir);
            await snapshotManager.saveCodebaseSnapshot('seed-sync-missing-config');

            let configureCalls = 0;
            let reindexCalls = 0;
            const context = {
                hasIndex: async () => false,
                configureCodebaseSession: () => {
                    configureCalls += 1;
                },
                getLoadedIgnorePatterns: async () => undefined,
                reindexByChange: async () => {
                    reindexCalls += 1;
                    return { added: 0, removed: 0, modified: 0 };
                }
            };

            const syncManager = new SyncManager(context as any, snapshotManager, configManager);
            await syncManager.handleSyncIndex();

            assert.equal(configureCalls, 0);
            assert.equal(reindexCalls, 0);
        });
    });

    await runCheck('SyncManager restores persisted per-codebase config before incremental sync', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const snapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const configManager = createCodebaseConfigManager(workspaceDir);
            snapshotManager.setCodebaseIndexedWithoutStats(codebaseDir);
            await snapshotManager.saveCodebaseSnapshot('seed-sync-restored-config');
            await configManager.saveConfig(codebaseDir, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['alpha/**']
            });

            let configuredPath: string | undefined;
            let configuredConfig: any;
            let loadedIgnorePath: string | undefined;
            let reindexCalls = 0;

            const context = {
                hasIndex: async () => false,
                configureCodebaseSession: (codebasePath: string, config: unknown) => {
                    configuredPath = codebasePath;
                    configuredConfig = config;
                },
                getLoadedIgnorePatterns: async (codebasePath: string) => {
                    loadedIgnorePath = codebasePath;
                },
                reindexByChange: async (codebasePath: string) => {
                    reindexCalls += 1;
                    assert.equal(codebasePath, codebaseDir);
                    return { added: 1, removed: 0, modified: 0 };
                }
            };

            const syncManager = new SyncManager(context as any, snapshotManager, configManager);
            await syncManager.handleSyncIndex();

            assert.equal(configuredPath, codebaseDir);
            assert.deepEqual(configuredConfig, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['alpha/**']
            });
            assert.equal(loadedIgnorePath, codebaseDir);
            assert.equal(reindexCalls, 1);
        });
    });

    await runCheck('SyncManager self-heals snapshot from persisted config and cloud index before syncing', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const snapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const configManager = createCodebaseConfigManager(workspaceDir);
            await configManager.saveConfig(codebaseDir, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['alpha/**']
            });

            let configureCalls = 0;
            let reindexCalls = 0;
            const context = {
                hasIndex: async (candidatePath: string) => candidatePath === codebaseDir,
                configureCodebaseSession: () => {
                    configureCalls += 1;
                },
                getLoadedIgnorePatterns: async () => undefined,
                reindexByChange: async () => {
                    reindexCalls += 1;
                    return { added: 0, removed: 0, modified: 0 };
                }
            };

            const syncManager = new SyncManager(context as any, snapshotManager, configManager);
            await syncManager.handleSyncIndex();

            assert.equal(snapshotManager.getCodebaseStatus(codebaseDir), 'indexed');
            assert.equal(configureCalls, 1);
            assert.equal(reindexCalls, 1);
        });
    });

    await runCheck('SyncManager does not self-heal over active local indexing state', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const snapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            const configManager = createCodebaseConfigManager(workspaceDir);
            await configManager.saveConfig(codebaseDir, {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['alpha/**']
            });

            const ownership = await snapshotManager.acquireIndexingOwnership(codebaseDir, 12);
            assert.equal(ownership.acquired, true);
            await snapshotManager.saveCodebaseSnapshot('seed-active-indexing-self-heal-guard');

            let configureCalls = 0;
            let reindexCalls = 0;
            const context = {
                hasIndex: async (candidatePath: string) => candidatePath === codebaseDir,
                configureCodebaseSession: () => {
                    configureCalls += 1;
                },
                getLoadedIgnorePatterns: async () => undefined,
                reindexByChange: async () => {
                    reindexCalls += 1;
                    return { added: 0, removed: 0, modified: 0 };
                }
            };

            const syncManager = new SyncManager(context as any, snapshotManager, configManager);
            await syncManager.handleSyncIndex();

            assert.equal(snapshotManager.getCodebaseStatus(codebaseDir), 'indexing');
            assert.equal(snapshotManager.getIndexedCodebases().length, 0);
            assert.equal(configureCalls, 0);
            assert.equal(reindexCalls, 0);
        });
    });

    await runCheck('SyncManager restores persisted custom extensions and ignore patterns across restart', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const vectorDatabase = new InMemoryVectorDatabase();
            const configManager = createCodebaseConfigManager(workspaceDir);
            const persistedConfig = {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['ignored/**']
            };
            const createTestContext = () => new Context({
                embedding: {
                    getProvider: () => 'stub',
                    detectDimension: async () => 3,
                    embedBatch: async (texts: string[]) => texts.map(() => ({ vector: [1, 2, 3] }))
                } as any,
                vectorDatabase,
                codeSplitter: {
                    split: async (content: string, language: string, filePath?: string) => [{
                        content,
                        metadata: {
                            filePath,
                            language,
                            startLine: 1,
                            endLine: content.split('\n').length
                        }
                    }]
                } as any
            });

            const mainPath = path.join(codebaseDir, 'src', 'main.ts');
            const cardPath = path.join(codebaseDir, 'components', 'card.vue');
            const ignoredSeedPath = path.join(codebaseDir, 'ignored', 'seed.vue');
            await fs.mkdir(path.dirname(mainPath), { recursive: true });
            await fs.mkdir(path.dirname(cardPath), { recursive: true });
            await fs.mkdir(path.dirname(ignoredSeedPath), { recursive: true });
            await fs.writeFile(mainPath, 'export const main = true;\n');
            await fs.writeFile(cardPath, '<template>seed-card</template>\n');
            await fs.writeFile(ignoredSeedPath, '<template>ignored-seed</template>\n');

            const initialContext = createTestContext();
            initialContext.configureCodebaseSession(codebaseDir, persistedConfig);
            await configManager.saveConfig(codebaseDir, persistedConfig);

            const initialSynchronizer = new FileSynchronizer(codebaseDir, initialContext.getIgnorePatterns(codebaseDir));
            await initialSynchronizer.initialize();
            initialContext.setSynchronizerForCodebase(codebaseDir, initialSynchronizer);

            const initialIndexStats = await initialContext.indexCodebase(codebaseDir);
            assert.equal(initialIndexStats.indexedFiles, 2);

            const collectionName = initialContext.getCollectionName(codebaseDir);
            assert.equal((await vectorDatabase.query(collectionName, 'relativePath == "src/main.ts"', ['content'])).length, 1);
            assert.equal((await vectorDatabase.query(collectionName, 'relativePath == "components/card.vue"', ['content'])).length, 1);
            assert.equal((await vectorDatabase.query(collectionName, 'relativePath == "ignored/seed.vue"', ['content'])).length, 0);

            const snapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            snapshotManager.setCodebaseIndexedWithoutStats(codebaseDir);
            await snapshotManager.saveCodebaseSnapshot('seed-restart-safe-config');

            await fs.writeFile(cardPath, '<template>updated-card</template>\n');
            await fs.writeFile(path.join(codebaseDir, 'components', 'widget.vue'), '<template>widget</template>\n');
            await fs.writeFile(path.join(codebaseDir, 'ignored', 'new.vue'), '<template>ignored-new</template>\n');

            const restartedSnapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            restartedSnapshotManager.loadCodebaseSnapshot();

            const restartedContext = createTestContext();
            assert.equal(restartedContext.getCodebaseSessionConfig(codebaseDir), undefined);

            const syncManager = new SyncManager(restartedContext, restartedSnapshotManager, configManager);
            await syncManager.handleSyncIndex();

            assert.deepEqual(restartedContext.getCodebaseSessionConfig(codebaseDir), persistedConfig);

            const updatedCardRows = await vectorDatabase.query(collectionName, 'relativePath == "components/card.vue"', ['content']);
            const widgetRows = await vectorDatabase.query(collectionName, 'relativePath == "components/widget.vue"', ['content']);
            const ignoredRows = await vectorDatabase.query(collectionName, 'relativePath == "ignored/new.vue"', ['content']);

            assert.equal(updatedCardRows.length, 1);
            assert.match(updatedCardRows[0].content, /updated-card/);
            assert.equal(widgetRows.length, 1);
            assert.match(widgetRows[0].content, /widget/);
            assert.equal(ignoredRows.length, 0);
        });
    });

    await runCheck('SyncManager self-heals from corrupted snapshot and still restores persisted sync semantics', async () => {
        await withSandbox(async ({ workspaceDir, codebaseDir }) => {
            const vectorDatabase = new InMemoryVectorDatabase();
            const configManager = createCodebaseConfigManager(workspaceDir);
            const persistedConfig = {
                customExtensions: ['.vue'],
                customIgnorePatterns: ['ignored/**']
            };
            const createTestContext = () => new Context({
                embedding: {
                    getProvider: () => 'stub',
                    detectDimension: async () => 3,
                    embedBatch: async (texts: string[]) => texts.map(() => ({ vector: [1, 2, 3] }))
                } as any,
                vectorDatabase,
                codeSplitter: {
                    split: async (content: string, language: string, filePath?: string) => [{
                        content,
                        metadata: {
                            filePath,
                            language,
                            startLine: 1,
                            endLine: content.split('\n').length
                        }
                    }]
                } as any
            });

            const mainPath = path.join(codebaseDir, 'src', 'main.ts');
            const cardPath = path.join(codebaseDir, 'components', 'card.vue');
            const ignoredSeedPath = path.join(codebaseDir, 'ignored', 'seed.vue');
            await fs.mkdir(path.dirname(mainPath), { recursive: true });
            await fs.mkdir(path.dirname(cardPath), { recursive: true });
            await fs.mkdir(path.dirname(ignoredSeedPath), { recursive: true });
            await fs.writeFile(mainPath, 'export const main = true;\n');
            await fs.writeFile(cardPath, '<template>seed-card</template>\n');
            await fs.writeFile(ignoredSeedPath, '<template>ignored-seed</template>\n');

            const initialContext = createTestContext();
            initialContext.configureCodebaseSession(codebaseDir, persistedConfig);
            await configManager.saveConfig(codebaseDir, persistedConfig);

            const initialSynchronizer = new FileSynchronizer(codebaseDir, initialContext.getIgnorePatterns(codebaseDir));
            await initialSynchronizer.initialize();
            initialContext.setSynchronizerForCodebase(codebaseDir, initialSynchronizer);
            await initialContext.indexCodebase(codebaseDir);

            const collectionName = initialContext.getCollectionName(codebaseDir);
            const seededSnapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            seededSnapshotManager.setCodebaseIndexedWithoutStats(codebaseDir);
            await seededSnapshotManager.saveCodebaseSnapshot('seed-self-heal-corrupt-snapshot');

            const snapshotPath = getSnapshotPath(seededSnapshotManager);
            await fs.writeFile(snapshotPath, '{corrupted-json');

            await fs.writeFile(cardPath, '<template>recovered-card</template>\n');
            await fs.writeFile(path.join(codebaseDir, 'components', 'healed.vue'), '<template>healed</template>\n');
            await fs.writeFile(path.join(codebaseDir, 'ignored', 'new.vue'), '<template>ignored-new</template>\n');

            const restartedSnapshotManager = new SnapshotManager({ workspacePath: workspaceDir, saveDebounceMs: 0 });
            restartedSnapshotManager.loadCodebaseSnapshot();
            assert.equal(restartedSnapshotManager.getIndexedCodebases().length, 0);

            const restartedContext = createTestContext();
            const syncManager = new SyncManager(restartedContext, restartedSnapshotManager, configManager);
            await syncManager.handleSyncIndex();

            assert.equal(restartedSnapshotManager.getCodebaseStatus(codebaseDir), 'indexed');
            assert.deepEqual(restartedContext.getCodebaseSessionConfig(codebaseDir), persistedConfig);

            const updatedCardRows = await vectorDatabase.query(collectionName, 'relativePath == "components/card.vue"', ['content']);
            const healedRows = await vectorDatabase.query(collectionName, 'relativePath == "components/healed.vue"', ['content']);
            const ignoredRows = await vectorDatabase.query(collectionName, 'relativePath == "ignored/new.vue"', ['content']);

            assert.equal(updatedCardRows.length, 1);
            assert.match(updatedCardRows[0].content, /recovered-card/);
            assert.equal(healedRows.length, 1);
            assert.match(healedRows[0].content, /healed/);
            assert.equal(ignoredRows.length, 0);
        });
    });

    await runCheck('Context incremental sync handles add, modify, and delete with isolated codebase session state', async () => {
        await withSandbox(async ({ codebaseDir }) => {
            const vectorDatabase = new InMemoryVectorDatabase();
            const context = new Context({
                embedding: {
                    getProvider: () => 'stub',
                    detectDimension: async () => 3,
                    embedBatch: async (texts: string[]) => texts.map(() => ({ vector: [1, 2, 3] }))
                } as any,
                vectorDatabase,
                codeSplitter: {
                    split: async (content: string, language: string, filePath?: string) => [{
                        content,
                        metadata: {
                            filePath,
                            language,
                            startLine: 1,
                            endLine: content.split('\n').length
                        }
                    }]
                } as any
            });

            const alphaPath = path.join(codebaseDir, 'alpha.ts');
            const betaPath = path.join(codebaseDir, 'beta.ts');

            await fs.writeFile(alphaPath, 'export const alpha = 1;\n');

            const synchronizer = new FileSynchronizer(codebaseDir, context.getIgnorePatterns(codebaseDir));
            await synchronizer.initialize();
            context.setSynchronizerForCodebase(codebaseDir, synchronizer);

            const initialIndexStats = await context.indexCodebase(codebaseDir);
            assert.equal(initialIndexStats.indexedFiles, 1);

            const collectionName = context.getCollectionName(codebaseDir);
            const initialAlphaRows = await vectorDatabase.query(collectionName, 'relativePath == "alpha.ts"', ['content']);
            assert.equal(initialAlphaRows.length, 1);
            assert.match(initialAlphaRows[0].content, /alpha = 1/);

            await fs.writeFile(alphaPath, 'export const alpha = 2;\n');
            await fs.writeFile(betaPath, 'export const beta = alpha + 1;\n');

            const modifyAndAddStats = await context.reindexByChange(codebaseDir);
            assert.deepEqual(modifyAndAddStats, { added: 1, removed: 0, modified: 1 });

            const updatedAlphaRows = await vectorDatabase.query(collectionName, 'relativePath == "alpha.ts"', ['content']);
            const betaRows = await vectorDatabase.query(collectionName, 'relativePath == "beta.ts"', ['content']);
            assert.equal(updatedAlphaRows.length, 1);
            assert.match(updatedAlphaRows[0].content, /alpha = 2/);
            assert.equal(betaRows.length, 1);
            assert.match(betaRows[0].content, /beta = alpha \+ 1/);

            await fs.unlink(alphaPath);

            const deleteStats = await context.reindexByChange(codebaseDir);
            assert.deepEqual(deleteStats, { added: 0, removed: 1, modified: 0 });

            const removedAlphaRows = await vectorDatabase.query(collectionName, 'relativePath == "alpha.ts"', ['content']);
            const remainingBetaRows = await vectorDatabase.query(collectionName, 'relativePath == "beta.ts"', ['content']);
            assert.equal(removedAlphaRows.length, 0);
            assert.equal(remainingBetaRows.length, 1);
        });
    });

    await runCheck('VS Code multi-root flows target the persisted indexed codebase', async () => {
        await withSandbox(async ({ codebaseDir, outsideCodebaseDir }) => {
            await withMockedVscode(async ({ vscode, loadModule }) => {
                const extensionContext = createExtensionContext();
                const primaryFolder = createWorkspaceFolder(codebaseDir, 'alpha');
                const indexedFolder = createWorkspaceFolder(outsideCodebaseDir, 'beta');

                vscode.workspace.workspaceFolders = [primaryFolder, indexedFolder];

                const { CodebaseTargetManager } = loadModule('/home/egor/code/claude-context/packages/vscode-extension/src/codebaseTargetManager.ts');
                const { SearchCommand } = loadModule('/home/egor/code/claude-context/packages/vscode-extension/src/commands/searchCommand.ts');
                const { SyncCommand } = loadModule('/home/egor/code/claude-context/packages/vscode-extension/src/commands/syncCommand.ts');
                const { IndexCommand } = loadModule('/home/egor/code/claude-context/packages/vscode-extension/src/commands/indexCommand.ts');
                const { SemanticSearchViewProvider } = loadModule('/home/egor/code/claude-context/packages/vscode-extension/src/webview/semanticSearchProvider.ts');

                const targetManager = new CodebaseTargetManager(extensionContext as any);
                await targetManager.setIndexedCodebasePath(outsideCodebaseDir);

                assert.equal(await targetManager.resolveIndexedCodebasePath(), outsideCodebaseDir);

                let searchedCodebasePath: string | undefined;
                let searchedHasIndexPath: string | undefined;
                const searchCommand = new SearchCommand({
                    hasIndex: async (candidatePath: string) => {
                        searchedHasIndexPath = candidatePath;
                        return candidatePath === outsideCodebaseDir;
                    },
                    semanticSearch: async (candidatePath: string) => {
                        searchedCodebasePath = candidatePath;
                        return [];
                    }
                } as any, targetManager);

                await searchCommand.executeForWebview('query', 5, []);
                assert.equal(searchedHasIndexPath, outsideCodebaseDir);
                assert.equal(searchedCodebasePath, outsideCodebaseDir);

                let syncedCodebasePath: string | undefined;
                const syncCommand = new SyncCommand({
                    reindexByChange: async (candidatePath: string) => {
                        syncedCodebasePath = candidatePath;
                        return { added: 0, removed: 0, modified: 0 };
                    }
                } as any, targetManager);

                await syncCommand.executeSilent();
                assert.equal(syncedCodebasePath, outsideCodebaseDir);

                let clearedCodebasePath: string | undefined;
                const indexCommand = new IndexCommand({
                    clearIndex: async (candidatePath: string, progress?: (value: any) => void) => {
                        clearedCodebasePath = candidatePath;
                        progress?.({
                            phase: 'done',
                            current: 100,
                            total: 100,
                            percentage: 100
                        });
                    }
                } as any, targetManager);

                vscode.__warningResult = 'Yes';
                await indexCommand.clearIndex();
                assert.equal(clearedCodebasePath, outsideCodebaseDir);
                assert.equal(targetManager.getIndexedCodebasePath(), undefined);

                await targetManager.setIndexedCodebasePath(outsideCodebaseDir);

                const postedMessages: any[] = [];
                let receivedMessageHandler: ((message: any) => Promise<void>) | undefined;

                const provider = new SemanticSearchViewProvider(
                    { fsPath: path.join(repoRoot, 'packages', 'vscode-extension') } as any,
                    {
                        hasIndex: async (candidatePath: string) => candidatePath === outsideCodebaseDir,
                        executeForWebview: async () => ({ codebasePath: outsideCodebaseDir, results: [] })
                    } as any,
                    {
                        execute: async () => undefined
                    } as any,
                    syncCommand as any,
                    {
                        getEmbeddingProviderConfig: () => undefined,
                        getMilvusConfig: () => undefined,
                        getSplitterConfig: () => undefined
                    } as any,
                    targetManager
                );

                const webview = {
                    options: undefined as any,
                    html: '',
                    asWebviewUri(uri: { fsPath: string }) {
                        return {
                            toString() {
                                return uri.fsPath;
                            }
                        };
                    },
                    postMessage(message: any) {
                        postedMessages.push(message);
                        return Promise.resolve(true);
                    },
                    onDidReceiveMessage(handler: (message: any) => Promise<void>) {
                        receivedMessageHandler = handler;
                        return { dispose() {} };
                    }
                };

                provider.resolveWebviewView({ webview } as any, {} as any, {} as any);
                await flushAsyncWork();

                assert.equal(
                    postedMessages.some((message) =>
                        message.command === 'updateIndexStatus'
                        && message.hasIndex === true
                        && message.codebasePath === outsideCodebaseDir
                    ),
                    true
                );

                assert.ok(receivedMessageHandler);
                await receivedMessageHandler!({
                    command: 'openFile',
                    relativePath: 'src/target.ts',
                    startLine: 4,
                    endLine: 6
                });

                const openedTarget = vscode.__openedTargets.at(-1);
                assert.equal(openedTarget.fsPath, path.join(outsideCodebaseDir, 'src', 'target.ts'));
            });
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
