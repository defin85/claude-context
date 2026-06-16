import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    CodeChunk,
    Context,
    Embedding,
    EmbeddingVector,
    MultiVectorEmbedding,
    Splitter,
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './index';

class DenseEmbedding extends Embedding {
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
        return 'OpenAI';
    }
}

class BgeM3FullEmbedding extends DenseEmbedding {
    getProvider(): string {
        return 'BGE_M3';
    }

    getMode(): string {
        return 'full';
    }

    async embedMulti(): Promise<MultiVectorEmbedding> {
        return {
            dense: { vector: [1, 0, 0], dimension: 3 },
            sparse: { indices: [4, 8], values: [0.4, 0.8] },
            colbert: {
                vectors: [[1, 0]],
                dimension: 2,
                tokenCount: 1,
            },
        };
    }

    async embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]> {
        return texts.map(() => ({
            dense: { vector: [1, 0, 0], dimension: 3 },
            sparse: { indices: [4, 8], values: [0.4, 0.8] },
            colbert: {
                vectors: [[0.1, 0.2], [0.3, 0.4]],
                dimension: 2,
                tokenCount: 2,
            },
        }));
    }
}

class TestVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    collectionDescriptions = new Map<string, string>();
    bgeM3Collections: Array<{ collectionName: string; dimension: number; description?: string }> = [];
    bgeM3Documents: VectorDocument[] = [];
    bgeM3SearchRequests: HybridSearchRequest[] = [];
    bgeM3SearchOptions: HybridSearchOptions | undefined;
    bgeM3SearchResults: HybridSearchResult[] = [];

    async createCollection(collectionName: string): Promise<void> {
        this.collections.add(collectionName);
    }

    async createHybridCollection(collectionName: string): Promise<void> {
        this.collections.add(collectionName);
    }

    async createBgeM3Collection(collectionName: string, dimension: number, description?: string): Promise<void> {
        this.collections.add(collectionName);
        if (description) {
            this.collectionDescriptions.set(collectionName, description);
        }
        this.bgeM3Collections.push({ collectionName, dimension, description });
    }

    async dropCollection(collectionName: string): Promise<void> {
        this.collections.delete(collectionName);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        return this.collections.has(collectionName);
    }

    async listCollections(): Promise<string[]> {
        return [...this.collections];
    }

    async insert(): Promise<void> {}
    async insertHybrid(): Promise<void> {}
    async insertBgeM3(_collectionName: string, documents: VectorDocument[]): Promise<void> {
        this.bgeM3Documents.push(...documents);
    }
    async search(): Promise<VectorSearchResult[]> { return []; }
    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> { return []; }
    async bgeM3HybridSearch(
        _collectionName: string,
        searchRequests: HybridSearchRequest[],
        options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        this.bgeM3SearchRequests = searchRequests;
        this.bgeM3SearchOptions = options;
        return this.bgeM3SearchResults;
    }
    async delete(): Promise<void> {}
    async query(): Promise<Record<string, any>[]> { return []; }
    async getCollectionDescription(collectionName: string): Promise<string> {
        return this.collectionDescriptions.get(collectionName) || '';
    }
    async checkCollectionLimit(): Promise<boolean> { return true; }
    async getCollectionRowCount(): Promise<number> { return -1; }
}

class SingleChunkSplitter implements Splitter {
    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [{
            content: code,
            metadata: {
                startLine: 1,
                endLine: 1,
                language,
                filePath,
            },
        }];
    }

    setChunkSize(): void {}
    setChunkOverlap(): void {}
}

