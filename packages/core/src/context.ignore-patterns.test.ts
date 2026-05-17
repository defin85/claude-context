import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    Context,
    Embedding,
    EmbeddingVector,
    FileSynchronizer,
    Splitter,
    CodeChunk,
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './index';

class TestEmbedding extends Embedding {
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
        return 'test';
    }
}

class TestSplitter implements Splitter {
    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [
            {
                content: code,
                metadata: {
                    startLine: 1,
                    endLine: Math.max(1, code.split('\n').length),
                    language,
                    filePath,
                },
            },
        ];
    }

    setChunkSize(): void {}
    setChunkOverlap(): void {}
}

class TestVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    documents = new Map<string, VectorDocument[]>();
    searchResults: VectorSearchResult[] = [];

    async createCollection(collectionName: string): Promise<void> {
        this.collections.add(collectionName);
        this.documents.set(collectionName, []);
    }

    async createHybridCollection(collectionName: string): Promise<void> {
        await this.createCollection(collectionName);
    }

    async dropCollection(collectionName: string): Promise<void> {
        this.collections.delete(collectionName);
        this.documents.delete(collectionName);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        return this.collections.has(collectionName);
    }

    async listCollections(): Promise<string[]> {
        return [...this.collections];
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        this.documents.set(collectionName, [
            ...(this.documents.get(collectionName) || []),
            ...documents,
        ]);
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.insert(collectionName, documents);
    }

    async search(): Promise<VectorSearchResult[]> {
        return this.searchResults;
    }

    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        return this.searchResults;
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        const current = this.documents.get(collectionName) || [];
        this.documents.set(
            collectionName,
            current.filter((document) => !ids.includes(document.id)),
        );
    }

    async query(collectionName: string): Promise<Record<string, any>[]> {
        return (this.documents.get(collectionName) || []).slice(0, 1);
    }

    async getCollectionDescription(): Promise<string> {
        return '';
    }

    async checkCollectionLimit(): Promise<boolean> {
        return true;
    }

    async getCollectionRowCount(collectionName: string): Promise<number> {
        return this.documents.get(collectionName)?.length ?? -1;
    }
}

function createContext(vectorDatabase = new TestVectorDatabase()): Context {
    return new Context({
        embedding: new TestEmbedding(),
        vectorDatabase,
        codeSplitter: new TestSplitter(),
    });
}

async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-core-'));
}

describe('Context per-codebase options and ignore handling', () => {
    const originalHybridMode = process.env.HYBRID_MODE;

    beforeEach(() => {
        process.env.HYBRID_MODE = 'false';
    });

    afterEach(() => {
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }
    });

    test('custom extensions and ignore patterns stay scoped to one codebase', async () => {
        const context = createContext();
        const projectA = await makeTempDir();
        const projectB = await makeTempDir();

        context.configureCodebaseSession(projectA, {
            customExtensions: ['foo'],
            customIgnorePatterns: ['*.txt'],
        });

        expect(context.getSupportedExtensions(projectA)).toContain('.foo');
        expect(context.getIgnorePatterns(projectA)).toContain('*.txt');
        expect(context.getSupportedExtensions(projectB)).not.toContain('.foo');
        expect(context.getIgnorePatterns(projectB)).not.toContain('*.txt');
    });

    test('custom extension indexing does not leak into other codebases', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const projectA = await makeTempDir();
        const projectB = await makeTempDir();

        await fs.writeFile(path.join(projectA, 'custom.foo'), 'custom code');
        await fs.writeFile(path.join(projectB, 'custom.foo'), 'custom code');

        context.configureCodebaseSession(projectA, { customExtensions: ['foo'] });
        await context.indexCodebase(projectA, undefined, true);
        await context.indexCodebase(projectB, undefined, true);

        expect(
            vectorDatabase.documents.get(context.getCollectionName(projectA)) || [],
        ).toHaveLength(1);
        expect(
            vectorDatabase.documents.get(context.getCollectionName(projectB)) || [],
        ).toHaveLength(0);
    });

    test('root anchored directory ignore patterns only match the codebase root', async () => {
        const context = createContext();
        const project = await makeTempDir();
        await fs.mkdir(path.join(project, 'Library'), { recursive: true });
        await fs.mkdir(path.join(project, 'src', 'Library'), { recursive: true });
        await fs.writeFile(path.join(project, 'Library', 'root.ts'), 'root');
        await fs.writeFile(path.join(project, 'src', 'Library', 'nested.ts'), 'nested');

        context.configureCodebaseSession(project, { customIgnorePatterns: ['/Library/'] });
        const session = (context as any).getOrCreateCodebaseSession(project);
        const files = await (context as any).getCodeFiles(project, session);
        const relativeFiles = files.map((file: string) => path.relative(project, file).replace(/\\/g, '/'));

        expect(relativeFiles).not.toContain('Library/root.ts');
        expect(relativeFiles).toContain('src/Library/nested.ts');
    });

    test('FileSynchronizer only tracks supported extensions', async () => {
        const project = await makeTempDir();
        await fs.writeFile(path.join(project, 'tracked.ts'), 'tracked');
        await fs.writeFile(path.join(project, 'ignored.txt'), 'ignored');

        const synchronizer = new FileSynchronizer(project, [], ['.ts']);
        const fileHashes = await (synchronizer as any).generateFileHashes(project);

        expect([...fileHashes.keys()]).toEqual(['tracked.ts']);
    });

    test('semantic search deduplicates overlapping results', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();
        const collectionName = context.getCollectionName(project);
        vectorDatabase.collections.add(collectionName);
        vectorDatabase.searchResults = [
            {
                document: {
                    id: 'first',
                    vector: [1, 0, 0],
                    content: 'first',
                    relativePath: 'src/a.ts',
                    startLine: 1,
                    endLine: 10,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.9,
            },
            {
                document: {
                    id: 'overlap',
                    vector: [1, 0, 0],
                    content: 'overlap',
                    relativePath: 'src/a.ts',
                    startLine: 2,
                    endLine: 9,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.8,
            },
            {
                document: {
                    id: 'other',
                    vector: [1, 0, 0],
                    content: 'other',
                    relativePath: 'src/b.ts',
                    startLine: 1,
                    endLine: 2,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.7,
            },
        ];

        const results = await context.semanticSearch(project, 'query', 5);

        expect(results.map((result) => result.content)).toEqual(['first', 'other']);
    });
});
