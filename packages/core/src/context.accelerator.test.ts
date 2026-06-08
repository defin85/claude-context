import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context, IndexAbortError } from './context';
import { Embedding, EmbeddingVector, MultiVectorEmbedding } from './embedding';
import { IndexingAcceleratorSnapshot, IndexingAcceleratorWorkerSnapshot } from './indexing-accelerator';
import { Splitter, CodeChunk } from './splitter';
import {
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './vectordb';

class DelayedEmbedding extends Embedding {
    protected maxTokens = 8192;
    private active = 0;
    maxActive = 0;

    constructor(
        private readonly delayMs: number,
        private readonly onBatchStart?: () => void,
    ) {
        super();
    }

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        this.active++;
        this.maxActive = Math.max(this.maxActive, this.active);
        this.onBatchStart?.();
        try {
            await new Promise((resolve) => setTimeout(resolve, this.delayMs));
            return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
        } finally {
            this.active--;
        }
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'test';
    }
}

class DelayedBgeM3Embedding extends Embedding {
    protected maxTokens = 8192;
    private active = 0;
    maxActive = 0;
    shouldRetryWorkerPool = false;
    workerSnapshots: IndexingAcceleratorWorkerSnapshot[] = [
        {
            endpoint: 'http://127.0.0.1:8000',
            healthy: true,
            inFlight: 0,
            lastSuccessAt: '2026-06-04T00:00:00.000Z',
            recoveryAttempts: 0,
            poolState: 'accepted' as const,
        },
    ];

    constructor(private readonly delayMs: number) {
        super();
    }

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const embeddings = await this.embedMultiBatch(texts);
        return embeddings.map((embedding) => embedding.dense);
    }

    async embedMulti(): Promise<MultiVectorEmbedding> {
        return (await this.embedMultiBatch(['one']))[0];
    }

    async embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]> {
        this.active++;
        this.maxActive = Math.max(this.maxActive, this.active);
        try {
            await new Promise((resolve) => setTimeout(resolve, this.delayMs));
            return texts.map(() => ({
                dense: { vector: [1, 0, 0], dimension: 3 },
                sparse: { indices: [1, 2], values: [0.5, 0.25] },
                colbert: {
                    vectors: [[0.1, 0.2], [0.3, 0.4]],
                    dimension: 2,
                    tokenCount: 2,
                },
            }));
        } finally {
            this.active--;
        }
    }

    async embedMultiBatchWithWorkerPool(
        texts: string[],
        onRetry?: () => void,
    ): Promise<MultiVectorEmbedding[]> {
        if (this.shouldRetryWorkerPool) {
            this.shouldRetryWorkerPool = false;
            onRetry?.();
        }
        return this.embedMultiBatch(texts);
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'BGE_M3';
    }

    getMode(): string {
        return 'full';
    }

    getWorkerSnapshot() {
        return this.workerSnapshots;
    }
}

class OneChunkSplitter implements Splitter {
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

class DuplicateChunkSplitter implements Splitter {
    constructor(private readonly chunkCount: number) {}

    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return Array.from({ length: this.chunkCount }, () => ({
            content: code,
            metadata: {
                startLine: 1,
                endLine: 1,
                language,
                filePath,
            },
        }));
    }

    setChunkSize(): void {}
    setChunkOverlap(): void {}
}

class TrackingVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    documents = new Map<string, VectorDocument[]>();
    insertDelayMs = 0;
    private activeInserts = 0;
    maxActiveInserts = 0;

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
        this.activeInserts++;
        this.maxActiveInserts = Math.max(this.maxActiveInserts, this.activeInserts);
        try {
            if (this.insertDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, this.insertDelayMs));
            }
            this.documents.set(collectionName, [
                ...(this.documents.get(collectionName) || []),
                ...documents,
            ]);
        } finally {
            this.activeInserts--;
        }
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.insert(collectionName, documents);
    }

    async insertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.insert(collectionName, documents);
    }

    async upsertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.insert(collectionName, documents);
    }

    async search(): Promise<VectorSearchResult[]> {
        return [];
    }

    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        return [];
    }

    async bgeM3HybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        return [];
    }

    async delete(): Promise<void> {}
    async query(): Promise<Record<string, any>[]> { return []; }
    async getCollectionDescription(): Promise<string> { return ''; }
    async checkCollectionLimit(): Promise<boolean> { return true; }
    async getCollectionRowCount(collectionName: string): Promise<number> {
        return this.documents.get(collectionName)?.length ?? -1;
    }

    allDocuments(): VectorDocument[] {
        return [...this.documents.values()].flat();
    }
}

