#!/usr/bin/env node

// CRITICAL: Redirect console outputs to stderr IMMEDIATELY to avoid interfering with MCP JSON protocol
// Only MCP protocol messages should go to stdout
console.log = (...args: unknown[]) => {
    process.stderr.write('[LOG] ' + args.join(' ') + '\n');
};

console.warn = (...args: unknown[]) => {
    process.stderr.write('[WARN] ' + args.join(' ') + '\n');
};

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { Context, LanceDbVectorDatabase, MilvusVectorDatabase, QdrantVectorDatabase } from '@zilliz/claude-context-core';

import { CodebaseAccessPolicy } from './access-policy.js';
import {
    createManagedBgeM3WorkerManager,
    ManagedBgeM3WorkerManager
} from './bge-m3-managed-workers.js';
import { CodebaseConfigManager } from './codebase-config.js';
import {
    createMcpConfig,
    createMcpRuntimeConfig,
    ContextMcpConfig,
    logAcceleratorConfiguration,
    logConfigurationSummary,
    logRuntimeConfigurationSummary,
    McpRuntimeConfig,
    showHelpMessage
} from './config.js';
import { DaemonRegistryManager } from './daemon-registry.js';
import {
    DAEMON_CLIENT_COMPATIBILITY_VERSION,
    DaemonClientConfigManager,
    readDaemonOperatorStatus
} from './daemon-discovery.js';
import { DashboardApiAdapter, DashboardApiResponse } from './dashboard-api.js';
import {
    isDashboardApiRoutePath,
    shouldHandleAsDashboardRoute
} from './dashboard-routing.js';
import { handleDaemonCliCommand } from './daemon-cli.js';
import { migrateWorkspaceStateToDaemon } from './daemon-state-migration.js';
import { createEmbeddingInstance, logEmbeddingProviderInfo } from './embedding.js';
import { ToolHandlers } from './handlers.js';
import { RuntimeStatusManager } from './runtime-status.js';
import { SEARCH_CODE_TOOL_DESCRIPTION } from './search-code-guidance.js';
import { SnapshotManager } from './snapshot.js';
import { SyncManager } from './sync.js';
import { getErrorMessage } from './utils.js';
import {
    createDaemonStatusResult,
    GET_DAEMON_STATUS_TOOL_DESCRIPTION
} from './worker-planning-policy.js';
import { shouldStopManagedWorkersAfterCancellation } from './workload-cancellation-policy.js';
import { WorkloadManager } from './workload-manager.js';

type ToolArgs = Record<string, unknown>;
type ContextOptions = NonNullable<ConstructorParameters<typeof Context>[0]>;

function isIdleBenchmarkStubModeEnabled(): boolean {
    return process.env.MCP_BENCHMARK_IDLE_STUBS === '1';
}

function createIdleBenchmarkEmbeddingStub() {
    return {
        getProvider: () => 'idle-benchmark-stub',
        getDimension: () => 1,
        detectDimension: async () => 1,
        embed: async () => ({ vector: [0], dimension: 1 }),
        embedBatch: async (texts: string[]) => texts.map(() => ({ vector: [0], dimension: 1 }))
    };
}

function createIdleBenchmarkVectorDatabaseStub() {
    return {
        hasCollection: async () => false
    };
}

class ContextMcpServer {
    private readonly config: ContextMcpConfig;
    private readonly runtimeConfig: McpRuntimeConfig;
    private readonly context: Context;
    private readonly codebaseConfigManager: CodebaseConfigManager;
    private readonly snapshotManager: SnapshotManager;
    private readonly syncManager: SyncManager;
    private readonly toolHandlers: ToolHandlers;
    private readonly runtimeStatusManager: RuntimeStatusManager;
    private readonly accessPolicy: CodebaseAccessPolicy;
    private readonly workloadManager?: WorkloadManager;
    private readonly managedBgeM3WorkerManager?: ManagedBgeM3WorkerManager;
    private readonly daemonRegistryManager?: DaemonRegistryManager;
    private readonly daemonClientConfigManager?: DaemonClientConfigManager;
    private stdioServer?: Server;
    private stdioTransport?: StdioServerTransport;
    private daemonHttpServer?: http.Server;
    private isClosed = false;

