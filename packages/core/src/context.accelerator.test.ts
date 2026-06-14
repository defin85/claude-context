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
    VectorWriteCapabilities,
} from './vectordb';

class DelayedEmbedding extends Embedding {
    protected maxTokens = 8192;
    private active = 0;
    maxActive = 0;
    batchSizes: number[] = [];

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
        this.batchSizes.push(texts.length);
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

class PayloadSizeFailingEmbedding extends DelayedEmbedding {
    constructor(private readonly maxTextsPerBatch: number) {
        super(1);
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        this.batchSizes.push(texts.length);
        if (texts.length > this.maxTextsPerBatch) {
            throw new Error('Cannot create a string longer than 0x1fffffe8 characters');
        }
        return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
    }
}

class NonPayloadFailingEmbedding extends DelayedEmbedding {
    constructor() {
        super(1);
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        this.batchSizes.push(texts.length);
        throw new Error('temporary embedding transport failure');
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

class CountingSplitter extends OneChunkSplitter {
    splitCount = 0;

    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        this.splitCount++;
        return super.split(code, language, filePath);
    }
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

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

class TrackingVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    documents = new Map<string, VectorDocument[]>();
    insertBatchSizes: number[] = [];
    insertDelayMs = 0;
    writeCapabilities: VectorWriteCapabilities = {
        backend: 'test',
        parallelWritesToSameCollection: false,
        idempotentUpsert: true,
        recommendedInsertConcurrency: 1,
        targetCoalescedDocumentCount: 0,
        maxCoalescedDocumentCount: 0,
        writeCoalescingRecommended: false,
        ambiguousWriteFailureMode: 'fail_fast',
    };
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
        this.insertBatchSizes.push(documents.length);
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

    getWriteCapabilities(): VectorWriteCapabilities {
        return this.writeCapabilities;
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
        'INDEX_EMBEDDING_BATCH_SIZE',
        'INDEX_INSERT_BATCH_SIZE',
        'INDEX_EMBEDDING_MAX_CONTENT_CHARS',
        'INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS',
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
        delete process.env.INDEX_EMBEDDING_BATCH_SIZE;
        delete process.env.INDEX_INSERT_BATCH_SIZE;
        delete process.env.INDEX_EMBEDDING_MAX_CONTENT_CHARS;
        delete process.env.INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS;
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

    async function createCodebase(fileCount = 4): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-accelerator-'));
        await Promise.all(Array.from({ length: fileCount }, (_value, item) => fs.writeFile(
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

    function enableAcceleratedInsertFailureRace(): void {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '4';
        process.env.INDEX_INSERT_CONCURRENCY = '2';
        process.env.INDEX_INSERT_QUEUE_CAPACITY = '2';
        process.env.EMBEDDING_BATCH_SIZE = '1';
    }

    function markParallelWritesSafe(vectorDatabase: TrackingVectorDatabase, recommendedInsertConcurrency = 2): void {
        vectorDatabase.writeCapabilities = {
            ...vectorDatabase.writeCapabilities,
            parallelWritesToSameCollection: true,
            recommendedInsertConcurrency,
            ambiguousWriteFailureMode: 'retry_safe',
        };
    }

    function enablePayloadBoundedBatches(maxContentChars?: number, maxEstimatedTokens?: number): void {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.INDEX_EMBEDDING_BATCH_SIZE = '4';
        process.env.INDEX_INSERT_BATCH_SIZE = '4';
        if (maxContentChars !== undefined) {
            process.env.INDEX_EMBEDDING_MAX_CONTENT_CHARS = String(maxContentChars);
        }
        if (maxEstimatedTokens !== undefined) {
            process.env.INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS = String(maxEstimatedTokens);
        }
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

    it('uses separate embedding and insert batch sizes in the default indexing path', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'off';
        process.env.INDEX_EMBEDDING_BATCH_SIZE = '4';
        process.env.INDEX_INSERT_BATCH_SIZE = '2';
        const embedding = new DelayedEmbedding(1);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new DuplicateChunkSplitter(4),
        });

        await context.indexCodebase(await createSingleFileCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.batchSizes).toEqual([4]);
        expect(vectorDatabase.insertBatchSizes).toEqual([2, 2]);
        expect(snapshot.embeddingBatchSize).toBe(4);
        expect(snapshot.insertBatchSize).toBe(2);
        expect(snapshot.batches).toEqual([
            expect.objectContaining({
                chunkCount: 4,
                estimatedTokens: expect.any(Number),
                insertChunkCounts: [2, 2],
            }),
        ]);
        expect(vectorDatabase.allDocuments()).toHaveLength(4);
        expect(new Set(vectorDatabase.allDocuments().map((document) => document.id)).size).toBe(4);
    });

    it('splits prepared insert batches in the accelerated scheduler path', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'auto';
        process.env.INDEX_EMBEDDING_CONCURRENCY = '2';
        process.env.INDEX_EMBEDDING_BATCH_SIZE = '4';
        process.env.INDEX_INSERT_BATCH_SIZE = '2';
        const embedding = new DelayedEmbedding(1);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new DuplicateChunkSplitter(4),
        });

        await context.indexCodebase(await createSingleFileCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.active).toBe(true);
        expect(embedding.batchSizes).toEqual([4]);
        expect(vectorDatabase.insertBatchSizes).toEqual([2, 2]);
        expect(snapshot.batches[0]).toEqual(expect.objectContaining({
            chunkCount: 4,
            insertChunkCounts: [2, 2],
        }));
        expect(vectorDatabase.allDocuments()).toHaveLength(4);
        expect(new Set(vectorDatabase.allDocuments().map((document) => document.id)).size).toBe(4);
    });