describe('Context accelerated batch pipeline', () => {
    const originalEnv: Record<string, string | undefined> = {};
    const envNames = [
        'HYBRID_MODE',
        'EMBEDDING_BATCH_SIZE',
        'INDEX_ACCELERATOR_MODE',
        'INDEX_EMBEDDING_CONCURRENCY',
        'INDEX_INSERT_CONCURRENCY',
        'INDEX_INSERT_QUEUE_CAPACITY',
        'INDEX_ACCELERATE_BACKGROUND_SYNC',
        'BGE_M3_ACCELERATOR_MAX_WORKERS',
    ];

    beforeEach(() => {
        for (const name of envNames) {
            originalEnv[name] = process.env[name];
        }
        process.env.HYBRID_MODE = 'false';
        process.env.EMBEDDING_BATCH_SIZE = '1';
        delete process.env.INDEX_EMBEDDING_CONCURRENCY;
        process.env.INDEX_INSERT_CONCURRENCY = '1';
        delete process.env.INDEX_INSERT_QUEUE_CAPACITY;
        process.env.INDEX_ACCELERATE_BACKGROUND_SYNC = 'false';
        delete process.env.BGE_M3_ACCELERATOR_MAX_WORKERS;
    });

    afterEach(() => {
        for (const name of envNames) {
            if (originalEnv[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = originalEnv[name];
            }
        }
    });

    async function createCodebase(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-accelerator-'));
        await Promise.all([0, 1, 2, 3].map((item) => fs.writeFile(
            path.join(dir, `file${item}.ts`),
            `export const value${item} = ${item};`,
        )));
        return dir;
    }

    async function createSingleFileCodebase(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-accelerator-single-'));
        await fs.writeFile(path.join(dir, 'large.ts'), 'export const repeated = true;');
        return dir;
    }

    it('runs multiple embedding batches concurrently when acceleration is active', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const embedding = new DelayedEmbedding(20);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });
        const codebasePath = await createCodebase();

        await context.indexCodebase(codebasePath);

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.maxActive).toBeGreaterThan(1);
        expect(snapshot.active).toBe(true);
        expect(snapshot.embeddingConcurrency).toBe(2);
        expect(snapshot.submittedBatches).toBe(4);
        expect(snapshot.completedBatches).toBe(4);
        expect(vectorDatabase.allDocuments()).toHaveLength(4);
    });

    it('does not report 100 percent progress before accelerated batches drain', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const context = new Context({
            embedding: new DelayedEmbedding(20),
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        const codebasePath = await createCodebase();
        const progressEvents: Array<{ phase: string; percentage: number }> = [];

        await context.indexCodebase(codebasePath, (progress) => {
            progressEvents.push({
                phase: progress.phase,
                percentage: progress.percentage,
            });
        });

        const finalEventIndex = progressEvents.findIndex((event) => event.phase === 'Indexing complete!');
        expect(finalEventIndex).toBeGreaterThan(-1);
        expect(progressEvents.slice(0, finalEventIndex).some((event) => event.percentage >= 100)).toBe(false);
        expect(progressEvents.some((event) => event.phase.startsWith('Processing embedding batches'))).toBe(true);
        expect(progressEvents[finalEventIndex].percentage).toBe(100);
    });

    it('does not report embedding drain progress before file production completes', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const context = new Context({
            embedding: new DelayedEmbedding(20),
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        const codebasePath = await createCodebase();
        const progressEvents: Array<{ phase: string; percentage: number }> = [];

        await context.indexCodebase(codebasePath, (progress) => {
            progressEvents.push({
                phase: progress.phase,
                percentage: progress.percentage,
            });
        });

        const finalFileEventIndex = progressEvents.findIndex((event) => event.phase === 'Processing files (4/4)...');
        expect(finalFileEventIndex).toBeGreaterThan(-1);
        expect(progressEvents.slice(0, finalFileEventIndex).some((event) => event.phase.startsWith('Processing embedding batches'))).toBe(false);
        expect(progressEvents.slice(finalFileEventIndex + 1).some((event) => event.phase.startsWith('Processing embedding batches'))).toBe(true);
    });

    it('keeps sequential behavior when acceleration is disabled', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'off';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '4';
        const embedding = new DelayedEmbedding(5);
        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        const codebasePath = await createCodebase();

        await context.indexCodebase(codebasePath);

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.maxActive).toBe(1);
        expect(snapshot.active).toBe(false);
        expect(snapshot.fallbackReason).toBe('accelerator disabled');
    });

    it('resets accelerator status during pre-index before an empty run returns', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        const populatedCodebase = await createCodebase();
        const emptyCodebase = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-accelerator-empty-'));

        await context.indexCodebase(populatedCodebase);
        const populatedSnapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(populatedSnapshot.submittedBatches).toBeGreaterThan(0);

        await context.indexCodebase(emptyCodebase);

        const emptySnapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(emptySnapshot.submittedBatches).toBe(0);
        expect(emptySnapshot.completedBatches).toBe(0);
        expect(emptySnapshot.preIndexSelectedFileCount).toBe(0);
        expect(emptySnapshot.preIndexHashedFileCount).toBe(0);
    });

    it('exposes pre-index status before traversal completes', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        const populatedCodebase = await createCodebase();
        const blockedCodebase = await createCodebase();
        await context.indexCodebase(populatedCodebase);
        expect((context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot).submittedBatches).toBeGreaterThan(0);

        let preIndexSnapshot: IndexingAcceleratorSnapshot | undefined;
        await context.indexCodebase(blockedCodebase, (progress) => {
            if (progress.phase === 'Pre-index traversal...') {
                preIndexSnapshot = context.getLastAcceleratorSnapshot();
            }
        });

        expect(preIndexSnapshot?.submittedBatches).toBe(0);
        expect(preIndexSnapshot?.preIndexActive).toBe(true);
        expect(preIndexSnapshot?.preIndexPhase).toBe('traversal');
    });

    it('preserves stable document IDs when accelerated batches complete out of order', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const codebasePath = await createCodebase();
        const acceleratedDb = new TrackingVectorDatabase();
        const sequentialDb = new TrackingVectorDatabase();

        await new Context({
            embedding: new DelayedEmbedding(15),
            vectorDatabase: acceleratedDb,
            codeSplitter: new OneChunkSplitter(),
        }).indexCodebase(codebasePath);

        process.env.INDEX_ACCELERATOR_MODE = 'off';
        await new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase: sequentialDb,
            codeSplitter: new OneChunkSplitter(),
        }).indexCodebase(codebasePath);

        const acceleratedIds = acceleratedDb.allDocuments().map((document) => document.id).sort();
        const sequentialIds = sequentialDb.allDocuments().map((document) => document.id).sort();
        expect(acceleratedIds).toEqual(sequentialIds);
    });

    it('cancels queued accelerated batches and waits for the active batch to settle', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const controller = new AbortController();
        let scheduledAbort = false;
        const embedding = new DelayedEmbedding(30, () => {
            if (!scheduledAbort) {
                scheduledAbort = true;
                setTimeout(() => controller.abort(new IndexAbortError('test cancellation')), 5);
            }
        });
        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        const codebasePath = await createCodebase();

        await expect(context.indexCodebase(codebasePath, undefined, false, controller.signal))
            .rejects
            .toBeInstanceOf(IndexAbortError);

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.failedBatches).toBeGreaterThanOrEqual(0);
        expect(embedding.maxActive).toBeLessThanOrEqual(2);
    });

    it('handles accelerated cancellation without unhandled batch rejections', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.EMBEDDING_BATCH_SIZE = '1';
        const controller = new AbortController();
        let scheduledAbort = false;
        const unhandledRejections: unknown[] = [];
        const onUnhandledRejection = (reason: unknown) => {
            unhandledRejections.push(reason);
        };
        const embedding = new DelayedEmbedding(30, () => {
            if (!scheduledAbort) {
                scheduledAbort = true;
                setTimeout(() => controller.abort(new IndexAbortError('queued cancellation')), 5);
            }
        });
        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new DuplicateChunkSplitter(24),
        });
        const codebasePath = await createSingleFileCodebase();

        process.on('unhandledRejection', onUnhandledRejection);
        try {
            await expect(context.indexCodebase(codebasePath, undefined, false, controller.signal))
                .rejects
                .toBeInstanceOf(IndexAbortError);
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            process.off('unhandledRejection', onUnhandledRejection);
        }

        expect(unhandledRejections).toHaveLength(0);
    });

    it('preserves BGE-M3 full retrieval metadata under reordered batch completion', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const codebasePath = await createCodebase();
        const vectorDatabase = new TrackingVectorDatabase();

        await new Context({
            embedding: new DelayedBgeM3Embedding(10),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        }).indexCodebase(codebasePath);

        const documents = vectorDatabase.allDocuments();
        expect(documents).toHaveLength(4);
        for (const document of documents) {
            expect(document.sparseVector).toEqual({ indices: [1, 2], values: [0.5, 0.25] });
            expect(document.colbertVectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
            expect(document.metadata.retrievalMode).toBe('bge_m3_full');
            expect(document.metadata.retrievalSchemaVersion).toBe(1);
        }
    });

    it('keeps BGE-M3 document IDs unique when a large file emits identical chunks across accelerated upserts', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.EMBEDDING_BATCH_SIZE = '4';
        const duplicateChunkCount = 20;
        const vectorDatabase = new TrackingVectorDatabase();
        const upsertBgeM3 = jest.spyOn(vectorDatabase, 'upsertBgeM3')
            .mockImplementation(async (collectionName, documents) => {
                const ids = documents.map((document) => document.id);
                expect(new Set(ids).size).toBe(ids.length);
                await TrackingVectorDatabase.prototype.upsertBgeM3.call(vectorDatabase, collectionName, documents);
            });

        await new Context({
            embedding: new DelayedBgeM3Embedding(10),
            vectorDatabase,
            codeSplitter: new DuplicateChunkSplitter(duplicateChunkCount),
        }).indexCodebase(await createSingleFileCodebase());

        const documents = vectorDatabase.allDocuments();
        expect(documents).toHaveLength(duplicateChunkCount);
        expect(new Set(documents.map((document) => document.id)).size).toBe(duplicateChunkCount);
        expect(documents.map((document) => document.metadata.chunkIndex)).toEqual(
            Array.from({ length: duplicateChunkCount }, (_, index) => index),
        );
        expect(upsertBgeM3).toHaveBeenCalledTimes(5);
    });

    it('runs parallel BGE-M3 upserts without changing document identity or retrieval metadata', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.INDEX_INSERT_CONCURRENCY = '2';
        process.env.INDEX_INSERT_QUEUE_CAPACITY = '2';
        process.env.EMBEDDING_BATCH_SIZE = '1';
        const vectorDatabase = new TrackingVectorDatabase();
        vectorDatabase.insertDelayMs = 20;
        const codebasePath = await createCodebase();

        const context = new Context({
            embedding: new DelayedBgeM3Embedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });
        await context.indexCodebase(codebasePath);

        const documents = vectorDatabase.allDocuments();
        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(vectorDatabase.maxActiveInserts).toBeGreaterThan(1);
        expect(snapshot.insertConcurrency).toBe(2);
        expect(snapshot.completedInsertBatches).toBe(4);
        expect(snapshot.failedInsertBatches).toBe(0);
        expect(documents).toHaveLength(4);
        expect(new Set(documents.map((document) => document.id)).size).toBe(4);
        for (const document of documents) {
            expect(document.metadata.retrievalMode).toBe('bge_m3_full');
            expect(document.metadata.retrievalSchemaVersion).toBe(1);
            expect(document.sparseVector).toEqual({ indices: [1, 2], values: [0.5, 0.25] });
            expect(document.colbertVectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
        }
    });

    it('fails plain insert errors with insert stage and batch context without retrying', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.INDEX_INSERT_CONCURRENCY = '2';
        process.env.EMBEDDING_BATCH_SIZE = '1';
        const vectorDatabase = new TrackingVectorDatabase();
        const insert = jest.spyOn(vectorDatabase, 'insert')
            .mockRejectedValueOnce(new Error('ambiguous vector write'));
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await expect(context.indexCodebase(await createCodebase()))
            .rejects
            .toThrow(/Indexing batch \d+ failed during insert: ambiguous vector write/);

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.submittedBatches).toBe(4);
        expect(insert).toHaveBeenCalledTimes(snapshot.submittedBatches);
        expect(vectorDatabase.allDocuments()).toHaveLength(3);
        expect(snapshot.failedInsertBatches).toBe(1);
        expect(snapshot.failedBatches).toBe(1);
    });

    it('uses accepted BGE-M3 worker count as default embedding concurrency', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.BGE_M3_ACCELERATOR_MAX_WORKERS = '4';
        const codebasePath = await createCodebase();
        const embedding = new DelayedBgeM3Embedding(20);
        embedding.workerSnapshots = [0, 1, 2, 3].map((index) => ({
            endpoint: `http://127.0.0.1:800${index}`,
            healthy: true,
            inFlight: 0,
            lastSuccessAt: '2026-06-04T00:00:00.000Z',
            recoveryAttempts: 0,
            poolState: 'accepted' as const,
        }));

        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        await context.indexCodebase(codebasePath);

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.maxActive).toBe(4);
        expect(snapshot.embeddingConcurrency).toBe(4);
        expect(snapshot.activeWorkers).toBe(4);
    });

    it('continues scheduling when one BGE-M3 worker is rejected and healthy workers remain', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const codebasePath = await createCodebase();
        const embedding = new DelayedBgeM3Embedding(5);
        embedding.workerSnapshots = [
            {
                endpoint: 'http://127.0.0.1:8000',
                healthy: false,
                inFlight: 0,
                rejectedReason: 'fetch failed',
                lastFailureAt: '2026-06-04T00:00:00.000Z',
                recoveryAttempts: 1,
                poolState: 'rejected' as const,
            },
            {
                endpoint: 'http://127.0.0.1:8001',
                healthy: true,
                inFlight: 0,
                lastSuccessAt: '2026-06-04T00:00:01.000Z',
                recoveryAttempts: 0,
                poolState: 'accepted' as const,
            },
        ];
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await context.indexCodebase(codebasePath);

        const acceleratorSnapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(vectorDatabase.allDocuments()).toHaveLength(4);
        expect(acceleratorSnapshot.completedBatches).toBe(4);
        expect(acceleratorSnapshot.failedBatches).toBe(0);
        expect(acceleratorSnapshot.activeWorkers).toBe(1);
        expect(acceleratorSnapshot.rejectedWorkers).toBe(1);
    });

    it('reports BGE-M3 worker-pool retries in accelerator status', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const codebasePath = await createCodebase();
        const embedding = new DelayedBgeM3Embedding(1);
        embedding.shouldRetryWorkerPool = true;

        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        await context.indexCodebase(codebasePath);

        expect(context.getLastAcceleratorSnapshot()?.retriedBatches).toBe(1);
    });

    it('reports detailed BGE-M3 worker diagnostics in accelerator status', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        const codebasePath = await createCodebase();
        const embedding = new DelayedBgeM3Embedding(1);
        embedding.workerSnapshots = [
            {
                endpoint: 'http://127.0.0.1:8000',
                healthy: true,
                inFlight: 0,
                lastSuccessAt: '2026-06-04T00:00:00.000Z',
                recoveryAttempts: 0,
                poolState: 'accepted',
            },
            {
                endpoint: 'http://127.0.0.1:8001',
                healthy: true,
                inFlight: 0,
                rejectedReason: undefined,
                lastFailureAt: '2026-06-04T00:00:01.000Z',
                lastSuccessAt: '2026-06-04T00:00:31.000Z',
                recoveryAttempts: 1,
                lastRecoveryAttemptAt: '2026-06-04T00:00:30.000Z',
                poolState: 'accepted',
            },
        ];

        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });
        await context.indexCodebase(codebasePath);

        expect(context.getLastAcceleratorSnapshot()).toEqual(expect.objectContaining({
            activeWorkers: 2,
            rejectedWorkers: 0,
            workers: embedding.workerSnapshots,
        }));
    });

    it('feeds measured VRAM pressure into adaptive accelerator status on the default indexing path', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.INDEX_ADAPTIVE_BACKPRESSURE = 'true';
        process.env.INDEX_ADAPTIVE_VRAM_USAGE_LIMIT_PERCENT = '90';
        const codebasePath = await createCodebase();

        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
            acceleratorResourceSnapshotProvider: () => ({
                vramUsedPercent: 95,
            }),
        });
        await context.indexCodebase(codebasePath);

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.adaptivePressureSignals?.vramUsedPercent).toBe(95);
        expect(snapshot.adaptiveThrottleReason).toBe('vram');
        expect(snapshot.adaptivePressureScore).toBe(1);
    });
});
