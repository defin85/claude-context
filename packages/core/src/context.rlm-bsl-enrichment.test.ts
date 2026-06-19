import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Context } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { CodeChunk, Splitter } from './splitter';
import {
    CodeSymbolProvider,
    CodeSymbolProviderAvailability,
    CodeSymbolProviderCandidate,
    CodeSymbolProviderQuery,
} from './code-symbol-retrieval';
import {
    HybridSearchOptions,
    HybridSearchRequest,
    HybridSearchResult,
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
} from './vectordb';
import { RlmBslIndexEnricher } from './rlm-bsl-enrichment';

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

class TwoChunkSplitter implements Splitter {
    async split(_code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [
            { content: 'Процедура Целевая()\nКонецПроцедуры', metadata: { startLine: 1, endLine: 3, language, filePath } },
            { content: 'Процедура Другая()\nКонецПроцедуры', metadata: { startLine: 8, endLine: 10, language, filePath } },
        ];
    }

    setChunkSize(): void {}
    setChunkOverlap(): void {}
}

class TestVectorDatabase implements VectorDatabase {
    readonly documents: VectorDocument[] = [];
    collectionDescription = '';
    dropCount = 0;
    deleteCount = 0;
    queryRows: Record<string, any>[] = [];

    constructor(private readonly collectionExists = false) {}

    async createCollection(_collectionName: string, _dimension?: number, description?: string): Promise<void> {
        this.collectionDescription = description || '';
    }
    async createHybridCollection(_collectionName: string, _dimension?: number, description?: string): Promise<void> {
        this.collectionDescription = description || '';
    }
    async createBgeM3Collection(_collectionName: string, _dimension?: number, description?: string): Promise<void> {
        this.collectionDescription = description || '';
    }
    async dropCollection(): Promise<void> { this.dropCount++; }
    async hasCollection(): Promise<boolean> { return this.collectionExists; }
    async listCollections(): Promise<string[]> { return []; }
    async insert(_collectionName: string, documents: VectorDocument[]): Promise<void> { this.documents.push(...documents); }
    async insertHybrid(_collectionName: string, documents: VectorDocument[]): Promise<void> { this.documents.push(...documents); }
    async insertBgeM3(_collectionName: string, documents: VectorDocument[]): Promise<void> { this.documents.push(...documents); }
    async search(): Promise<VectorSearchResult[]> { return []; }
    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> { return []; }
    async bgeM3HybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> { return []; }
    async delete(_collectionName: string, ids: string[]): Promise<void> {
        this.deleteCount += ids.length;
    }
    async query(): Promise<Record<string, any>[]> { return this.queryRows; }
    async getCollectionDescription(): Promise<string> { return this.collectionDescription; }
    async checkCollectionLimit(): Promise<boolean> { return true; }
    async getCollectionRowCount(): Promise<number> { return this.documents.length; }
}

class FakeProvider implements CodeSymbolProvider {
    readonly providerName = 'rlm-tools-bsl';
    readonly availability: CodeSymbolProviderAvailability = {
        providerName: this.providerName,
        status: 'available',
    };
    readonly candidates: CodeSymbolProviderCandidate[] = [];
    calls = 0;

    async getAvailability(): Promise<CodeSymbolProviderAvailability> {
        this.calls++;
        return this.availability;
    }

    async queryCandidates(_query: CodeSymbolProviderQuery): Promise<CodeSymbolProviderCandidate[]> {
        this.calls++;
        return this.candidates;
    }
}