    it('flushes payload-bounded embedding batches before exceeding content character limits', async () => {
        enablePayloadBoundedBatches(50);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await context.indexCodebase(await createCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.batches.map((batch) => batch.chunkCount)).toEqual([2, 2]);
        expect(snapshot.batches.map((batch) => batch.contentCharCount)).toEqual([48, 48]);
        expect(snapshot.batches.every((batch) => batch.payloadSplitReason === 'content_chars')).toBe(true);
    });

    it('flushes payload-bounded embedding batches before exceeding estimated token limits', async () => {
        enablePayloadBoundedBatches(undefined, 10);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await context.indexCodebase(await createCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.batches.map((batch) => batch.chunkCount)).toEqual([1, 1, 1, 1]);
        expect(snapshot.batches.map((batch) => batch.estimatedTokens)).toEqual([6, 6, 6, 6]);
        expect(snapshot.batches.every((batch) => batch.payloadSplitReason === 'estimated_tokens')).toBe(true);
    });

    it('submits a single chunk that exceeds payload limits and records the single-chunk pressure', async () => {
        enablePayloadBoundedBatches(10, 2);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await context.indexCodebase(await createCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(snapshot.batches.map((batch) => batch.chunkCount)).toEqual([1, 1, 1, 1]);
        expect(snapshot.batches.every((batch) => batch.payloadSplitReason === 'single_chunk_limit_exceeded')).toBe(true);
        expect(vectorDatabase.allDocuments()).toHaveLength(4);
    });

    it('recursively retries recognized payload-size embedding failures with smaller ordered batches', async () => {
        enablePayloadBoundedBatches();
        const embedding = new PayloadSizeFailingEmbedding(2);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await context.indexCodebase(await createCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.batchSizes).toEqual([4, 2, 2]);
        expect(snapshot.batches).toHaveLength(1);
        expect(snapshot.batches[0]).toEqual(expect.objectContaining({
            chunkCount: 4,
            payloadRetrySplitCount: 1,
        }));
        expect(vectorDatabase.allDocuments().map((document) => document.metadata.chunkIndex)).toEqual([0, 1, 2, 3]);
    });

    it('keeps recursively splitting repeated payload-size embedding failures until chunks fit', async () => {
        enablePayloadBoundedBatches();
        const embedding = new PayloadSizeFailingEmbedding(1);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        await context.indexCodebase(await createCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.batchSizes).toEqual([4, 2, 1, 1, 2, 1, 1]);
        expect(snapshot.batches[0]).toEqual(expect.objectContaining({
            chunkCount: 4,
            payloadRetrySplitCount: 3,
        }));
        expect(vectorDatabase.allDocuments().map((document) => document.metadata.chunkIndex)).toEqual([0, 1, 2, 3]);
    });

    it('does not split retry non-payload embedding failures', async () => {
        enablePayloadBoundedBatches();
        const embedding = new NonPayloadFailingEmbedding();
        const context = new Context({
            embedding,
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });

        await expect(context.indexCodebase(await createCodebase()))
            .rejects
            .toThrow(/Indexing batch \d+ failed during embedding: temporary embedding transport failure/);
        expect(embedding.batchSizes).toEqual([4]);
    });

    it('fails a single-chunk payload-size embedding error with actionable diagnostics', async () => {
        enablePayloadBoundedBatches();
        const context = new Context({
            embedding: new PayloadSizeFailingEmbedding(0),
            vectorDatabase: new TrackingVectorDatabase(),
            codeSplitter: new OneChunkSplitter(),
        });

        await expect(context.indexCodebase(await createSingleFileCodebase()))
            .rejects
            .toThrow(/Single embedding chunk exceeded payload-safe retry capacity.*large\.ts.*chunkIndex=0.*contentChars=29.*estimatedTokens=8.*retrievalMode=dense.*provider=test/s);
    });

    it('falls back to legacy EMBEDDING_BATCH_SIZE when the new embedding batch size is unset', async () => {
        process.env.INDEX_ACCELERATOR_MODE = 'off';
        process.env.EMBEDDING_BATCH_SIZE = '2';
        process.env.INDEX_INSERT_BATCH_SIZE = '4';
        const embedding = new DelayedEmbedding(1);
        const vectorDatabase = new TrackingVectorDatabase();
        const context = new Context({
            embedding,
            vectorDatabase,
            codeSplitter: new DuplicateChunkSplitter(4),
        });

        await context.indexCodebase(await createSingleFileCodebase());

        const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
        expect(embedding.batchSizes).toEqual([2, 2]);
        expect(vectorDatabase.insertBatchSizes).toEqual([2, 2]);
        expect(snapshot.embeddingBatchSize).toBe(2);
        expect(snapshot.insertBatchSize).toBe(4);
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
        markParallelWritesSafe(vectorDatabase);
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

    it('fails fast on plain insert errors with insert stage and batch context', async () => {
        enableAcceleratedInsertFailureRace();
        const vectorDatabase = new TrackingVectorDatabase();
        markParallelWritesSafe(vectorDatabase);
        const runningInsert = deferred<void>();
        const firstInsertError = new Error('ambiguous vector write');
        const insert = jest.spyOn(vectorDatabase, 'insert')
            .mockImplementation(async (collectionName, documents) => {
                if (insert.mock.calls.length === 1) {
                    await runningInsert.promise;
                    await TrackingVectorDatabase.prototype.insert.call(vectorDatabase, collectionName, documents);
                    return;
                }
                if (insert.mock.calls.length === 2) {
                    throw firstInsertError;
                }
                throw new Error('queued insert should not start after terminal insert failure');
            });
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });
        const unhandledRejections: unknown[] = [];
        const onUnhandledRejection = (reason: unknown) => {
            unhandledRejections.push(reason);
        };
        process.on('unhandledRejection', onUnhandledRejection);

        try {
            let indexSettled = false;
            const fileCount = 12;
            const indexPromise = context.indexCodebase(await createCodebase(fileCount))
                .finally(() => {
                    indexSettled = true;
                });

            await waitForCondition(() => insert.mock.calls.length >= 2);
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(indexSettled).toBe(false);
            expect(insert).toHaveBeenCalledTimes(2);

            runningInsert.resolve();
            await expect(indexPromise)
                .rejects
                .toThrow(/Indexing batch \d+ failed during insert: ambiguous vector write/);

            const snapshot = context.getLastAcceleratorSnapshot() as IndexingAcceleratorSnapshot;
            expect(snapshot.submittedBatches).toBeGreaterThanOrEqual(2);
            expect(snapshot.submittedBatches).toBeLessThan(fileCount);
            expect(insert).toHaveBeenCalledTimes(2);
            expect(vectorDatabase.allDocuments()).toHaveLength(1);
            expect(snapshot.failedInsertBatches).toBe(1);
            expect(snapshot.failedBatches).toBeGreaterThanOrEqual(1);
            expect(snapshot.completedBatches).toBe(1);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandledRejections).toHaveLength(0);
        } finally {
            process.off('unhandledRejection', onUnhandledRejection);
        }
    });

