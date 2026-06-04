import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    Context,
    Embedding,
    EmbeddingVector,
    FileSynchronizer,
    traversePreIndex,
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

    async createBgeM3Collection(collectionName: string): Promise<void> {
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

    async insertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
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

    async bgeM3HybridSearch(
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

async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
}

describe('Context per-codebase options and ignore handling', () => {
    const originalHybridMode = process.env.HYBRID_MODE;
    const originalCodeChunkLimit = process.env.CODE_CHUNK_LIMIT;

    beforeEach(() => {
        process.env.HYBRID_MODE = 'false';
        delete process.env.CODE_CHUNK_LIMIT;
    });

    afterEach(() => {
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }

        if (originalCodeChunkLimit === undefined) {
            delete process.env.CODE_CHUNK_LIMIT;
        } else {
            process.env.CODE_CHUNK_LIMIT = originalCodeChunkLimit;
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

    test('CODE_CHUNK_LIMIT stops indexing at the configured chunk count', async () => {
        process.env.CODE_CHUNK_LIMIT = '2';

        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();

        await fs.writeFile(path.join(project, 'first.ts'), 'first');
        await fs.writeFile(path.join(project, 'second.ts'), 'second');
        await fs.writeFile(path.join(project, 'third.ts'), 'third');

        const stats = await context.indexCodebase(project, undefined, true);

        expect(stats.status).toBe('limit_reached');
        expect(stats.totalChunks).toBe(2);
        expect(
            vectorDatabase.documents.get(context.getCollectionName(project)) || [],
        ).toHaveLength(2);
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

    test('pre-index traversal preserves supported file selection semantics on fixture paths', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/index.ts', 'index');
        await writeFixtureFile(project, 'src/nested/component.js', 'component');
        await writeFixtureFile(project, 'src/nested/component.spec.ts', 'spec');
        await writeFixtureFile(project, '.hidden/secret.ts', 'secret');
        await writeFixtureFile(project, 'Library/root.ts', 'root');
        await writeFixtureFile(project, 'src/Library/nested.ts', 'nested library');
        await writeFixtureFile(project, 'build/generated.ts', 'generated');
        await writeFixtureFile(project, 'notes.txt', 'notes');
        await fs.mkdir(path.join(project, 'unreadable'), { recursive: true });
        await fs.chmod(path.join(project, 'unreadable'), 0o000);

        try {
            const traversal = await traversePreIndex(project, {
                supportedExtensions: ['.ts', '.js'],
                ignorePatterns: ['/Library/', 'build/', '*.spec.ts'],
                includeHashes: true,
                concurrency: 2,
            });

            expect(traversal.files.map((file) => file.relativePath)).toEqual([
                'src/Library/nested.ts',
                'src/index.ts',
                'src/nested/component.js',
            ]);
            expect(traversal.files.every((file) => typeof file.hash === 'string')).toBe(true);
            expect(traversal.selectedFileCount).toBe(3);
            expect(traversal.hashedFileCount).toBe(3);
            expect(traversal.timings.totalMs).toBeGreaterThanOrEqual(0);
        } finally {
            await fs.chmod(path.join(project, 'unreadable'), 0o700).catch(() => undefined);
        }
    });

    test('pre-index traversal matches sequential synchronizer hashes for compatibility', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/a.ts', 'a');
        await writeFixtureFile(project, 'src/b.js', 'b');
        await writeFixtureFile(project, 'src/b.spec.ts', 'ignored');
        await writeFixtureFile(project, 'tmp/c.ts', 'ignored dir');
        await writeFixtureFile(project, 'README.md', 'readme');

        const ignorePatterns = ['tmp/', '*.spec.ts'];
        const supportedExtensions = ['.ts', '.js', '.md'];
        const synchronizer = new FileSynchronizer(project, ignorePatterns, supportedExtensions);
        const sequentialHashes = await (synchronizer as any).generateFileHashes(project);
        const traversal = await traversePreIndex(project, {
            ignorePatterns,
            supportedExtensions,
            includeHashes: true,
            concurrency: 1,
        });

        expect(new Map(traversal.files.map((file) => [file.relativePath, file.hash]))).toEqual(sequentialHashes);
    });

    test('pre-index traversal bounds concurrent file hashing within one directory', async () => {
        const project = await makeTempDir();
        await Promise.all([0, 1, 2, 3].map((item) =>
            writeFixtureFile(project, `file${item}.ts`, `export const value${item} = ${item};`),
        ));
        let activeReads = 0;
        let maxActiveReads = 0;
        await traversePreIndex(project, {
            supportedExtensions: ['.ts'],
            includeHashes: true,
            concurrency: 2,
            readFile: async (filePath: string) => {
                activeReads++;
                maxActiveReads = Math.max(maxActiveReads, activeReads);
                try {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    return await fs.readFile(filePath, 'utf-8');
                } finally {
                    activeReads--;
                }
            },
        });

        expect(maxActiveReads).toBe(2);
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