    constructor(
        config: ContextMcpConfig,
        runtimeConfig: McpRuntimeConfig,
        managedBgeM3WorkerManager?: ManagedBgeM3WorkerManager
    ) {
        this.config = config;
        this.runtimeConfig = runtimeConfig;
        this.managedBgeM3WorkerManager = managedBgeM3WorkerManager;

        console.log(`[EMBEDDING] Initializing embedding provider: ${config.embeddingProvider}`);
        console.log(`[EMBEDDING] Using model: ${config.embeddingModel}`);

        const idleBenchmarkStubMode = isIdleBenchmarkStubModeEnabled();
        if (idleBenchmarkStubMode) {
            console.log('[BENCHMARK] Using idle benchmark stubs for embedding and vector database.');
        }

        let embedding: ReturnType<typeof createEmbeddingInstance> | ReturnType<typeof createIdleBenchmarkEmbeddingStub>;
        if (idleBenchmarkStubMode) {
            embedding = createIdleBenchmarkEmbeddingStub();
            console.log('[BENCHMARK] Idle benchmark stub embedding initialized (dimension: 1).');
        } else {
            embedding = createEmbeddingInstance(config);
            logEmbeddingProviderInfo(config, embedding);
        }

        const vectorDatabase = idleBenchmarkStubMode
            ? createIdleBenchmarkVectorDatabaseStub()
            : createVectorDatabase(config);

        this.context = new Context({
            embedding: embedding as ContextOptions['embedding'],
            vectorDatabase: vectorDatabase as ContextOptions['vectorDatabase'],
            retrievalProfile: config.retrievalProfile,
            rlmBslEnrichment: config.rlmBslEnrichment,
            acceleratorResourceSnapshotProvider: () => {
                const vramPlanning = this.managedBgeM3WorkerManager?.getSnapshot().vramPlanning;
                if (!vramPlanning?.totalMiB) {
                    return undefined;
                }
                const usedMiB = vramPlanning.budgetMiB !== undefined && vramPlanning.freeBudgetMiB !== undefined
                    ? vramPlanning.budgetMiB - vramPlanning.freeBudgetMiB - vramPlanning.safetyMarginMiB
                    : vramPlanning.usedBeforeMiB;
                if (usedMiB === undefined || !Number.isFinite(usedMiB)) {
                    return undefined;
                }
                return {
                    vramUsedPercent: Number((Math.max(0, usedMiB) / vramPlanning.totalMiB * 100).toFixed(2)),
                };
            },
        });

        const runtimeId = crypto.randomUUID();
        const runtimeWorkspacePath = runtimeConfig.mode === 'daemon'
            ? runtimeConfig.daemon!.stateWorkspacePath
            : process.cwd();
        const snapshotScope = runtimeConfig.mode === 'daemon' ? 'daemon' : 'workspace';

        this.accessPolicy = new CodebaseAccessPolicy({
            mode: runtimeConfig.mode,
            allowedRoots: runtimeConfig.daemon?.allowRoots
        });
        this.codebaseConfigManager = new CodebaseConfigManager({
            workspacePath: runtimeWorkspacePath,
            scope: runtimeConfig.mode === 'daemon' ? 'daemon' : 'workspace'
        });
        this.snapshotManager = new SnapshotManager({
            runtimeId,
            workspacePath: runtimeWorkspacePath,
            scope: snapshotScope
        });
        this.runtimeStatusManager = new RuntimeStatusManager({
            runtimeId,
            workspacePath: runtimeWorkspacePath,
            snapshotManager: this.snapshotManager,
            mode: runtimeConfig.mode,
            ...(runtimeConfig.mode === 'daemon' && runtimeConfig.daemon ? {
                daemon: {
                    host: runtimeConfig.daemon.host,
                    port: runtimeConfig.daemon.port,
                    endpointPath: runtimeConfig.daemon.endpointPath,
                    allowedRoots: runtimeConfig.daemon.allowRoots,
                    tokenSha256: runtimeConfig.daemon.tokenSha256
                }
            } : {})
        });
        this.workloadManager = runtimeConfig.mode === 'daemon' && runtimeConfig.daemon
            ? new WorkloadManager({
                mode: runtimeConfig.mode,
                maxIndexingConcurrency: runtimeConfig.daemon.maxIndexingConcurrency,
                maxSearchConcurrency: runtimeConfig.daemon.maxSearchConcurrency,
                onStateChanged: async (snapshot, reason) => {
                    await this.runtimeStatusManager.updateWorkloadState(snapshot, `workload-${reason}`);
                    if (snapshot.indexing.activeCount === 0 && snapshot.indexing.queuedCount === 0) {
                        this.managedBgeM3WorkerManager?.scheduleStopWhenIdle(
                            `indexing workload idle after workload-${reason}`,
                            () => {
                                const currentSnapshot = this.workloadManager?.getSnapshot();
                                return !currentSnapshot || (
                                    currentSnapshot.indexing.activeCount === 0
                                    && currentSnapshot.indexing.queuedCount === 0
                                );
                            }
                        );
                    } else {
                        this.managedBgeM3WorkerManager?.cancelScheduledStop();
                    }
                }
            })
            : undefined;
        this.syncManager = new SyncManager(
            this.context,
            this.snapshotManager,
            this.codebaseConfigManager,
            this.runtimeStatusManager,
            this.workloadManager
        );
        this.toolHandlers = new ToolHandlers(
            this.context,
            this.snapshotManager,
            this.codebaseConfigManager,
            this.runtimeStatusManager,
            this.accessPolicy,
            this.workloadManager,
            this.managedBgeM3WorkerManager,
            {
                retrievalProfile: this.config.retrievalProfile,
                resolvedRetrievalProfile: this.config.resolvedRetrievalProfile.retrievalProfile,
                explicitProfile: this.config.resolvedRetrievalProfile.explicitProfile,
                retrievalMode: this.config.resolvedRetrievalProfile.retrievalMode,
                retrievalSchemaVersion: this.config.resolvedRetrievalProfile.retrievalSchemaVersion,
                bgeM3Mode: this.config.resolvedRetrievalProfile.bgeM3Mode,
                usesBgeM3Sparse: this.config.resolvedRetrievalProfile.usesBgeM3Sparse,
                usesColbert: this.config.resolvedRetrievalProfile.usesColbert,
            }
        );

        this.snapshotManager.loadCodebaseSnapshot();
        void this.runtimeStatusManager.refresh('startup');

        if (runtimeConfig.mode === 'daemon' && runtimeConfig.daemon) {
            this.daemonRegistryManager = new DaemonRegistryManager({
                runtimeId,
                host: runtimeConfig.daemon.host,
                port: runtimeConfig.daemon.port,
                endpointPath: runtimeConfig.daemon.endpointPath,
                allowedRoots: runtimeConfig.daemon.allowRoots,
                tokenSha256: runtimeConfig.daemon.tokenSha256,
                runtimeStatusFilePath: this.runtimeStatusManager.getRuntimeStatusFilePath(),
                snapshotFilePath: this.snapshotManager.getSnapshotFilePath()
            });
            this.daemonClientConfigManager = new DaemonClientConfigManager({
                runtimeId,
                serverName: this.config.name,
                serverVersion: this.config.version,
                compatibilityVersion: DAEMON_CLIENT_COMPATIBILITY_VERSION,
                host: runtimeConfig.daemon.host,
                port: runtimeConfig.daemon.port,
                endpointPath: runtimeConfig.daemon.endpointPath,
                allowedRoots: runtimeConfig.daemon.allowRoots,
                bearerToken: runtimeConfig.daemon.bearerToken,
                tokenSha256: runtimeConfig.daemon.tokenSha256,
                runtimeStatusFilePath: this.runtimeStatusManager.getRuntimeStatusFilePath(),
                snapshotFilePath: this.snapshotManager.getSnapshotFilePath()
            });
        }

        if (this.workloadManager) {
            void this.runtimeStatusManager.updateWorkloadState(this.workloadManager.getSnapshot(), 'workload-startup');
        }
    }