describe('Context RLM BSL index enrichment', () => {
    it('stores overlapping RLM BSL symbols in vector document metadata', async () => {
        const project = await makeProject();
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TwoChunkSplitter(),
            codebaseIndexEnricher: new RlmBslIndexEnricher({
                mode: 'optional',
                snapshotLoader: () => makeSnapshot(project),
            }),
        });

        await context.indexCodebase(project, undefined, true);

        expect(vectorDatabase.documents).toHaveLength(2);
        expect(vectorDatabase.documents[0].metadata.bsl).toEqual(expect.objectContaining({
            provider: 'rlm-tools-bsl',
            status: 'available',
            sourceFingerprint: 'fingerprint-1',
            objectName: 'СкладскойЖурнал',
            moduleKind: 'Module',
            synonyms: ['Складской журнал'],
        }));
        expect(vectorDatabase.documents[0].metadata.bsl.symbols).toEqual([
            expect.objectContaining({ name: 'Целевая', startLine: 1, endLine: 3 }),
        ]);
        expect(vectorDatabase.documents[1].metadata.bsl.symbols).toEqual([]);
        expect(vectorDatabase.collectionDescription).toContain('enrichmentProvider:rlm-tools-bsl');
        expect(vectorDatabase.collectionDescription).toContain('enrichmentStatus:available');
        expect(vectorDatabase.collectionDescription).toContain('enrichmentSourceFingerprint:fingerprint-1');
    });

    it('fails required enrichment before dropping an existing collection', async () => {
        const project = await makeProject();
        const vectorDatabase = new TestVectorDatabase(true);
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TwoChunkSplitter(),
            codebaseIndexEnricher: new RlmBslIndexEnricher({
                mode: 'required',
                snapshotLoader: () => {
                    throw new Error('provider unavailable');
                },
            }),
        });

        await expect(context.indexCodebase(project, undefined, true))
            .rejects.toThrow(/RLM BSL enrichment is required/);
        expect(vectorDatabase.dropCount).toBe(0);
    });

    it('continues optional indexing without enrichment and records unavailable collection metadata', async () => {
        const project = await makeProject();
        const vectorDatabase = new TestVectorDatabase();
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TwoChunkSplitter(),
            codebaseIndexEnricher: new RlmBslIndexEnricher({
                mode: 'optional',
                snapshotLoader: () => {
                    throw new Error('provider unavailable');
                },
            }),
        });

        await context.indexCodebase(project, undefined, true);

        expect(vectorDatabase.documents).toHaveLength(2);
        expect(vectorDatabase.documents[0].metadata.bsl).toBeUndefined();
        expect(vectorDatabase.collectionDescription).toContain('enrichmentProvider:rlm-tools-bsl');
        expect(vectorDatabase.collectionDescription).toContain('enrichmentStatus:unavailable');
        expect(vectorDatabase.collectionDescription).not.toContain('provider unavailable');
    });

    it('fails required incremental reindex before deleting old chunks when snapshot loading fails', async () => {
        const project = await makeProject();
        const vectorDatabase = new TestVectorDatabase(true);
        vectorDatabase.queryRows = [{ id: 'old-chunk-1' }];
        let loadCount = 0;
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TwoChunkSplitter(),
            codebaseIndexEnricher: new RlmBslIndexEnricher({
                mode: 'required',
                snapshotLoader: () => {
                    loadCount++;
                    if (loadCount === 1) {
                        return makeSnapshot(project);
                    }
                    throw new Error('provider unavailable during sync');
                },
            }),
        });

        await context.indexCodebase(project, undefined, true);
        await fs.appendFile(path.join(project, 'CommonModules', 'СкладскойЖурнал', 'Ext', 'Module.bsl'), '\nПроцедура Новая()\nКонецПроцедуры\n');

        await expect(context.reindexByChange(project))
            .rejects.toThrow(/RLM BSL enrichment is required/);
        expect(vectorDatabase.deleteCount).toBe(0);
    });

    it('keeps search-time provider enabled after optional incremental reindex loses enrichment', async () => {
        const project = await makeProject();
        const vectorDatabase = new TestVectorDatabase(true);
        vectorDatabase.queryRows = [{ id: 'old-chunk-1' }];
        const provider = new FakeProvider();
        let loadCount = 0;
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TwoChunkSplitter(),
            codeSymbolProviders: [provider],
            codebaseIndexEnricher: new RlmBslIndexEnricher({
                mode: 'optional',
                snapshotLoader: () => {
                    loadCount++;
                    if (loadCount === 1) {
                        return makeSnapshot(project);
                    }
                    throw new Error('provider unavailable during sync');
                },
            }),
        });

        await context.indexCodebase(project, undefined, true);
        expect(vectorDatabase.collectionDescription).toContain('enrichmentStatus:available');
        await fs.appendFile(path.join(project, 'CommonModules', 'СкладскойЖурнал', 'Ext', 'Module.bsl'), '\nПроцедура Новая()\nКонецПроцедуры\n');

        await context.reindexByChange(project);
        expect(context.getRlmBslEnrichmentRuntimeStatus(project)).toEqual(expect.objectContaining({
            provider: 'rlm-tools-bsl',
            status: 'mixed',
        }));
        await context.semanticSearch(project, 'Целевая', 3);

        expect(provider.calls).toBeGreaterThan(0);
    });

    it('enriches added and modified chunks during incremental reindex', async () => {
        const project = await makeProject();
        const vectorDatabase = new TestVectorDatabase(true);
        vectorDatabase.queryRows = [{ id: 'old-chunk-1' }];
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase,
            codeSplitter: new TwoChunkSplitter(),
            codebaseIndexEnricher: new RlmBslIndexEnricher({
                mode: 'optional',
                snapshotLoader: () => makeSnapshot(project, 'fingerprint-incremental'),
            }),
        });

        await context.indexCodebase(project, undefined, true);
        vectorDatabase.documents.length = 0;
        await fs.appendFile(path.join(project, 'CommonModules', 'СкладскойЖурнал', 'Ext', 'Module.bsl'), '\nПроцедура Новая()\nКонецПроцедуры\n');

        const stats = await context.reindexByChange(project);

        expect(stats.modified).toBe(1);
        expect(vectorDatabase.deleteCount).toBe(1);
        expect(vectorDatabase.documents.length).toBeGreaterThan(0);
        expect(vectorDatabase.documents[0].metadata.bsl).toEqual(expect.objectContaining({
            provider: 'rlm-tools-bsl',
            status: 'available',
            sourceFingerprint: 'fingerprint-incremental',
        }));
    });
});

async function makeProject(): Promise<string> {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-rlm-bsl-'));
    const modulePath = path.join(project, 'CommonModules', 'СкладскойЖурнал', 'Ext', 'Module.bsl');
    await fs.mkdir(path.dirname(modulePath), { recursive: true });
    await fs.writeFile(modulePath, 'Процедура Целевая()\nКонецПроцедуры\n');
    return project;
}

function makeSnapshot(project: string, sourceFingerprint = 'fingerprint-1') {
    return {
        schemaVersion: 1,
        provider: 'rlm-tools-bsl',
        status: 'available',
        sourceRoot: project,
        sourceFingerprint,
        capabilities: {
            hasMethods: true,
            hasObjects: true,
            hasFilePaths: true,
        },
        files: [{
            relativePath: 'CommonModules/СкладскойЖурнал/Ext/Module.bsl',
            objectName: 'СкладскойЖурнал',
            objectKind: 'CommonModules',
            moduleKind: 'Module',
            synonyms: ['Складской журнал'],
            symbols: [
                { name: 'Целевая', declarationKind: 'procedure', startLine: 1, endLine: 3, isExport: true, params: '' },
                { name: 'НеВЭтомЧанке', declarationKind: 'procedure', startLine: 20, endLine: 23, isExport: true, params: '' },
            ],
        }],
        diagnostics: {
            indexStatus: 'fresh',
        },
    };
}