    it('stops producing new file batches after the first accelerated insert failure', async () => {
        enableAcceleratedInsertFailureRace();
        const vectorDatabase = new TrackingVectorDatabase();
        markParallelWritesSafe(vectorDatabase);
        const runningInsert = deferred<void>();
        const firstInsertError = new Error('stop producer after insert failure');
        const insert = jest.spyOn(vectorDatabase, 'insert')
            .mockImplementation(async (collectionName, documents) => {
                if (insert.mock.calls.length === 1) {
                    await runningInsert.promise;
                    await TrackingVectorDatabase.prototype.insert.call(vectorDatabase, collectionName, documents);
                    return;
                }
                if (insert.mock.calls.length === 2) {
                    throw firstInsertError;
                }
                throw new Error('producer scheduled insert work after terminal insert failure');
            });
        const splitter = new CountingSplitter();
        const context = new Context({
            embedding: new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: splitter,
        });

        let indexSettled = false;
        const fileCount = 12;
        const indexPromise = context.indexCodebase(await createCodebase(fileCount))
            .finally(() => {
                indexSettled = true;
            });

        await waitForCondition(() => insert.mock.calls.length >= 2);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(indexSettled).toBe(false);
        expect(splitter.splitCount).toBeLessThan(fileCount);

        runningInsert.resolve();
        await expect(indexPromise)
            .rejects
            .toThrow(/Indexing batch \d+ failed during insert: stop producer after insert failure/);
        expect(insert).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['hybrid', 'insertHybrid'] as const,
        ['BGE-M3 upsert', 'upsertBgeM3'] as const,
    ])('fails fast on %s insert errors through the accelerated scheduler boundary', async (_label, insertMethod) => {
        enableAcceleratedInsertFailureRace();
        const vectorDatabase = new TrackingVectorDatabase();
        markParallelWritesSafe(vectorDatabase);
        const runningInsert = deferred<void>();
        const firstInsertError = new Error(`${insertMethod} vector write failed`);
        const insert = jest.spyOn(vectorDatabase, insertMethod)
            .mockImplementation(async (collectionName, documents) => {
                if (insert.mock.calls.length === 1) {
                    await runningInsert.promise;
                    await TrackingVectorDatabase.prototype[insertMethod].call(vectorDatabase, collectionName, documents);
                    return;
                }
                if (insert.mock.calls.length === 2) {
                    throw firstInsertError;
                }
                throw new Error(`${insertMethod} queued insert should not start`);
            });
        if (insertMethod === 'insertHybrid') {
            process.env.HYBRID_MODE = 'true';
        }
        const context = new Context({
            embedding: insertMethod === 'upsertBgeM3'
                ? new DelayedBgeM3Embedding(1)
                : new DelayedEmbedding(1),
            vectorDatabase,
            codeSplitter: new OneChunkSplitter(),
        });

        let indexSettled = false;
        const indexPromise = context.indexCodebase(await createCodebase())
            .finally(() => {
                indexSettled = true;
            });

        await waitForCondition(() => insert.mock.calls.length >= 2);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(indexSettled).toBe(false);
        expect(insert).toHaveBeenCalledTimes(2);

        runningInsert.resolve();
        await expect(indexPromise)
            .rejects
            .toThrow(new RegExp(`Indexing batch \\d+ failed during insert: ${insertMethod} vector write failed`));
        expect(insert).toHaveBeenCalledTimes(2);
        expect(vectorDatabase.allDocuments()).toHaveLength(1);
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