    private createProtocolServer(): Server {
        const server = new Server(
            {
                name: this.config.name,
                version: this.config.version
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );

        this.setupTools(server);
        return server;
    }

    private setupTools(server: Server) {
        const indexDescription = `
Index a codebase directory to enable semantic search using a configurable code splitter.

⚠️ **IMPORTANT**:
- You MUST provide a canonical absolute path to the target codebase.
- Prefer POSIX form (for example, /home/egor/code/repo). WSL UNC paths are normalized automatically, but POSIX form is recommended.

✨ **Usage Guidance**:
- This tool is typically used when search fails due to an unindexed codebase.
- If indexing is attempted on an already indexed path, and a conflict is detected, you MUST prompt the user to confirm whether to proceed with a force index (i.e., re-indexing and overwriting the previous index).
`;

        server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools: Array<Record<string, unknown>> = [
                {
                    name: 'index_codebase',
                    description: indexDescription,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Canonical ABSOLUTE path to the codebase directory to index. Prefer POSIX form (e.g. /home/egor/code/repo). WSL UNC paths are normalized automatically.'
                            },
                            force: {
                                type: 'boolean',
                                description: 'Force re-indexing even if already indexed',
                                default: false
                            },
                            splitter: {
                                type: 'string',
                                description: "Code splitter to use: 'ast' for syntax-aware splitting with automatic fallback, 'langchain' for character-based splitting",
                                enum: ['ast', 'langchain'],
                                default: 'ast'
                            },
                            customExtensions: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                },
                                description: "Optional: Additional file extensions to include beyond defaults (e.g., ['.vue', '.svelte', '.astro']). Extensions should include the dot prefix or will be automatically added",
                                default: []
                            },
                            ignorePatterns: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                },
                                description: "Optional: Additional ignore patterns to exclude specific files/directories beyond defaults. Only include this parameter if the user explicitly requests custom ignore patterns (e.g., ['static/**', '*.tmp', 'private/**'])",
                                default: []
                            },
                            oneCIndexScopeProfile: {
                                type: 'string',
                                description: "Optional 1C exported-configuration scope profile. 'full' preserves existing behavior; 'developer' excludes generated or low-value 1C export files; 'minimal' indexes only developer-maintained BSL modules; 'v8unpack' indexes BSL plus useful JSON metadata from ordinary-form v8unpack exports while excluding heavy resources. Changing the profile for an existing index requires force=true.",
                                enum: ['full', 'developer', 'minimal', 'v8unpack'],
                                default: 'full'
                            },
                            retrievalProfile: {
                                type: 'string',
                                description: "Optional retrieval performance profile. 'fast' minimizes indexing/storage cost, 'balanced' uses the balanced retrieval shape, and 'quality' enables the highest-quality available retrieval. Changing incompatible profiles requires force=true.",
                                enum: ['fast', 'balanced', 'quality']
                            }
                        },
                        required: ['path']
                    }
                },
                {
                    name: 'search_code',
                    description: SEARCH_CODE_TOOL_DESCRIPTION,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Canonical ABSOLUTE path to the codebase directory to search in. Prefer POSIX form (e.g. /home/egor/code/repo). WSL UNC paths are normalized automatically.'
                            },
                            query: {
                                type: 'string',
                                description: 'Natural language query to search for in the codebase'
                            },
                            limit: {
                                type: 'number',
                                description: 'Maximum number of results to return',
                                default: 10,
                                maximum: 50
                            },
                            extensionFilter: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                },
                                description: "Optional: List of file extensions to filter results. (e.g., ['.ts','.py']).",
                                default: []
                            },
                            rankingProfile: {
                                type: 'string',
                                description: "Optional retrieval ranking profile. 'auto' preserves current path-based behavior, 'generic' disables 1C-specific boosts, and 'one-c' explicitly enables 1C ranking signals for exported 1C configurations.",
                                enum: ['auto', 'generic', 'one-c'],
                                default: 'auto'
                            }
                        },
                        required: ['path', 'query']
                    }
                },
                {
                    name: 'clear_index',
                    description: 'Clear the search index. IMPORTANT: You MUST provide a canonical absolute path. Prefer POSIX form; WSL UNC paths are normalized automatically.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Canonical ABSOLUTE path to the codebase directory to clear. Prefer POSIX form (e.g. /home/egor/code/repo). WSL UNC paths are normalized automatically.'
                            }
                        },
                        required: ['path']
                    }
                },
                {
                    name: 'get_indexing_status',
                    description: 'Get the current indexing status of a codebase. Shows progress percentage plus progressDetails {phase,current,total,percentage} for active indexing, and completion status for indexed codebases.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Canonical ABSOLUTE path to the codebase directory to check status for. Prefer POSIX form (e.g. /home/egor/code/repo). WSL UNC paths are normalized automatically.'
                            }
                        },
                        required: ['path']
                    }
                }
            ];

            if (this.runtimeConfig.mode === 'daemon') {
                tools.push(
                    {
                        name: 'get_daemon_status',
                        description: GET_DAEMON_STATUS_TOOL_DESCRIPTION,
                        inputSchema: {
                            type: 'object',
                            properties: {},
                            additionalProperties: false
                        }
                    },
                    {
                        name: 'cancel_codebase_workload',
                        description: 'Cancel queued or active daemon indexing/background-sync work for a codebase path.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                path: {
                                    type: 'string',
                                    description: 'Canonical ABSOLUTE path to the codebase whose daemon workload should be cancelled. Prefer POSIX form (e.g. /home/egor/code/repo). WSL UNC paths are normalized automatically.'
                                },
                                reason: {
                                    type: 'string',
                                    description: 'Optional operator-visible cancellation reason.'
                                }
                            },
                            required: ['path']
                        }
                    },
                    {
                        name: 'shutdown_daemon',
                        description: 'Gracefully stop the local daemon after this response has been sent.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                reason: {
                                    type: 'string',
                                    description: 'Optional operator-visible shutdown reason.'
                                }
                            }
                        }
                    }
                );
            }

            return { tools };
        });

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const toolArgs: ToolArgs = args ?? {};

            switch (name) {
                case 'index_codebase':
                    return await this.toolHandlers.handleIndexCodebase(toolArgs);
                case 'search_code':
                    return await this.toolHandlers.handleSearchCode(toolArgs);
                case 'clear_index':
                    return await this.toolHandlers.handleClearIndex(toolArgs);
                case 'get_indexing_status':
                    return await this.toolHandlers.handleGetIndexingStatus(toolArgs);
                case 'get_daemon_status':
                    return await this.handleGetDaemonStatusTool();
                case 'cancel_codebase_workload':
                    return await this.handleCancelCodebaseWorkloadTool(toolArgs);
                case 'shutdown_daemon':
                    return await this.handleShutdownDaemonTool(toolArgs);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }

    private async prepareDaemonState(): Promise<void> {
        if (this.runtimeConfig.mode !== 'daemon') {
            return;
        }

        const migration = await migrateWorkspaceStateToDaemon(
            this.snapshotManager,
            this.codebaseConfigManager,
            this.accessPolicy
        );

        if (migration.importedCodebases.length === 0 && migration.importedConfigs.length === 0) {
            return;
        }

        console.log(
            `[DAEMON-MIGRATION] Imported ${migration.importedCodebases.length} codebase(s) and ` +
            `${migration.importedConfigs.length} config(s) into daemon state.`
        );
        await this.runtimeStatusManager.refresh('daemon-workspace-migration');
    }

    private async handleGetDaemonStatusTool() {
        const operatorStatus = await readDaemonOperatorStatus();
        const accelerator = this.context.getLastAcceleratorSnapshot();
        const managedBgeM3Workers = this.managedBgeM3WorkerManager?.getSnapshot();
        return createDaemonStatusResult(operatorStatus, accelerator, managedBgeM3Workers, {
            retrievalProfile: this.config.retrievalProfile,
            resolvedRetrievalProfile: this.config.resolvedRetrievalProfile.retrievalProfile,
            explicitProfile: this.config.resolvedRetrievalProfile.explicitProfile,
            retrievalMode: this.config.resolvedRetrievalProfile.retrievalMode,
            retrievalSchemaVersion: this.config.resolvedRetrievalProfile.retrievalSchemaVersion,
            bgeM3Mode: this.config.resolvedRetrievalProfile.bgeM3Mode,
            storeColbert: this.config.resolvedRetrievalProfile.storeColbert,
            usesHybridSearch: this.config.resolvedRetrievalProfile.usesHybridSearch,
            usesBgeM3Sparse: this.config.resolvedRetrievalProfile.usesBgeM3Sparse,
            usesColbert: this.config.resolvedRetrievalProfile.usesColbert,
        });
    }

    private async handleCancelCodebaseWorkloadTool(args: ToolArgs) {
        const inputPath = typeof args?.path === 'string' ? args.path : '';
        const reason = typeof args?.reason === 'string' && args.reason.trim().length > 0
            ? args.reason.trim()
            : 'Cancelled by daemon operator.';

        if (!inputPath) {
            return {
                content: [{
                    type: 'text',
                    text: 'Error: cancel_codebase_workload requires an absolute path.'
                }],
                isError: true
            };
        }

        const accessDecision = this.accessPolicy.evaluateCodebasePath(inputPath);
        if (!accessDecision.allowed) {
            return {
                content: [{
                    type: 'text',
                    text: `Error: Access to codebase '${accessDecision.absolutePath}' is outside the configured daemon allowlist. Allowed roots: ${this.accessPolicy.getAllowedRoots().join(', ')}`
                }],
                isError: true
            };
        }

        if (!this.workloadManager) {
            return {
                content: [{
                    type: 'text',
                    text: 'Error: cancel_codebase_workload is only available in daemon mode.'
                }],
                isError: true
            };
        }

        const cancellation = this.workloadManager.cancelCodebaseIndexingWork(accessDecision.absolutePath, reason);
        const cancelledInteractiveWork = [...cancellation.queued, ...cancellation.active]
            .some((job) => job.type === 'interactive-index');

        if (shouldStopManagedWorkersAfterCancellation(cancellation)) {
            await this.managedBgeM3WorkerManager?.stopAll(`cancelled workload for ${accessDecision.absolutePath}`);
        }

        if (cancelledInteractiveWork) {
            const lastProgress = this.snapshotManager.getIndexingProgress(accessDecision.absolutePath);
            await this.snapshotManager.failIndexingOwnership(
                accessDecision.absolutePath,
                reason,
                lastProgress
            ).catch(() => undefined);
        }

        let idleAfterCancel: boolean | undefined;
        if (cancellation.active.length > 0) {
            idleAfterCancel = await this.workloadManager.waitForCodebaseIndexingIdle(accessDecision.absolutePath);
            if (!idleAfterCancel) {
                console.warn(
                    `[MCP] Timed out waiting for cancelled indexing workload to become idle for '${accessDecision.absolutePath}'.`
                );
            }
        }

        await this.runtimeStatusManager.updateWorkloadState(
            this.workloadManager.getSnapshot(),
            idleAfterCancel === false ? 'daemon-admin-cancel-workload-timeout' : 'daemon-admin-cancel-workload'
        );

        const text = cancellation.queued.length === 0 && cancellation.active.length === 0
            ? `No queued or active daemon indexing work was found for '${accessDecision.absolutePath}'.`
            : `Cancelled daemon workload for '${accessDecision.absolutePath}'. ` +
                `Queued jobs: ${cancellation.queued.length}. Active jobs: ${cancellation.active.length}.`;

        return {
            content: [{
                type: 'text',
                text
            }],
            structuredContent: {
                path: accessDecision.absolutePath,
                reason,
                queued: cancellation.queued,
                active: cancellation.active,
                ...(idleAfterCancel !== undefined ? { idleAfterCancel } : {})
            }
        };
    }

    private async handleShutdownDaemonTool(args: ToolArgs) {
        const reason = typeof args?.reason === 'string' && args.reason.trim().length > 0
            ? args.reason.trim()
            : 'shutdown requested by daemon operator';

        setTimeout(() => {
            void shutdown(reason).finally(() => process.exit(0));
        }, 0);

        return {
            content: [{
                type: 'text',
                text: `Daemon shutdown scheduled: ${reason}.`
            }],
            structuredContent: {
                scheduled: true,
                reason
            }
        };
    }

    private async startStdio(): Promise<void> {
        this.stdioServer = this.createProtocolServer();
        this.stdioTransport = new StdioServerTransport();

        console.log('[SYNC-DEBUG] StdioServerTransport created, attempting server connection...');
        await this.stdioServer.connect(this.stdioTransport);
        console.log('MCP server started and listening on stdio.');
        console.log('[SYNC-DEBUG] Server connection established successfully');

        console.log('[SYNC-DEBUG] Initializing background sync...');
        this.syncManager.startBackgroundSync();
        console.log('[SYNC-DEBUG] MCP server initialization complete');
    }

    private async startDaemon(): Promise<void> {
        const daemonConfig = this.runtimeConfig.daemon;
        if (!daemonConfig) {
            throw new Error('Daemon runtime configuration is missing.');
        }

        await this.prepareDaemonState();

        this.daemonHttpServer = http.createServer((request, response) => {
            void this.handleDaemonRequest(request, response);
        });

        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                this.daemonHttpServer?.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                this.daemonHttpServer?.off('error', onError);
                resolve();
            };

            this.daemonHttpServer?.once('error', onError);
            this.daemonHttpServer?.once('listening', onListening);
            this.daemonHttpServer?.listen(daemonConfig.port, daemonConfig.host);
        });

        await this.runtimeStatusManager.refresh('daemon-started');
        await this.daemonRegistryManager?.refresh();
        this.daemonRegistryManager?.startHeartbeat();
        await this.daemonClientConfigManager?.refresh();
        this.daemonClientConfigManager?.startHeartbeat();

        console.log(`MCP daemon started and listening on http://${daemonConfig.host}:${daemonConfig.port}${daemonConfig.endpointPath}.`);

        console.log('[SYNC-DEBUG] Initializing background sync...');
        this.syncManager.startBackgroundSync();
        console.log('[SYNC-DEBUG] MCP daemon initialization complete');
    }

    private async handleDaemonRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        const daemonConfig = this.runtimeConfig.daemon;
        if (!daemonConfig) {
            this.writeDaemonError(response, 500, 'Daemon runtime is not configured.');
            return;
        }

        const requestUrl = new URL(request.url || '/', `http://${daemonConfig.host}:${daemonConfig.port}`);
        if (shouldHandleAsDashboardRoute(requestUrl.pathname, daemonConfig.dashboard)) {
            await this.handleDashboardRequest(request, response, requestUrl);
            return;
        }

        if (requestUrl.pathname !== daemonConfig.endpointPath) {
            this.writeDaemonError(response, 404, 'Not found.');
            return;
        }

        if (!this.isLoopbackRequest(request)) {
            this.writeDaemonError(response, 403, 'Daemon only accepts loopback connections.');
            return;
        }

        const rejectedOrigin = this.getRejectedOrigin(request.headers.origin, request.headers.referer);
        if (rejectedOrigin) {
            this.writeDaemonError(response, 403, `Rejected non-local web origin '${rejectedOrigin}'.`);
            return;
        }

        const providedToken = this.extractBearerToken(request.headers.authorization);
        if (!providedToken || !this.tokensMatch(providedToken, daemonConfig.bearerToken)) {
            this.writeDaemonError(
                response,
                401,
                'Missing or invalid daemon bearer token.',
                { 'WWW-Authenticate': 'Bearer realm="claude-context-mcp-daemon"' }
            );
            return;
        }

        const sessionIdHeader = request.headers['mcp-session-id'];
        if (typeof sessionIdHeader === 'string' && sessionIdHeader.trim().length > 0) {
            this.writeDaemonError(response, 400, 'Stateless daemon mode does not accept mcp-session-id.');
            return;
        }

        if (request.method !== 'POST') {
            this.writeDaemonError(response, 405, 'Method not allowed.', { Allow: 'POST' });
            return;
        }

        const server = this.createProtocolServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        });

        const cleanup = () => {
            void transport.close().catch(() => undefined);
            void server.close().catch(() => undefined);
        };
        response.once('close', cleanup);

        try {
            await server.connect(transport);
            await transport.handleRequest(request, response);
        } catch (error) {
            cleanup();
            console.error('[DAEMON] Error handling MCP request:', getErrorMessage(error));

            if (!response.headersSent) {
                this.writeDaemonError(response, 500, 'Internal server error.');
            }
        }
    }

    private async handleDashboardRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        requestUrl: URL
    ): Promise<void> {
        const daemonConfig = this.runtimeConfig.daemon;
        if (!daemonConfig) {
            this.writeDashboardJson(response, {
                statusCode: 500,
                body: { ok: false, error: 'Daemon runtime is not configured.' }
            });
            return;
        }

        if (!this.isLoopbackRequest(request)) {
            this.writeDashboardJson(response, {
                statusCode: 403,
                body: { ok: false, error: 'Dashboard only accepts loopback connections.' }
            });
            return;
        }

        const rejectedOrigin = this.getRejectedOrigin(request.headers.origin, request.headers.referer);
        if (rejectedOrigin) {
            this.writeDashboardJson(response, {
                statusCode: 403,
                body: { ok: false, error: `Rejected non-local web origin '${rejectedOrigin}'.` }
            });
            return;
        }

        if (isDashboardApiRoutePath(requestUrl.pathname, daemonConfig.dashboard.apiPrefix)) {
            await this.handleDashboardApiRequest(request, response, requestUrl);
            return;
        }

        await this.handleDashboardStaticRequest(request, response, requestUrl);
    }

    private async handleDashboardApiRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        requestUrl: URL
    ): Promise<void> {
        const daemonConfig = this.runtimeConfig.daemon;
        if (!daemonConfig) {
            this.writeDashboardJson(response, {
                statusCode: 500,
                body: { ok: false, error: 'Daemon runtime is not configured.' }
            });
            return;
        }

        const providedToken = this.extractBearerToken(request.headers.authorization)
            || this.extractDashboardSessionToken(request.headers.cookie);
        if (!providedToken || !this.tokensMatch(providedToken, daemonConfig.bearerToken)) {
            this.writeDashboardJson(
                response,
                {
                    statusCode: 401,
                    body: { ok: false, error: 'Missing or invalid daemon bearer token.' }
                },
                { 'WWW-Authenticate': 'Bearer realm="claude-context-dashboard"' }
            );
            return;
        }

        const body = request.method === 'POST'
            ? await this.readDashboardJsonBody(request)
            : undefined;
        if (body instanceof Error) {
            this.writeDashboardJson(response, {
                statusCode: 400,
                body: { ok: false, error: body.message }
            });
            return;
        }

        const adapter = new DashboardApiAdapter({
            toolHandlers: this.toolHandlers,
            getDaemonStatus: () => this.handleGetDaemonStatusTool(),
            listCodebases: () => this.listDashboardCodebases(),
            cancelCodebaseWorkload: (args) => this.handleCancelCodebaseWorkloadTool(args),
        });

        const relativePath = requestUrl.pathname.slice(daemonConfig.dashboard.apiPrefix.length) || '/';
        const apiPath = `/api${relativePath}`;
        const result = await adapter.handle({
            method: request.method || 'GET',
            path: apiPath,
            query: requestUrl.searchParams,
            body,
        });
        this.writeDashboardJson(response, result);
    }

    private async handleDashboardStaticRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        requestUrl: URL
    ): Promise<void> {
        const daemonConfig = this.runtimeConfig.daemon;
        if (!daemonConfig) {
            this.writeDashboardJson(response, {
                statusCode: 500,
                body: { ok: false, error: 'Daemon runtime is not configured.' }
            });
            return;
        }

        this.setDashboardSessionCookie(response, daemonConfig.dashboard.routePrefix, daemonConfig.bearerToken);

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            this.writeDashboardJson(response, {
                statusCode: 405,
                body: { ok: false, error: 'Method not allowed.' }
            }, { Allow: 'GET, HEAD' });
            return;
        }

        if (requestUrl.pathname === daemonConfig.dashboard.routePrefix) {
            response.writeHead(302, {
                Location: `${daemonConfig.dashboard.routePrefix}/`,
                'Cache-Control': 'no-store',
            });
            response.end();
            return;
        }

        if (daemonConfig.dashboard.staticDir) {
            const served = await this.tryServeDashboardStaticFile(
                response,
                requestUrl.pathname,
                daemonConfig.dashboard.routePrefix,
                daemonConfig.dashboard.staticDir,
                request.method === 'HEAD'
            );
            if (served) {
                return;
            }
        }

        this.writeDashboardHtml(response, this.createDefaultDashboardHtml(), request.method === 'HEAD');
    }

    private setDashboardSessionCookie(response: http.ServerResponse, routePrefix: string, token: string): void {
        response.setHeader(
            'Set-Cookie',
            `claude_context_dashboard_token=${encodeURIComponent(token)}; Path=${routePrefix}; HttpOnly; SameSite=Strict`
        );
    }

    private extractDashboardSessionToken(cookieHeader: string | string[] | undefined): string | null {
        const candidate = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
        if (!candidate) {
            return null;
        }

        for (const part of candidate.split(';')) {
            const [rawName, ...rawValueParts] = part.trim().split('=');
            if (rawName === 'claude_context_dashboard_token') {
                return decodeURIComponent(rawValueParts.join('='));
            }
        }

        return null;
    }

    private async listDashboardCodebases(): Promise<Array<{ path: string; status: string }>> {
        const snapshotInfo = this.snapshotManager.getAllCodebaseInfo();
        const codebases = new Map<string, string>();

        for (const [codebasePath, info] of Object.entries(snapshotInfo)) {
            codebases.set(codebasePath, info.status);
        }

        for (const codebasePath of await this.codebaseConfigManager.listConfiguredCodebases()) {
            if (!codebases.has(codebasePath)) {
                codebases.set(codebasePath, 'configured');
            }
        }

        for (const lane of [this.workloadManager?.getSnapshot().indexing, this.workloadManager?.getSnapshot().search]) {
            for (const job of [...(lane?.activeJobs || []), ...(lane?.queuedJobs || [])]) {
                if (!codebases.has(job.codebasePath)) {
                    codebases.set(job.codebasePath, 'queued');
                }
            }
        }

        return [...codebases.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([codebasePath, status]) => ({ path: codebasePath, status }));
    }

    private async readDashboardJsonBody(request: http.IncomingMessage): Promise<unknown | Error> {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > 1024 * 1024) {
                return new Error('Dashboard request body is too large.');
            }
            chunks.push(buffer);
        }

        if (chunks.length === 0) {
            return new Error('Expected a JSON object request body.');
        }

        try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        } catch {
            return new Error('Invalid JSON request body.');
        }
    }

    private async tryServeDashboardStaticFile(
        response: http.ServerResponse,
        pathname: string,
        routePrefix: string,
        staticDir: string,
        headOnly: boolean
    ): Promise<boolean> {
        const relativeUrlPath = pathname === routePrefix
            ? 'index.html'
            : decodeURIComponent(pathname.slice(routePrefix.length + 1)) || 'index.html';
        const safeRelativePath = path.normalize(relativeUrlPath).replace(/^(\.\.(\/|\\|$))+/, '');
        const staticRoot = path.resolve(staticDir);
        const filePath = path.resolve(staticRoot, safeRelativePath);

        if (!filePath.startsWith(`${staticRoot}${path.sep}`) && filePath !== staticRoot) {
            this.writeDashboardJson(response, {
                statusCode: 403,
                body: { ok: false, error: 'Forbidden dashboard asset path.' }
            });
            return true;
        }

        try {
            const stat = await fs.promises.stat(filePath);
            if (!stat.isFile()) {
                return false;
            }

            response.writeHead(200, {
                'Content-Type': this.getDashboardContentType(filePath),
                'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=300',
            });
            if (!headOnly) {
                response.end(await fs.promises.readFile(filePath));
            } else {
                response.end();
            }
            return true;
        } catch {
            return false;
        }
    }

    private getDashboardContentType(filePath: string): string {
        const extension = path.extname(filePath);
        switch (extension) {
            case '.html':
                return 'text/html; charset=utf-8';
            case '.js':
                return 'text/javascript; charset=utf-8';
            case '.css':
                return 'text/css; charset=utf-8';
            case '.json':
                return 'application/json; charset=utf-8';
            case '.svg':
                return 'image/svg+xml';
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            default:
                return 'application/octet-stream';
        }
    }

    private writeDashboardJson(
        response: http.ServerResponse,
        result: DashboardApiResponse,
        headers: Record<string, string> = {}
    ): void {
        if (response.writableEnded) {
            return;
        }

        response.writeHead(result.statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...headers
        });
        response.end(JSON.stringify(result.body));
    }

    private writeDashboardHtml(response: http.ServerResponse, html: string, headOnly: boolean): void {
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(headOnly ? undefined : html);
    }

    private createDefaultDashboardHtml(): string {
        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Claude Context Dashboard</title>
</head>
<body>
  <main>
    <h1>Claude Context Dashboard</h1>
    <p>Build the web dashboard package and configure MCP_DASHBOARD_STATIC_DIR to serve the full interface.</p>
  </main>
</body>
</html>`;
    }

    private isLoopbackRequest(request: http.IncomingMessage): boolean {
        const remoteAddress = request.socket.remoteAddress;
        return remoteAddress === '127.0.0.1'
            || remoteAddress === '::1'
            || remoteAddress === '::ffff:127.0.0.1';
    }

    private getRejectedOrigin(originHeader: string | string[] | undefined, refererHeader: string | string[] | undefined): string | null {
        const headersToCheck = [originHeader, refererHeader];

        for (const headerValue of headersToCheck) {
            const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
            if (!candidate) {
                continue;
            }

            try {
                const parsed = new URL(candidate);
                if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1') {
                    continue;
                }
                return candidate;
            } catch {
                return candidate;
            }
        }

        return null;
    }

    private extractBearerToken(authorizationHeader: string | string[] | undefined): string | null {
        const candidate = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
        if (!candidate) {
            return null;
        }

        const match = candidate.match(/^Bearer\s+(.+)$/i);
        return match?.[1] || null;
    }

    private tokensMatch(left: string, right: string): boolean {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(leftBuffer, rightBuffer);
    }

    private writeDaemonError(
        response: http.ServerResponse,
        statusCode: number,
        message: string,
        headers: Record<string, string> = {}
    ): void {
        if (response.writableEnded) {
            return;
        }

        response.writeHead(statusCode, {
            'Content-Type': 'application/json',
            ...headers
        });
        response.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message
            },
            id: null
        }));
    }

    public async start(): Promise<void> {
        console.log('[SYNC-DEBUG] MCP server start() method called');
        console.log('Starting Context MCP server...');

        if (this.runtimeConfig.mode === 'daemon') {
            await this.startDaemon();
            return;
        }

        await this.startStdio();
    }

    public async close(): Promise<void> {
        if (this.isClosed) {
            return;
        }
        this.isClosed = true;

        this.syncManager.stopBackgroundSync();
        this.daemonRegistryManager?.stopHeartbeat();
        this.daemonClientConfigManager?.stopHeartbeat();
        const cancelledWork = this.workloadManager?.cancelAllWork('Cancelled by daemon shutdown.');
        if (cancelledWork && (cancelledWork.queued.length > 0 || cancelledWork.active.length > 0)) {
            console.warn(
                `[MCP] Cancelled ${cancelledWork.queued.length} queued and ${cancelledWork.active.length} active workload job(s) during shutdown.`
            );
        }

        const shutdownErrorMessage = `MCP runtime shutdown interrupted indexing before completion.`;
        const interruptedCodebases = await this.snapshotManager.failCurrentRuntimeOwnedIndexingCodebases(shutdownErrorMessage);
        if (interruptedCodebases.length > 0) {
            console.warn(
                `[MCP] Marked ${interruptedCodebases.length} runtime-owned indexing job(s) as failed during shutdown: ` +
                interruptedCodebases.join(', ')
            );
        }

        if (this.daemonHttpServer) {
            await new Promise<void>((resolve, reject) => {
                this.daemonHttpServer?.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        }

        if (this.stdioServer) {
            await this.stdioServer.close().catch(() => undefined);
        }

        if (this.stdioTransport) {
            await this.stdioTransport.close().catch(() => undefined);
        }

        await this.daemonRegistryManager?.remove();
        await this.daemonClientConfigManager?.remove();
        await this.managedBgeM3WorkerManager?.stopAll('daemon shutdown');
    }
}

function createVectorDatabase(config: ContextMcpConfig) {
    if (config.vectorDatabaseBackend === 'lancedb') {
        const uri = config.lancedbUri || path.join(process.cwd(), '.context', 'lancedb');
        console.log(`[VECTORDB] Using LanceDB backend at ${uri}`);
        return new LanceDbVectorDatabase({ uri });
    }

    if (config.vectorDatabaseBackend === 'qdrant') {
        const url = config.qdrantUrl || 'http://127.0.0.1:6333';
        console.log(`[VECTORDB] Using Qdrant backend at ${url}`);
        return new QdrantVectorDatabase({
            url,
            apiKey: config.qdrantApiKey,
        });
    }

    console.log('[VECTORDB] Using Milvus backend');
    return new MilvusVectorDatabase({
        address: config.milvusAddress,
        ...(config.milvusToken && { token: config.milvusToken })
    });
}

let activeServer: ContextMcpServer | null = null;
let shutdownPromise: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
    if (shutdownPromise) {
        return shutdownPromise;
    }

    shutdownPromise = (async () => {
        console.error(`Received ${signal}, shutting down gracefully...`);
        await activeServer?.close();
    })();

    await shutdownPromise;
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        showHelpMessage();
        process.exit(0);
    }

    if (await handleDaemonCliCommand(args)) {
        process.exit(0);
    }

    const config = createMcpConfig();
    const runtimeConfig = createMcpRuntimeConfig(args);
    const managedBgeM3WorkerManager = await createManagedBgeM3WorkerManager(config);
    if (managedBgeM3WorkerManager.fallbackReason) {
        console.warn(`[MCP] Managed BGE-M3 worker fallback: ${managedBgeM3WorkerManager.fallbackReason}`);
    }
    logConfigurationSummary(config);
    logAcceleratorConfiguration(config);
    logRuntimeConfigurationSummary(runtimeConfig);

    activeServer = new ContextMcpServer(config, runtimeConfig, managedBgeM3WorkerManager);
    await activeServer.start();
}

process.on('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
});

main().catch((error) => {
    console.error('Fatal error:', error);
    void activeServer?.close().catch(() => undefined).finally(() => process.exit(1));
});
