import {
    AstCodeSplitter,
    Context,
    envManager,
    FileSynchronizer,
    LangChainCodeSplitter,
    MilvusRestfulVectorDatabase,
    SemanticSearchResult,
    SplitterType,
} from '@zilliz/claude-context-core';
import { ConfigManager } from '../config/configManager';
import {
    BackendIndexResult,
    BackendIndexStatus,
    BackendProgressInfo,
    BackendSyncResult,
    CodeSearchBackend
} from './types';

function buildFilterExpression(fileExtensions: string[] = []): string | undefined {
    if (fileExtensions.length === 0) {
        return undefined;
    }

    const invalid = fileExtensions.filter((extension) => !(extension.startsWith('.') && extension.length > 1 && !/\s/.test(extension)));
    if (invalid.length > 0) {
        throw new Error(`Invalid extensions: ${invalid.join(', ')}. Use proper extensions like '.ts', '.py'.`);
    }

    const quoted = fileExtensions.map((extension) => `'${extension}'`).join(',');
    return `fileExtension in [${quoted}]`;
}

function createContextWithConfig(configManager: ConfigManager): Context {
    const embeddingConfig = configManager.getEmbeddingProviderConfig();
    const milvusConfig = configManager.getMilvusFullConfig();
    const splitterConfig = configManager.getSplitterConfig();

    let embedding;
    let vectorDatabase;

    const contextConfig: any = {};

    if (embeddingConfig) {
        embedding = ConfigManager.createEmbeddingInstance(embeddingConfig.provider, embeddingConfig.config);
        contextConfig.embedding = embedding;
    }

    if (milvusConfig) {
        vectorDatabase = new MilvusRestfulVectorDatabase(milvusConfig);
        contextConfig.vectorDatabase = vectorDatabase;
    } else {
        vectorDatabase = new MilvusRestfulVectorDatabase({
            address: envManager.get('MILVUS_ADDRESS') || 'http://localhost:19530',
            token: envManager.get('MILVUS_TOKEN') || ''
        });
        contextConfig.vectorDatabase = vectorDatabase;
    }

    let codeSplitter;
    if (splitterConfig) {
        if (splitterConfig.type === SplitterType.LANGCHAIN) {
            codeSplitter = new LangChainCodeSplitter(
                splitterConfig.chunkSize ?? 1000,
                splitterConfig.chunkOverlap ?? 200
            );
        } else {
            codeSplitter = new AstCodeSplitter(
                splitterConfig.chunkSize ?? 2500,
                splitterConfig.chunkOverlap ?? 300
            );
        }
    } else {
        codeSplitter = new AstCodeSplitter(2500, 300);
    }

    contextConfig.codeSplitter = codeSplitter;
    return new Context(contextConfig);
}

export class EmbeddedCodeSearchBackend implements CodeSearchBackend {
    public readonly mode = 'embedded' as const;
    private context: Context | null = null;

    constructor(private readonly configManager: ConfigManager) {}

    private ensureContext(): Context {
        if (!this.context) {
            this.context = createContextWithConfig(this.configManager);
        }

        return this.context;
    }

    public async hasIndex(codebasePath: string): Promise<boolean> {
        try {
            return await this.ensureContext().hasIndex(codebasePath);
        } catch {
            return false;
        }
    }

    public async getIndexStatus(codebasePath: string): Promise<BackendIndexStatus> {
        const hasIndex = await this.hasIndex(codebasePath);
        return {
            path: codebasePath,
            status: hasIndex ? 'indexed' : 'not_found'
        };
    }

    public async search(
        codebasePath: string,
        searchTerm: string,
        limit: number,
        fileExtensions: string[] = []
    ): Promise<SemanticSearchResult[]> {
        const filterExpr = buildFilterExpression(fileExtensions);
        return this.ensureContext().semanticSearch(
            codebasePath,
            searchTerm,
            limit,
            0.3,
            filterExpr
        );
    }

    public async indexCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendIndexResult> {
        const context = this.ensureContext();

        await context.clearIndex(codebasePath, (progress) => {
            onProgress?.({
                percentage: 0,
                phase: progress.phase,
                current: 0,
                total: 100
            });
        });

        onProgress?.({
            percentage: 0,
            phase: 'Initializing file synchronizer...',
            current: 0,
            total: 100
        });

        const synchronizer = new FileSynchronizer(
            codebasePath,
            context.getIgnorePatterns(codebasePath) || []
        );
        await synchronizer.initialize();
        await context.getPreparedCollection(codebasePath);
        context.setSynchronizerForCodebase(codebasePath, synchronizer);

        const stats = await context.indexCodebase(
            codebasePath,
            (progress) => {
                onProgress?.({
                    percentage: progress.percentage,
                    phase: progress.phase,
                    current: progress.current,
                    total: progress.total
                });
            }
        );

        return {
            mode: this.mode,
            indexedFiles: stats.indexedFiles,
            totalChunks: stats.totalChunks,
            status: stats.status,
            startedImmediately: true,
            queuePosition: 0
        };
    }

    public async clearIndex(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<void> {
        await this.ensureContext().clearIndex(codebasePath, (progress) => {
            onProgress?.({
                percentage: progress.percentage,
                phase: progress.phase,
                current: progress.current,
                total: progress.total
            });
        });
    }

    public async syncCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendSyncResult> {
        const stats = await this.ensureContext().reindexByChange(
            codebasePath,
            (progress) => {
                onProgress?.({
                    percentage: progress.percentage,
                    phase: progress.phase,
                    current: progress.current,
                    total: progress.total
                });
            }
        );

        return {
            mode: this.mode,
            added: stats.added,
            removed: stats.removed,
            modified: stats.modified
        };
    }
}
