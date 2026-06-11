import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    CodeSymbolProvider,
    CodeSymbolProviderAvailability,
    CodeSymbolProviderCandidate,
    CodeSymbolProviderQuery,
    Context,
    Embedding,
    EmbeddingVector,
    HybridSearchOptions,
    HybridSearchRequest,
    HybridSearchResult,
    MultiVectorEmbedding,
    RlmToolsBslSubprocessProvider,
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    translateProviderPath,
} from './index';

class BgeM3FullEmbedding extends Embedding {
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
        return 'BGE_M3';
    }

    getMode(): string {
        return 'full';
    }

    async embedMulti(): Promise<MultiVectorEmbedding> {
        return {
            dense: { vector: [1, 0, 0], dimension: 3 },
            sparse: { indices: [4], values: [0.4] },
            colbert: { vectors: [[1, 0]], dimension: 2, tokenCount: 1 },
        };
    }

    async embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]> {
        return texts.map(() => ({
            dense: { vector: [1, 0, 0], dimension: 3 },
            sparse: { indices: [4], values: [0.4] },
            colbert: { vectors: [[1, 0]], dimension: 2, tokenCount: 1 },
        }));
    }
}

class TestVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    documents: VectorDocument[] = [];
    bgeM3SearchResults: HybridSearchResult[] = [];

    async createCollection(collectionName: string): Promise<void> { this.collections.add(collectionName); }
    async createHybridCollection(collectionName: string): Promise<void> { this.collections.add(collectionName); }
    async createBgeM3Collection(collectionName: string): Promise<void> { this.collections.add(collectionName); }
    async dropCollection(collectionName: string): Promise<void> { this.collections.delete(collectionName); }
    async hasCollection(collectionName: string): Promise<boolean> { return this.collections.has(collectionName); }
    async listCollections(): Promise<string[]> { return [...this.collections]; }
    async insert(): Promise<void> {}
    async insertHybrid(): Promise<void> {}
    async insertBgeM3(): Promise<void> {}
    async search(): Promise<VectorSearchResult[]> { return []; }
    async hybridSearch(): Promise<HybridSearchResult[]> { return []; }
    async bgeM3HybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        return this.bgeM3SearchResults;
    }
    async delete(): Promise<void> {}
    async query(
        _collectionName: string,
        filter: string | undefined,
        outputFields: string[],
        limit = 100,
    ): Promise<Record<string, any>[]> {
        let rows = this.documents;
        if (filter) {
            const likeMatch = filter.match(/^(content|relativePath)\s+like\s+"%((?:\\"|[^"])*)%"$/);
            const exactPathMatch = filter.match(/^relativePath\s*==\s*"((?:\\"|[^"])*)"$/);
            if (likeMatch) {
                const [, field, rawTerm] = likeMatch;
                const term = rawTerm.replace(/\\"/g, '"').toLocaleLowerCase('ru-RU');
                rows = rows.filter((doc) => String((doc as any)[field]).toLocaleLowerCase('ru-RU').includes(term));
            } else if (exactPathMatch) {
                const expectedPath = exactPathMatch[1].replace(/\\"/g, '"');
                rows = rows.filter((doc) => doc.relativePath === expectedPath);
            } else {
                rows = [];
            }
        }

        return rows.slice(0, limit).map((doc) => project(doc, outputFields));
    }
    async getCollectionDescription(): Promise<string> { return ''; }
    async checkCollectionLimit(): Promise<boolean> { return true; }
    async getCollectionRowCount(): Promise<number> { return this.documents.length; }
}

class FakeProvider implements CodeSymbolProvider {
    readonly providerName = 'rlm-tools-bsl';
    availability: CodeSymbolProviderAvailability = {
        providerName: this.providerName,
        status: 'available',
    };
    candidates: CodeSymbolProviderCandidate[] = [];

    async getAvailability(): Promise<CodeSymbolProviderAvailability> {
        return this.availability;
    }

    async queryCandidates(_query: CodeSymbolProviderQuery): Promise<CodeSymbolProviderCandidate[]> {
        return this.candidates;
    }
}

const exactSymbolDocument = doc({
    id: 'exact-symbol',
    content: 'Функция ПараметрыЗаполненияЗаписейСкладскогоЖурнала() Экспорт\nВозврат Новый Структура;\nКонецФункции',
    relativePath: 'src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl',
    startLine: 120,
    endLine: 140,
});

const relatedDistractor = doc({
    id: 'related-distractor',
    content: 'Процедура ЗаписьСкладскогоЖурнала(ДокументСсылка)\n// семантически похожий складской журнал\nКонецПроцедуры',
    relativePath: 'src/cf/Documents/ПоступлениеТоваров/Ext/ObjectModule.bsl',
    startLine: 1,
    endLine: 20,
});

const pathDistractor = doc({
    id: 'path-distractor',
    content: 'Процедура ВыполнитьОбменВЕТИС()\nКонецПроцедуры',
    relativePath: 'src/cf/CommonModules/ИнтеграцияВЕТИС/Ext/Module.bsl',
    startLine: 1,
    endLine: 20,
});

const typescriptExactSymbolDocument: VectorDocument = {
    id: 'typescript-exact-symbol',
    vector: [],
    colbertVectors: [[1, 0]],
    content: 'export function ПараметрыЗаполненияЗаписейСкладскогоЖурнала() { return {}; }',
    relativePath: 'src/tools/fillJournal.ts',
    startLine: 1,
    endLine: 3,
    fileExtension: '.ts',
    metadata: { language: 'typescript' },
};

describe('Context code-symbol retrieval', () => {
    it('ranks a BSL exact symbol chunk above related semantic distractors', async () => {
        const vectorDatabase = createDb([exactSymbolDocument, relatedDistractor]);
        vectorDatabase.bgeM3SearchResults = [
            { document: relatedDistractor, score: 0.99 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала', 3);

        expect(results[0].relativePath).toBe(exactSymbolDocument.relativePath);
        expect(results[0].metadata?.retrievalSources).toEqual(expect.arrayContaining(['lexical']));
        expect(results[0].metadata?.exactSymbolBoost).toBeGreaterThan(0);
    });

    it('boosts BSL common module name matches by relative path', async () => {
        const vectorDatabase = createDb([exactSymbolDocument, pathDistractor]);
        vectorDatabase.bgeM3SearchResults = [
            { document: pathDistractor, score: 0.8 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'ЗаполнениеДокументовВЕТИС', 3);

        expect(results[0].relativePath).toBe(exactSymbolDocument.relativePath);
        expect(results[0].metadata?.pathBoost).toBeGreaterThan(0);
    });

    it('maps fake rlm-tools-bsl provider results to indexed chunks with diagnostics', async () => {
        const provider = new FakeProvider();
        provider.candidates = [{
            providerName: 'rlm-tools-bsl',
            providerStatus: 'available',
            relativePath: exactSymbolDocument.relativePath,
            startLine: 125,
            endLine: 125,
            symbolName: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            declarationKind: 'function',
            moduleName: 'ЗаполнениеДокументовВЕТИС',
            objectKind: 'CommonModule',
            export: true,
            providerRank: 0,
            lexicalScore: 4,
        }];
        const vectorDatabase = createDb([exactSymbolDocument, relatedDistractor]);
        vectorDatabase.bgeM3SearchResults = [
            { document: relatedDistractor, score: 0.9 },
        ];
        const context = createContext(vectorDatabase, [provider]);

        const results = await context.semanticSearch('/tmp/example', 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала', 3);

        expect(results[0].relativePath).toBe(exactSymbolDocument.relativePath);
        expect(results[0].metadata).toEqual(expect.objectContaining({
            symbolProvider: 'rlm-tools-bsl',
            providerStatus: 'available',
            symbolName: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            declarationKind: 'function',
            moduleName: 'ЗаполнениеДокументовВЕТИС',
            objectKind: 'CommonModule',
            export: true,
        }));
    });

    it('fails open when provider is missing and keeps semantic results', async () => {
        const provider = new FakeProvider();
        provider.availability = {
            providerName: 'rlm-tools-bsl',
            status: 'missing',
            diagnostics: { reason: 'not indexed' },
        };
        const vectorDatabase = createDb([relatedDistractor]);
        vectorDatabase.bgeM3SearchResults = [
            { document: relatedDistractor, score: 0.9 },
        ];
        const context = createContext(vectorDatabase, [provider]);

        const results = await context.semanticSearch('/tmp/example', 'как записывается складской журнал', 1);

        expect(results[0].relativePath).toBe(relatedDistractor.relativePath);
        expect(results[0].metadata?.providerDiagnostics).toEqual([
            expect.objectContaining({ providerName: 'rlm-tools-bsl', status: 'missing' }),
        ]);
    });

    it('keeps unmapped provider candidates out of results and reports them in diagnostics', async () => {
        const provider = new FakeProvider();
        provider.candidates = [{
            providerName: 'rlm-tools-bsl',
            providerStatus: 'available',
            relativePath: 'src/cf/CommonModules/НетТакогоМодуля/Ext/Module.bsl',
            symbolName: 'НетТакогоСимвола',
            providerRank: 0,
        }];
        const vectorDatabase = createDb([relatedDistractor]);
        vectorDatabase.bgeM3SearchResults = [
            { document: relatedDistractor, score: 0.9 },
        ];
        const context = createContext(vectorDatabase, [provider]);

        const results = await context.semanticSearch('/tmp/example', 'НетТакогоСимвола', 3);

        expect(results.map((result) => result.relativePath)).not.toContain('src/cf/CommonModules/НетТакогоМодуля/Ext/Module.bsl');
        expect(results[0].metadata?.providerUnmappedCandidates).toEqual([
            expect.objectContaining({ symbolName: 'НетТакогоСимвола' }),
        ]);
    });

    it('keeps lexical candidates within the caller filter expression', async () => {
        const vectorDatabase = createDb([exactSymbolDocument, typescriptExactSymbolDocument]);
        vectorDatabase.bgeM3SearchResults = [
            { document: typescriptExactSymbolDocument, score: 0.7 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch(
            '/tmp/example',
            'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            3,
            0.5,
            "fileExtension in ['.ts']",
        );

        expect(results.map((result) => result.relativePath)).toEqual([
            typescriptExactSymbolDocument.relativePath,
        ]);
    });

    it('translates equal-root and nested-root provider paths', () => {
        expect(translateProviderPath('/repo/src/cf/CommonModules/A/Ext/Module.bsl', '/repo')).toBe(
            'src/cf/CommonModules/A/Ext/Module.bsl',
        );
        expect(translateProviderPath('/repo/src/cf/CommonModules/A/Ext/Module.bsl', '/repo', '/repo/src/cf')).toBe(
            'src/cf/CommonModules/A/Ext/Module.bsl',
        );
    });

    it('uses argv arrays for subprocess provider queries with spaces and Cyrillic characters', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rlm-tools-bsl-provider-'));
        const recorderPath = path.join(tempDir, 'recorder.js');
        const argsPath = path.join(tempDir, 'args.json');
        await fs.writeFile(
            recorderPath,
            [
                'const fs = require("fs");',
                `fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
                'process.stdout.write(JSON.stringify({ candidates: [] }));',
            ].join('\n'),
        );
        const provider = new RlmToolsBslSubprocessProvider({
            command: process.execPath,
            args: [recorderPath, '--path', '{codebasePath}', '--query', '{query}', '--limit', '{limit}'],
        });

        await provider.queryCandidates({
            codebasePath: '/tmp/путь с пробелом',
            query: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            tokens: {
                rawQuery: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
                normalizedQuery: 'параметрызаполнениязаписейскладскогожурнала',
                exactTerms: ['ПараметрыЗаполненияЗаписейСкладскогоЖурнала'],
                identifierTerms: ['ПараметрыЗаполненияЗаписейСкладскогоЖурнала'],
                pathTerms: [],
                naturalTerms: [],
                hasCodeLikeTerm: true,
            },
            maxCandidates: 5,
            timeoutMs: 1000,
        });

        const recordedArgs = JSON.parse(await fs.readFile(argsPath, 'utf8'));
        expect(recordedArgs).toEqual([
            '--path',
            '/tmp/путь с пробелом',
            '--query',
            'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            '--limit',
            '5',
        ]);
    });

    it('reads structured subprocess availability status without building indexes', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rlm-tools-bsl-availability-'));
        const statusPath = path.join(tempDir, 'status.js');
        await fs.writeFile(
            statusPath,
            'process.stdout.write(JSON.stringify({ status: "stale", diagnostics: { reason: "mtime mismatch" } }));',
        );
        const provider = new RlmToolsBslSubprocessProvider({
            command: process.execPath,
            availabilityArgs: [statusPath, '--path', '{codebasePath}'],
        });

        const availability = await provider.getAvailability('/tmp/путь с пробелом');

        expect(availability).toEqual(expect.objectContaining({
            providerName: 'rlm-tools-bsl',
            status: 'stale',
        }));
        expect(availability.diagnostics).toEqual(expect.objectContaining({
            reason: 'mtime mismatch',
            autoIndexLifecycle: 'disabled',
        }));
    });

    it('does not enable the subprocess provider without structured availability checks', async () => {
        const provider = new RlmToolsBslSubprocessProvider({
            command: process.execPath,
        });

        const availability = await provider.getAvailability('/tmp/example');

        expect(availability).toEqual(expect.objectContaining({
            providerName: 'rlm-tools-bsl',
            status: 'unsupported',
        }));
        expect(availability.diagnostics).toEqual(expect.objectContaining({
            reason: 'RLM_TOOLS_BSL_AVAILABILITY_ARGS_JSON is required for freshness checks',
            autoIndexLifecycle: 'disabled',
        }));
    });
});

function createContext(vectorDatabase: TestVectorDatabase, codeSymbolProviders: CodeSymbolProvider[] = []): Context {
    const context = new Context({
        embedding: new BgeM3FullEmbedding(),
        vectorDatabase,
        codeSymbolProviders,
    });
    vectorDatabase.collections.add(context.getCollectionName('/tmp/example'));
    return context;
}

function createDb(documents: VectorDocument[]): TestVectorDatabase {
    const vectorDatabase = new TestVectorDatabase();
    vectorDatabase.documents = documents;
    return vectorDatabase;
}

function doc(input: {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
}): VectorDocument {
    return {
        ...input,
        vector: [],
        colbertVectors: [[1, 0]],
        fileExtension: '.bsl',
        metadata: { language: 'bsl' },
    };
}

function project(document: VectorDocument, outputFields: string[]): Record<string, any> {
    const row = {
        id: document.id,
        content: document.content,
        relativePath: document.relativePath,
        startLine: document.startLine,
        endLine: document.endLine,
        fileExtension: document.fileExtension,
        metadata: document.metadata,
        metadata_json: JSON.stringify(document.metadata),
    };

    const projected: Record<string, any> = {};
    for (const field of outputFields) {
        projected[field] = (row as any)[field];
    }
    return projected;
}
