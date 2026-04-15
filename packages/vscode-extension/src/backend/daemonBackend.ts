import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SemanticSearchResult, SplitterType } from '@zilliz/claude-context-core';
import { ConfigManager } from '../config/configManager';
import { readExtensionDaemonDiscoveryConfig } from './daemonDiscovery';
import {
    BackendIndexResult,
    BackendIndexStatus,
    BackendProgressInfo,
    BackendSplitterType,
    BackendSyncResult,
    CodeSearchBackend
} from './types';

const CLIENT_NAME = 'semanticcodesearch-vscode';
const CLIENT_VERSION = '0.1.6';
const STATUS_POLL_INTERVAL_MS = 1000;

interface McpToolResult {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
    structuredContent?: any;
}

interface DaemonIndexStartStructuredContent {
    path: string;
    startedImmediately: boolean;
    queuePosition: number;
}

interface DaemonSearchStructuredContent {
    path: string;
    query: string;
    results: Array<{
        relativePath: string;
        language?: string;
        startLine: number;
        endLine: number;
        score: number;
        content: string;
    }>;
}

function extractToolText(result: McpToolResult): string {
    if (!Array.isArray(result.content)) {
        return '';
    }

    return result.content
        .filter((item) => item?.type === 'text' && typeof item?.text === 'string')
        .map((item) => item.text || '')
        .join('\n');
}

async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export class DaemonCodeSearchBackend implements CodeSearchBackend {
    public readonly mode = 'daemon' as const;

    constructor(private readonly configManager: ConfigManager) {}

    public async isAvailable(): Promise<boolean> {
        return (await readExtensionDaemonDiscoveryConfig(true)) !== null;
    }

    public async hasIndex(codebasePath: string): Promise<boolean> {
        const status = await this.getIndexStatus(codebasePath);
        return status.status === 'indexed' || status.status === 'indexing';
    }

    public async getIndexStatus(codebasePath: string): Promise<BackendIndexStatus> {
        const result = await this.callTool('get_indexing_status', { path: codebasePath });
        return this.requireStructuredContent<BackendIndexStatus>(result, 'get_indexing_status');
    }

    public async search(
        codebasePath: string,
        searchTerm: string,
        limit: number,
        fileExtensions: string[] = []
    ): Promise<SemanticSearchResult[]> {
        const result = await this.callTool('search_code', {
            path: codebasePath,
            query: searchTerm,
            limit,
            extensionFilter: fileExtensions
        });
        const structured = this.requireStructuredContent<DaemonSearchStructuredContent>(result, 'search_code');
        return structured.results.map((entry) => ({
            relativePath: entry.relativePath,
            language: entry.language || 'text',
            startLine: entry.startLine,
            endLine: entry.endLine,
            score: entry.score,
            content: entry.content
        })) as SemanticSearchResult[];
    }

    public async indexCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendIndexResult> {
        const splitter = this.getPreferredSplitterType();
        const startResult = await this.callTool('index_codebase', {
            path: codebasePath,
            force: true,
            splitter
        });
        const start = this.requireStructuredContent<DaemonIndexStartStructuredContent>(startResult, 'index_codebase');

        onProgress?.({
            percentage: 0,
            phase: start.startedImmediately
                ? 'Daemon accepted indexing request. Waiting for completion...'
                : `Queued in daemon runtime at position ${start.queuePosition}. Waiting for execution slot...`,
            current: 0,
            total: 100
        });

        while (true) {
            const status = await this.getIndexStatus(codebasePath);

            if (status.status === 'indexed') {
                onProgress?.({
                    percentage: 100,
                    phase: 'Daemon indexing complete.',
                    current: 100,
                    total: 100
                });

                return {
                    mode: this.mode,
                    indexedFiles: status.indexedFiles,
                    totalChunks: status.totalChunks,
                    status: status.indexStatus || 'completed',
                    startedImmediately: start.startedImmediately,
                    queuePosition: start.queuePosition
                };
            }

            if (status.status === 'indexfailed') {
                throw new Error(status.errorMessage || `Indexing failed for '${codebasePath}'.`);
            }

            const progressPercentage = status.progressPercentage ?? 0;
            onProgress?.({
                percentage: progressPercentage,
                phase: start.startedImmediately
                    ? `Daemon indexing in progress... ${progressPercentage.toFixed(1)}%`
                    : `Queued or indexing in daemon... ${progressPercentage.toFixed(1)}%`,
                current: Math.round(progressPercentage),
                total: 100
            });

            await delay(STATUS_POLL_INTERVAL_MS);
        }
    }

    public async clearIndex(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<void> {
        onProgress?.({
            percentage: 0,
            phase: 'Requesting daemon index cleanup...',
            current: 0,
            total: 100
        });
        await this.callTool('clear_index', { path: codebasePath });
        onProgress?.({
            percentage: 100,
            phase: 'Daemon index cleanup complete.',
            current: 100,
            total: 100
        });
    }

    public async syncCodebase(
        _codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendSyncResult> {
        onProgress?.({
            percentage: 100,
            phase: 'Daemon manages background sync automatically.',
            current: 100,
            total: 100
        });

        return {
            mode: this.mode,
            added: 0,
            removed: 0,
            modified: 0,
            daemonManaged: true,
            message: 'Daemon manages background sync automatically.'
        };
    }

    public getPreferredSplitterType(): BackendSplitterType {
        const splitterConfig = this.configManager.getSplitterConfig();
        return splitterConfig?.type === SplitterType.LANGCHAIN ? 'langchain' : 'ast';
    }

    private async callTool(name: string, args: Record<string, any>): Promise<McpToolResult> {
        const discovery = await readExtensionDaemonDiscoveryConfig(true);
        if (!discovery) {
            throw new Error(
                'No active compatible daemon was found. Start the daemon first or switch the extension runtime mode to embedded.'
            );
        }

        const transport = new StreamableHTTPClientTransport(new URL(discovery.endpointUrl), {
            requestInit: {
                headers: {
                    Authorization: `Bearer ${discovery.bearerToken}`
                }
            }
        });
        const client = new Client({
            name: CLIENT_NAME,
            version: CLIENT_VERSION
        });

        await client.connect(transport);

        try {
            const result = await client.callTool({
                name,
                arguments: args
            }) as McpToolResult;

            if (result.isError) {
                throw new Error(extractToolText(result) || `Daemon tool '${name}' failed.`);
            }

            return result;
        } finally {
            await client.close().catch(() => undefined);
            await transport.close().catch(() => undefined);
        }
    }

    private requireStructuredContent<T>(result: McpToolResult, toolName: string): T {
        if (!result.structuredContent || typeof result.structuredContent !== 'object') {
            throw new Error(
                `Daemon tool '${toolName}' did not return structured content expected by the VS Code client.`
            );
        }

        return result.structuredContent as T;
    }
}