describe('Context retrieval modes', () => {
    const originalHybridMode = process.env.HYBRID_MODE;

    afterEach(() => {
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }
    });

    it('uses a distinct collection namespace for BGE-M3 full retrieval', () => {
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase: new TestVectorDatabase(),
        });

        const collectionName = context.getCollectionName('/tmp/example');
        const sessionConfig = context.configureCodebaseSession('/tmp/example');

        expect(collectionName).toMatch(/^bge_m3_code_chunks_[0-9a-f]{8}$/);
        expect(collectionName.startsWith('code_chunks_')).toBe(false);
        expect(collectionName.startsWith('hybrid_code_chunks_')).toBe(false);
        expect(sessionConfig.retrievalMode).toBe('bge_m3_full');
        expect(sessionConfig.retrievalSchemaVersion).toBe(1);
    });

    it('persists configured BGE-M3 fast profile as dense-only retrieval metadata', () => {
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase: new TestVectorDatabase(),
        });

        const sessionConfig = context.configureCodebaseSession('/tmp/example', {
            retrievalProfile: 'fast',
        });

        expect(context.getCollectionName('/tmp/example')).toMatch(/^bge_m3_dense_code_chunks_[0-9a-f]{8}$/);
        expect(sessionConfig.retrievalProfile).toBe('fast');
        expect(sessionConfig.retrievalMode).toBe('bge_m3_dense');
        expect(sessionConfig.retrievalSchemaVersion).toBe(1);
    });

    it('search uses persisted retrieval profile rather than the current default mode', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });
        context.configureCodebaseSession('/tmp/example', {
            retrievalProfile: 'fast',
            retrievalMode: 'bge_m3_dense',
            retrievalSchemaVersion: 1,
        });
        const collectionName = context.getCollectionName('/tmp/example');
        vectorDatabase.collections.add(collectionName);

        await context.semanticSearch('/tmp/example', 'query', 2);

        expect(collectionName).toMatch(/^bge_m3_dense_code_chunks_/);
        expect(vectorDatabase.bgeM3SearchRequests).toHaveLength(0);
    });

    it('infers legacy persisted retrieval mode before applying the current default profile', () => {
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase: new TestVectorDatabase(),
            retrievalProfile: 'fast',
        });

        const sessionConfig = context.configureCodebaseSession('/tmp/example', {
            retrievalMode: 'bge_m3_full',
            retrievalSchemaVersion: 1,
        });

        expect(sessionConfig.retrievalProfile).toBe('quality');
        expect(sessionConfig.retrievalMode).toBe('bge_m3_full');
        expect(sessionConfig.retrievalSchemaVersion).toBe(1);
        expect(context.getCollectionName('/tmp/example')).toMatch(/^bge_m3_code_chunks_/);
    });

    it('requires force reindex when a BM25 hybrid index already exists for BGE-M3 full mode', async () => {
        process.env.HYBRID_MODE = 'true';
        const vectorDatabase = new TestVectorDatabase();
        const denseContext = new Context({
            embedding: new DenseEmbedding(),
            vectorDatabase,
        });
        const oldCollectionName = denseContext.getCollectionName('/tmp/example');
        vectorDatabase.collections.add(oldCollectionName);

        const bgeContext = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });

        await expect(bgeContext.getPreparedCollection('/tmp/example')).rejects.toThrow(
            'requires explicit reindexing',
        );
    });

    it('allows force preparation when switching from BM25 hybrid to BGE-M3 full mode', async () => {
        process.env.HYBRID_MODE = 'true';
        const vectorDatabase = new TestVectorDatabase();
        const denseContext = new Context({
            embedding: new DenseEmbedding(),
            vectorDatabase,
        });
        vectorDatabase.collections.add(denseContext.getCollectionName('/tmp/example'));

        const bgeContext = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });

        await bgeContext.getPreparedCollection('/tmp/example', true);

        expect(vectorDatabase.bgeM3Collections).toHaveLength(1);
        expect(vectorDatabase.bgeM3Collections[0].collectionName).toMatch(/^bge_m3_code_chunks_/);
    });

    it('creates and inserts BGE-M3 full documents with model sparse and ColBERT vectors', async () => {
        const codebasePath = await fs.mkdtemp(path.join(os.tmpdir(), 'bge-m3-context-'));
        await fs.writeFile(path.join(codebasePath, 'index.ts'), 'export const answer = 42;\n');
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
            codeSplitter: new SingleChunkSplitter(),
        });

        await context.indexCodebase(codebasePath, undefined, true);

        expect(vectorDatabase.bgeM3Collections).toHaveLength(1);
        expect(vectorDatabase.bgeM3Collections[0].collectionName).toMatch(/^bge_m3_code_chunks_/);
        expect(vectorDatabase.bgeM3Collections[0].description).toContain(`codebasePath:${codebasePath}`);
        expect(vectorDatabase.bgeM3Collections[0].description).toContain('retrievalMode:bge_m3_full');
        expect(vectorDatabase.bgeM3Collections[0].description).toContain('retrievalSchemaVersion:1');
        expect(vectorDatabase.bgeM3Documents).toHaveLength(1);
        expect(vectorDatabase.bgeM3Documents[0].sparseVector).toEqual({
            indices: [4, 8],
            values: [0.4, 0.8],
        });
        expect(vectorDatabase.bgeM3Documents[0].colbertVectors).toEqual([
            [0.1, 0.2],
            [0.3, 0.4],
        ]);
    });

    it('requires force reindex when an existing BGE-M3 full collection lacks schema metadata', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });
        const collectionName = context.getCollectionName('/tmp/example');
        vectorDatabase.collections.add(collectionName);
        vectorDatabase.collectionDescriptions.set(collectionName, 'codebasePath:/tmp/example');

        await expect(context.getPreparedCollection('/tmp/example')).rejects.toThrow(
            'incompatible BGE-M3 collection metadata',
        );
    });

    it('uses configured BGE-M3 candidate limit as an upper bound before reranking', async () => {
        const previousLimit = process.env.BGE_M3_CANDIDATE_LIMIT;
        process.env.BGE_M3_CANDIDATE_LIMIT = '1';
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });
        const collectionName = context.getCollectionName('/tmp/example');
        vectorDatabase.collections.add(collectionName);
        vectorDatabase.collectionDescriptions.set(
            collectionName,
            'codebasePath:/tmp/example\nretrievalMode:bge_m3_full\nretrievalSchemaVersion:1',
        );

        try {
            await context.semanticSearch('/tmp/example', 'query', 5);

            expect(vectorDatabase.bgeM3SearchRequests[0].limit).toBe(1);
            expect(vectorDatabase.bgeM3SearchRequests[1].limit).toBe(1);
            expect(vectorDatabase.bgeM3SearchOptions?.limit).toBe(1);
        } finally {
            if (previousLimit === undefined) {
                delete process.env.BGE_M3_CANDIDATE_LIMIT;
            } else {
                process.env.BGE_M3_CANDIDATE_LIMIT = previousLimit;
            }
        }
    });

    it('caps stored BGE-M3 ColBERT token vectors for Milvus payload size', async () => {
        const previousLimit = process.env.BGE_M3_COLBERT_TOKEN_LIMIT;
        process.env.BGE_M3_COLBERT_TOKEN_LIMIT = '1';
        const codebasePath = await fs.mkdtemp(path.join(os.tmpdir(), 'bge-m3-colbert-cap-'));
        await fs.writeFile(path.join(codebasePath, 'index.ts'), 'export const answer = 42;\n');

        try {
            const vectorDatabase = new TestVectorDatabase();
            const context = new Context({
                embedding: new BgeM3FullEmbedding(),
                vectorDatabase,
                codeSplitter: new SingleChunkSplitter(),
            });

            await context.indexCodebase(codebasePath, undefined, true);

            expect(vectorDatabase.bgeM3Documents[0].colbertVectors).toEqual([
                [0.1, 0.2],
            ]);
        } finally {
            if (previousLimit === undefined) {
                delete process.env.BGE_M3_COLBERT_TOKEN_LIMIT;
            } else {
                process.env.BGE_M3_COLBERT_TOKEN_LIMIT = previousLimit;
            }
        }
    });

    it('searches BGE-M3 full collections with model sparse vectors and ColBERT reranking', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });
        const collectionName = context.getCollectionName('/tmp/example');
        vectorDatabase.collections.add(collectionName);
        vectorDatabase.bgeM3SearchResults = [
            {
                document: {
                    id: 'first-stage-winner',
                    content: 'wrong candidate',
                    vector: [],
                    sparseVector: { indices: [1], values: [1] },
                    colbertVectors: [[0, 1]],
                    relativePath: 'a.ts',
                    startLine: 1,
                    endLine: 1,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.9,
            },
            {
                document: {
                    id: 'colbert-winner',
                    content: 'right candidate',
                    vector: [],
                    sparseVector: { indices: [1], values: [1] },
                    colbertVectors: [[1, 0]],
                    relativePath: 'b.ts',
                    startLine: 2,
                    endLine: 2,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.1,
            },
        ];

        const results = await context.semanticSearch('/tmp/example', 'query', 2);

        expect(vectorDatabase.bgeM3SearchRequests[0]).toEqual(expect.objectContaining({
            anns_field: 'dense_vector',
            data: [1, 0, 0],
        }));
        expect(vectorDatabase.bgeM3SearchRequests[1]).toEqual(expect.objectContaining({
            anns_field: 'sparse_vector',
            data: { indices: [4, 8], values: [0.4, 0.8] },
        }));
        expect(results[0].relativePath).toBe('b.ts');
        expect(results[0].metadata?.rerank).toEqual(expect.objectContaining({
            applied: true,
            strategy: 'colbert_maxsim',
        }));
    });

    it('fails clearly when BGE-M3 full candidates are missing ColBERT vectors', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });
        vectorDatabase.collections.add(context.getCollectionName('/tmp/example'));
        vectorDatabase.bgeM3SearchResults = [{
            document: {
                id: 'corrupt-candidate',
                content: 'missing colbert',
                vector: [],
                relativePath: 'a.ts',
                startLine: 1,
                endLine: 1,
                fileExtension: '.ts',
                metadata: { language: 'typescript' },
            },
            score: 0.9,
        }];

        await expect(context.semanticSearch('/tmp/example', 'query', 1)).rejects.toThrow(
            "BGE-M3 full retrieval candidate 'corrupt-candidate' is missing ColBERT vectors. Clear or force reindex the collection if the stored vectors are missing; otherwise verify that the vector backend returns stored ColBERT vectors for rerank.",
        );
    });

    it('fails clearly when BGE-M3 full candidates belong to another codebase', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new BgeM3FullEmbedding(),
            vectorDatabase,
        });
        vectorDatabase.collections.add(context.getCollectionName('/tmp/example'));
        vectorDatabase.bgeM3SearchResults = [{
            document: {
                id: 'foreign-candidate',
                content: 'wrong codebase',
                vector: [],
                colbertVectors: [[1, 0]],
                relativePath: 'foreign.ts',
                startLine: 1,
                endLine: 1,
                fileExtension: '.ts',
                metadata: {
                    language: 'typescript',
                    codebasePath: '/tmp/other',
                },
            },
            score: 0.9,
        }];

        await expect(context.semanticSearch('/tmp/example', 'query', 1)).rejects.toThrow(
            "BGE-M3 full retrieval candidate 'foreign-candidate' belongs to '/tmp/other', not '/tmp/example'. Clear the vector collection or force reindex the target codebase.",
        );
    });
});
