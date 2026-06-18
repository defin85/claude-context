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
    parseRankingProfile,
    resolveRankingProfile,
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
    it('parses and resolves ranking profiles with auto fallback', () => {
        expect(parseRankingProfile('auto')).toBe('auto');
        expect(parseRankingProfile('generic')).toBe('generic');
        expect(parseRankingProfile('one-c')).toBe('one-c');
        expect(parseRankingProfile(undefined)).toBeUndefined();
        expect(resolveRankingProfile()).toBe('auto');
        expect(resolveRankingProfile({ persistedCodebaseDefault: 'one-c' })).toBe('one-c');
        expect(resolveRankingProfile({ searchTimeProfile: 'generic', persistedCodebaseDefault: 'one-c' })).toBe('generic');
        expect(() => parseRankingProfile('typescript')).toThrow(/Invalid rankingProfile/);
    });

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

    it('returns compact ranking diagnostics without vector payloads', async () => {
        const catalogForm = doc({
            id: 'catalog-form',
            content: 'Процедура ПриОткрытии() КонецПроцедуры',
            relativePath: 'src/cf/Catalogs/Контрагенты/Forms/ФормаЭлемента/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        catalogForm.metadata = {
            language: 'bsl',
            dense: [1, 2, 3],
            sparse: { indices: [1], values: [0.5] },
            colbertVectors: [[1, 0]],
        };
        const vectorDatabase = createDb([catalogForm]);
        vectorDatabase.bgeM3SearchResults = [{ document: catalogForm, score: 0.6 }];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'карточка контрагенты', 1);

        expect(results[0].metadata).toEqual(expect.objectContaining({
            semanticScore: expect.any(Number),
            lexicalScore: expect.any(Number),
            exactSymbolBoost: expect.any(Number),
            pathBoost: expect.any(Number),
            oneCObjectKindBoost: expect.any(Number),
            oneCObjectNameBoost: expect.any(Number),
            oneCIntentBoost: expect.any(Number),
            oneCCompoundNameBoost: expect.any(Number),
            rankingProfile: 'auto',
            duplicatePenalty: expect.any(Number),
            diversityReason: expect.any(String),
            fusionScore: expect.any(Number),
        }));
        expect(results[0].metadata).not.toHaveProperty('dense');
        expect(results[0].metadata).not.toHaveProperty('sparse');
        expect(results[0].metadata).not.toHaveProperty('colbertVectors');
    });

    it('keeps ranking profile diagnostics when fusion returns semantic-only results', async () => {
        const genericTypescript = {
            ...typescriptExactSymbolDocument,
            id: 'semantic-only-typescript',
            content: 'export function calculateSalesReport() { return []; }',
            relativePath: 'src/reports/sales.ts',
            metadata: { language: 'typescript' },
        };
        const vectorDatabase = createDb([genericTypescript]);
        vectorDatabase.bgeM3SearchResults = [{ document: genericTypescript, score: 0.8 }];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'unmatched query', 1, 0.5, undefined, {
            rankingProfile: 'generic',
        });

        expect(results[0].metadata?.rankingProfile).toBe('generic');
    });

    it('uses bounded 1C object-kind and metadata-name signals for representative object paths', async () => {
        const fixtures = [
            { query: 'справочник контрагенты карточка', path: 'src/cf/Catalogs/Контрагенты/Forms/ФормаЭлемента/Ext/Form/Module.bsl' },
            { query: 'справочник склады форма списка', path: 'src/cf/Catalogs/Склады/Forms/ФормаСписка/Ext/Form/Module.bsl' },
            { query: 'пользователи форма элемента', path: 'src/cf/Catalogs/Пользователи/Forms/ФормаЭлемента/Ext/Form/Module.bsl' },
            { query: 'единицы измерения справочник', path: 'src/cf/Catalogs/ЕдиницыИзмерения/Ext/ObjectModule.bsl' },
            { query: 'регистр остатки товаров', path: 'src/cf/AccumulationRegisters/ОстаткиТоваров/Ext/ManagerModule.bsl' },
            { query: 'документ расход товара форма документа', path: 'src/cf/Documents/РасходТовара/Forms/ФормаДокумента/Ext/Form/Module.bsl' },
            { query: 'отчет остатки товаров', path: 'src/cf/Reports/ОстаткиТоваровНаСкладах/Ext/ObjectModule.bsl' },
            { query: 'команда печать расходной накладной', path: 'src/cf/Documents/РасходТовара/Commands/ПечатьРасходнойНакладной/Ext/CommandModule.bsl' },
        ];

        for (const [index, fixture] of fixtures.entries()) {
            const matching = doc({
                id: `matching-${index}`,
                content: 'Процедура ВыполнитьКоманду() КонецПроцедуры',
                relativePath: fixture.path,
                startLine: 1,
                endLine: 3,
            });
            const generic = doc({
                id: `generic-${index}`,
                content: 'Процедура ВыполнитьКоманду() товар контрагент форма КонецПроцедуры',
                relativePath: 'src/cf/Documents/Продажа/Forms/ФормаСписка/Ext/Form/Module.bsl',
                startLine: 1,
                endLine: 3,
            });
            const vectorDatabase = createDb([matching, generic]);
            vectorDatabase.bgeM3SearchResults = [
                { document: generic, score: 0.5 },
                { document: matching, score: 0.5 },
            ];
            const context = createContext(vectorDatabase);

            const results = await context.semanticSearch('/tmp/example', fixture.query, 2);

            expect(results[0].relativePath).toBe(fixture.path);
            expect(
                (results[0].metadata?.oneCObjectKindBoost || 0) +
                (results[0].metadata?.oneCObjectNameBoost || 0) +
                (results[0].metadata?.oneCIntentBoost || 0),
            ).toBeGreaterThan(0);
            expect(results[0].metadata?.oneCObjectKindBoost).toBeLessThanOrEqual(1.2);
            expect(results[0].metadata?.oneCObjectNameBoost).toBeLessThanOrEqual(1.3);
            expect(results[0].metadata?.oneCIntentBoost).toBeLessThanOrEqual(1.1);
        }
    });

    it('does not apply 1C-specific boosts to misleading non-1C paths under generic profile', async () => {
        const misleadingDocuments = [
            doc({
                id: 'typescript-document',
                content: 'export function renderDocumentForm() { return "document"; }',
                relativePath: 'src/Documents/Foo.ts',
                startLine: 1,
                endLine: 3,
            }),
            doc({
                id: 'typescript-catalog',
                content: 'export const ProductCatalog = new Map();',
                relativePath: 'src/Catalogs/Product.ts',
                startLine: 1,
                endLine: 3,
            }),
            doc({
                id: 'typescript-report',
                content: 'export function buildSalesReport() { return []; }',
                relativePath: 'src/Reports/Sales.ts',
                startLine: 1,
                endLine: 3,
            }),
        ].map((document) => ({
            ...document,
            fileExtension: '.ts',
            metadata: { language: 'typescript' },
        }));
        const vectorDatabase = createDb(misleadingDocuments);
        vectorDatabase.bgeM3SearchResults = misleadingDocuments.map((document) => ({ document, score: 0.6 }));
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'документ отчет справочник карточка форма списка', 3, 0.5, undefined, {
            rankingProfile: 'generic',
        });

        expect(results).toHaveLength(3);
        for (const result of results) {
            expect(result.metadata?.rankingProfile).toBe('generic');
            expect(result.metadata?.oneCObjectKindBoost ?? 0).toBe(0);
            expect(result.metadata?.oneCObjectNameBoost ?? 0).toBe(0);
            expect(result.metadata?.oneCIntentBoost ?? 0).toBe(0);
        }
    });

    it('keeps one-c eligible for bounded boosts on recognized 1C paths', async () => {
        const catalogForm = doc({
            id: 'catalog-form-one-c',
            content: 'Форма карточки контрагента реквизиты контактная информация',
            relativePath: 'src/cf/Catalogs/Контрагенты/Forms/ФормаЭлемента/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([catalogForm]);
        vectorDatabase.bgeM3SearchResults = [{ document: catalogForm, score: 0.6 }];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'справочник контрагенты карточка', 1, 0.5, undefined, {
            rankingProfile: 'one-c',
        });

        expect(results[0].metadata?.rankingProfile).toBe('one-c');
        expect(
            (results[0].metadata?.oneCObjectKindBoost || 0) +
            (results[0].metadata?.oneCObjectNameBoost || 0) +
            (results[0].metadata?.oneCIntentBoost || 0),
        ).toBeGreaterThan(0);
    });

    it('keeps omitted profile and auto profile behavior equivalent', async () => {
        const catalogForm = doc({
            id: 'catalog-form-auto',
            content: 'Форма карточки контрагента реквизиты контактная информация',
            relativePath: 'src/cf/Catalogs/Контрагенты/Forms/ФормаЭлемента/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const omittedDb = createDb([catalogForm]);
        omittedDb.bgeM3SearchResults = [{ document: catalogForm, score: 0.6 }];
        const autoDb = createDb([catalogForm]);
        autoDb.bgeM3SearchResults = [{ document: catalogForm, score: 0.6 }];

        const omitted = await createContext(omittedDb).semanticSearch('/tmp/example', 'справочник контрагенты карточка', 1);
        const auto = await createContext(autoDb).semanticSearch('/tmp/example', 'справочник контрагенты карточка', 1, 0.5, undefined, {
            rankingProfile: 'auto',
        });

        expect(omitted[0].metadata?.rankingProfile).toBe('auto');
        expect(auto[0].metadata?.rankingProfile).toBe('auto');
        expect(auto[0].metadata?.oneCObjectKindBoost).toBe(omitted[0].metadata?.oneCObjectKindBoost);
        expect(auto[0].metadata?.oneCObjectNameBoost).toBe(omitted[0].metadata?.oneCObjectNameBoost);
        expect(auto[0].metadata?.oneCIntentBoost).toBe(omitted[0].metadata?.oneCIntentBoost);
    });

    it('treats print intent as candidate contexts instead of one fixed exported path', async () => {
        const printContexts = [
            'src/cf/Documents/РасходТовара/Commands/ПечатьРасходнойНакладной/Ext/CommandModule.bsl',
            'src/cf/Documents/РасходТовара/Forms/ФормаДокумента/Ext/Form/Module.bsl',
            'src/cf/Reports/ПрайсЛист/Ext/ObjectModule.bsl',
            'src/cf/Documents/РасходТовара/Ext/ObjectModule.bsl',
            'src/cf/Documents/РасходТовара/Ext/ManagerModule.bsl',
            'src/cf/CommonModules/ПечатьДокументов/Ext/Module.bsl',
            'src/cf/Documents/РасходТовара/Templates/МакетПечати/Ext/Template.txt',
        ];
        const docs = printContexts.map((relativePath, index) => doc({
            id: `print-context-${index}`,
            content: 'Процедура Печать() ТабличныйДокумент = Новый ТабличныйДокумент; КонецПроцедуры',
            relativePath,
            startLine: 1,
            endLine: 3,
        }));
        const vectorDatabase = createDb(docs);
        vectorDatabase.bgeM3SearchResults = docs.map((document) => ({ document, score: 0.4 }));
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'печать расходной накладной макет табличный документ', 10);

        expect(results.map((result) => result.relativePath)).toEqual(expect.arrayContaining(printContexts));
        expect(results.every((result) => (result.metadata?.oneCIntentBoost || 0) > 0)).toBe(true);
    });

    it('surfaces stock report contexts above broad document modules for stock-balance report intent', async () => {
        const report = doc({
            id: 'stock-report',
            content: 'Отчет ОстаткиТоваровНаСкладах Склад Товар КоличествоОстаток Сформировать',
            relativePath: 'src/cf/Reports/ОстаткиТоваровНаСкладах/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml',
            startLine: 1,
            endLine: 3,
        });
        const stockList = doc({
            id: 'stock-list',
            content: 'Форма списка с остатками по складу ТоварныеЗапасыОстатки Склад',
            relativePath: 'src/cf/Catalogs/Товары/Forms/ФормаСпискаСОстатками/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const broadDocument = doc({
            id: 'broad-document',
            content: 'Расход товара склад остатки товар документ движение склад',
            relativePath: 'src/cf/Documents/РасходТовара/Ext/ObjectModule.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([report, stockList, broadDocument]);
        vectorDatabase.bgeM3SearchResults = [
            { document: broadDocument, score: 0.7 },
            { document: report, score: 0.55 },
            { document: stockList, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'остатки товаров на складах отчет по складу', 3);

        expect(results[0].relativePath).toBe(report.relativePath);
        expect(results.map((result) => result.relativePath)).toContain(stockList.relativePath);
        expect(results[0].metadata?.oneCIntentBoost).toBeGreaterThan(0);
    });

    it('keeps a wider BGE-M3 rerank pool than requested topK so 1C path signals can rescue stock report candidates', async () => {
        const broadDocuments = Array.from({ length: 60 }, (_, index) => ({
            ...doc({
                id: `broad-rerank-${index}`,
                content: 'Расход товара склад остатки товар документ движение склад',
                relativePath: index % 2 === 0
                    ? 'src/cf/Documents/РасходТовара/Ext/ObjectModule.bsl'
                    : 'src/cf/CommonModules/ОбменМобильныеПереопределяемый/Ext/Module.bsl',
                startLine: index * 10 + 1,
                endLine: index * 10 + 3,
            }),
            colbertVectors: [[1, 0]],
        }));
        const report = {
            ...doc({
                id: 'late-stock-report',
                content: 'Отчет ОстаткиТоваровНаСкладах Склад Товар КоличествоОстаток Сформировать',
                relativePath: 'src/cf/Reports/ОстаткиТоваровНаСкладахМобильный/Forms/ФормаОтчета/Ext/Form/Module.bsl',
                startLine: 1,
                endLine: 3,
            }),
            colbertVectors: [[0.5, 0]],
        };
        const vectorDatabase = createDb([...broadDocuments, report]);
        vectorDatabase.bgeM3SearchResults = [
            ...broadDocuments.map((document, index) => ({ document, score: 1 - index * 0.01 })),
            { document: report, score: 0.5 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'остатки товаров на складах отчет по складу', 10);

        expect(results.map((result) => result.relativePath)).toContain(report.relativePath);
        expect(results[0].relativePath).toBe(report.relativePath);
    });

    it('surfaces product card contexts above scanner and barcode commands for product-card intent', async () => {
        const productCard = doc({
            id: 'product-card',
            content: 'Форма карточки товара Реквизиты Артикул ШтрихКод Цена Поставщик',
            relativePath: 'src/cf/Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const scannerCommand = doc({
            id: 'scanner-command',
            content: 'Настроить сканер штрихкодов подключение оборудования штрихкод',
            relativePath: 'src/cf/CommonCommands/НастроитьСканерШтрихКодов/Ext/CommandModule.bsl',
            startLine: 1,
            endLine: 3,
        });
        const barcodeCommand = doc({
            id: 'barcode-command',
            content: 'Печать штрихкода товара команда штрихкод',
            relativePath: 'src/cf/Catalogs/Товары/Commands/ПечатьШтрихкода/Ext/CommandModule.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([productCard, scannerCommand, barcodeCommand]);
        vectorDatabase.bgeM3SearchResults = [
            { document: scannerCommand, score: 0.65 },
            { document: barcodeCommand, score: 0.65 },
            { document: productCard, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'карточка товара реквизиты цена артикул штрихкод', 3);

        expect(results[0].relativePath).toBe(productCard.relativePath);
        expect(results[0].metadata?.oneCIntentBoost).toBeGreaterThan(0);
    });

    it('surfaces product object modules above barcode commands for attribute-card intent', async () => {
        const productObject = doc({
            id: 'product-object',
            content: 'Справочник Товары объект карточка товара реквизиты артикул штрихкод цена',
            relativePath: 'src/cf/Catalogs/Товары/Ext/ObjectModule.bsl',
            startLine: 1,
            endLine: 3,
        });
        const barcodeCommand = doc({
            id: 'barcode-command-object',
            content: 'Печать штрихкода товара команда штрихкод этикетка',
            relativePath: 'src/cf/Catalogs/Товары/Commands/ПечатьШтрихкода/Ext/CommandModule.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([productObject, barcodeCommand]);
        vectorDatabase.bgeM3SearchResults = [
            { document: barcodeCommand, score: 0.65 },
            { document: productObject, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'карточка товара реквизиты цена артикул штрихкод', 2);

        expect(results[0].relativePath).toBe(productObject.relativePath);
        expect(results[1].relativePath).toBe(barcodeCommand.relativePath);
    });

    it('keeps barcode print commands supported for explicit barcode print intent', async () => {
        const productCard = doc({
            id: 'product-card-print-counter',
            content: 'Форма карточки товара Реквизиты Артикул ШтрихКод Цена Поставщик',
            relativePath: 'src/cf/Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const barcodeCommand = doc({
            id: 'barcode-command-print-counter',
            content: 'Печать штрихкода товара команда штрихкод этикетка',
            relativePath: 'src/cf/Catalogs/Товары/Commands/ПечатьШтрихкода/Ext/CommandModule.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([productCard, barcodeCommand]);
        vectorDatabase.bgeM3SearchResults = [
            { document: productCard, score: 0.55 },
            { document: barcodeCommand, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'печать штрихкода товара этикетка', 2);

        expect(results[0].relativePath).toBe(barcodeCommand.relativePath);
        expect(results[0].metadata?.oneCIntentBoost).toBeGreaterThan(0);
        expect(results[0].metadata?.exactSymbolBoost).toBeGreaterThanOrEqual(0);
    });

    it('surfaces common forms whose path name nearly matches the query', async () => {
        const mobileSettings = doc({
            id: 'mobile-settings',
            content: 'Настройки выбора провайдера мобильного устройства мобильный клиент',
            relativePath: 'src/cf/CommonForms/НастройкиМобильногоУстройства/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const genericSettings = doc({
            id: 'generic-settings',
            content: 'Настройки пользователя форма настройки',
            relativePath: 'src/cf/DataProcessors/НастройкиПользователя/Forms/Форма/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([mobileSettings, genericSettings]);
        vectorDatabase.bgeM3SearchResults = [
            { document: genericSettings, score: 0.7 },
            { document: mobileSettings, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'настройки мобильного устройства форма настройки', 2);

        expect(results[0].relativePath).toBe(mobileSettings.relativePath);
        expect(results[0].metadata?.oneCObjectNameBoost).toBeGreaterThan(0);
    });

    it('keeps unknown and customized layouts neutral for 1C-specific signals', async () => {
        const unknown = doc({
            id: 'unknown-layout',
            content: 'Процедура Печать() КонецПроцедуры',
            relativePath: 'vendor/custom/objects/РасходТовара/forms/Print/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([unknown]);
        vectorDatabase.bgeM3SearchResults = [{ document: unknown, score: 0.8 }];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'печать расход товара форма документа', 1);

        expect(results[0].relativePath).toBe(unknown.relativePath);
        expect(results[0].metadata?.oneCObjectKindBoost).toBe(0);
        expect(results[0].metadata?.oneCObjectNameBoost).toBe(0);
        expect(results[0].metadata?.oneCIntentBoost).toBe(0);
    });

    it('applies soft duplicate control without removing exact or provider-backed chunks', async () => {
        const broadChunks = Array.from({ length: 11 }, (_, index) => doc({
            id: `broad-${index}`,
            content: index === 8
                ? 'Функция ТочныйСимволПечати() Экспорт Возврат Истина; КонецФункции'
                : 'Процедура Печать() товар товар товар форма КонецПроцедуры',
            relativePath: 'src/cf/Documents/РасходТовара/Ext/ObjectModule.bsl',
            startLine: index * 10 + 1,
            endLine: index * 10 + 3,
        }));
        const specific = doc({
            id: 'specific-command',
            content: 'Процедура ПечатьРасходнойНакладной() Печать(); КонецПроцедуры',
            relativePath: 'src/cf/Documents/РасходТовара/Commands/ПечатьРасходнойНакладной/Ext/CommandModule.bsl',
            startLine: 1,
            endLine: 4,
        });
        const provider = new FakeProvider();
        provider.candidates = [{
            providerName: 'rlm-tools-bsl',
            providerStatus: 'available',
            relativePath: broadChunks[8].relativePath,
            startLine: broadChunks[8].startLine,
            endLine: broadChunks[8].endLine,
            symbolName: 'ТочныйСимволПечати',
            providerRank: 0,
            lexicalScore: 4,
        }];
        const vectorDatabase = createDb([...broadChunks, specific]);
        vectorDatabase.bgeM3SearchResults = [
            ...broadChunks.map((document) => ({ document, score: 0.9 })),
            { document: specific, score: 0.75 },
        ];
        const context = createContext(vectorDatabase, [provider]);

        const results = await context.semanticSearch('/tmp/example', 'ТочныйСимволПечати печать расходной накладной', 10);

        expect(results.map((result) => result.relativePath)).toContain(specific.relativePath);
        expect(results.some((result) => result.metadata?.duplicatePenalty > 0)).toBe(true);
        expect(results.some((result) =>
            result.relativePath === broadChunks[8].relativePath &&
            result.metadata?.symbolName === 'ТочныйСимволПечати',
        )).toBe(true);
    });

    it('penalizes third-and-later broad duplicate chunks enough to keep distinct evidence visible', async () => {
        const broadChunks = Array.from({ length: 8 }, (_, index) => doc({
            id: `broad-stock-${index}`,
            content: 'остатки товаров склад документ движение товар склад отчет',
            relativePath: 'src/cf/Documents/РасходТовара/Ext/ObjectModule.bsl',
            startLine: index * 10 + 1,
            endLine: index * 10 + 3,
        }));
        const report = doc({
            id: 'stock-report-distinct',
            content: 'остатки товаров на складах отчет склад товар',
            relativePath: 'src/cf/Reports/ОстаткиТоваровНаСкладах/Forms/ФормаОтчета/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const stockList = doc({
            id: 'stock-list-distinct',
            content: 'остатки товаров по складу список товары склад',
            relativePath: 'src/cf/Catalogs/Товары/Forms/ФормаСпискаСОстатками/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 3,
        });
        const vectorDatabase = createDb([...broadChunks, report, stockList]);
        vectorDatabase.bgeM3SearchResults = [
            ...broadChunks.map((document) => ({ document, score: 0.8 })),
            { document: report, score: 0.6 },
            { document: stockList, score: 0.6 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'остатки товаров на складах отчет по складу', 5);

        expect(results.map((result) => result.relativePath)).toContain(report.relativePath);
        expect(results.map((result) => result.relativePath)).toContain(stockList.relativePath);
        expect(results.filter((result) => result.relativePath === broadChunks[0].relativePath).length).toBeLessThanOrEqual(3);
        expect(results.some((result) => result.metadata?.duplicatePenalty >= 1.2)).toBe(true);
    });

    it('surfaces FNS counterparty response handling above generic queue-processing modules', async () => {
        const fnsModule = doc({
            id: 'fns-counterparty',
            content: 'NdsResponse ОтветФНС ПроверкаКонтрагентов СостояниеКонтрагента ИНН КПП',
            relativePath: 'src/cf/CommonModules/ПроверкаКонтрагентовФНС/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const queueModule = doc({
            id: 'generic-queue-processing',
            content: 'Обработка очереди состояние контрагентов проверка обмена',
            relativePath: 'src/cf/CommonModules/ОбработкаОчередиЗаданий/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([fnsModule, queueModule]);
        vectorDatabase.bgeM3SearchResults = [
            { document: queueModule, score: 0.85 },
            { document: fnsModule, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'NdsResponse ответ ФНС состояние проверки контрагента', 2);

        expect(results[0].relativePath).toBe(fnsModule.relativePath);
        expect(results[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('surfaces saved counterparty state server-call modules above broad exchange modules', async () => {
        const stateModule = doc({
            id: 'counterparty-state',
            content: 'Сохраненное состояние контрагента ИНН КПП загрузить состояние проверки',
            relativePath: 'src/cf/CommonModules/ПроверкаКонтрагентовКлиентСервер/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const exchangeModule = doc({
            id: 'counterparty-exchange',
            content: 'Обмен с контрагентами загрузка реквизитов организация контрагент',
            relativePath: 'src/cf/CommonModules/ОбменСКонтрагентамиВызовСервера/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([stateModule, exchangeModule]);
        vectorDatabase.bgeM3SearchResults = [
            { document: exchangeModule, score: 0.8 },
            { document: stateModule, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'где хранится сохраненное состояние контрагента по ИНН КПП', 2);

        expect(results[0].relativePath).toBe(stateModule.relativePath);
        expect(results[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('surfaces MCHD constant manager modules above generic signature-check forms', async () => {
        const constantManager = doc({
            id: 'mchd-registry-constant',
            content: 'АдресРеестраМЧД ФНС адрес реестра машиночитаемых доверенностей',
            relativePath: 'src/cf/Constants/АдресРеестраМЧД/Ext/ManagerModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const signatureForm = doc({
            id: 'generic-signature-form',
            content: 'Результаты проверки подписи полномочия доверенности МЧД ФНС',
            relativePath: 'src/cf/DataProcessors/РезультатыПроверкиПодписи/Forms/ПроверкаПолномочийДоверенности/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([constantManager, signatureForm]);
        vectorDatabase.bgeM3SearchResults = [
            { document: signatureForm, score: 0.8 },
            { document: constantManager, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'адрес реестра МЧД ФНС константа менеджер', 2);

        expect(results[0].relativePath).toBe(constantManager.relativePath);
        expect(results[0].metadata?.oneCObjectKindBoost).toBeGreaterThan(0);
        expect(results[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('surfaces inbound and outbound EDI viewing forms above broad MCHD modules', async () => {
        const inboundForm = doc({
            id: 'inbound-edi-form',
            content: 'Входящий ЭДО форма просмотра ручная проверка подписи МЧД',
            relativePath: 'src/cf/Documents/ЭлектронныйДокументВходящийЭДО/Forms/ФормаПросмотра/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const outboundForm = doc({
            id: 'outbound-edi-form',
            content: 'Исходящий ЭДО форма просмотра ручная проверка подписи МЧД',
            relativePath: 'src/cf/Documents/ЭлектронныйДокументИсходящийЭДО/Forms/ФормаПросмотра/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const broadMchd = doc({
            id: 'broad-mchd',
            content: 'МЧД доверенности подписи ЭДО проверка полномочий общий модуль',
            relativePath: 'src/cf/CommonModules/МашиночитаемыеДоверенностиИнтеграцияЦентраЭДО/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([inboundForm, outboundForm, broadMchd]);
        vectorDatabase.bgeM3SearchResults = [
            { document: broadMchd, score: 0.85 },
            { document: outboundForm, score: 0.55 },
            { document: inboundForm, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const inboundResults = await context.semanticSearch('/tmp/example', 'входящий ЭДО форма просмотра проверка МЧД подписи', 3);
        const outboundResults = await context.semanticSearch('/tmp/example', 'исходящий ЭДО форма просмотра проверка МЧД подписи', 3);

        expect(inboundResults[0].relativePath).toBe(inboundForm.relativePath);
        expect(outboundResults[0].relativePath).toBe(outboundForm.relativePath);
        expect(inboundResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
        expect(outboundResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('surfaces send-assistant form intent above common helper modules', async () => {
        const sendAssistantForm = doc({
            id: 'send-assistant-form',
            content: 'Помощник отправить форма дерево вариантов проверка возможности отправки',
            relativePath: 'src/cf/CommonForms/ПомощникОтправить/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const helperModule = doc({
            id: 'send-assistant-helper',
            content: 'Помощник отправить клиент общий модуль варианты отправки',
            relativePath: 'src/cf/CommonModules/ПомощникОтправитьКлиент/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([sendAssistantForm, helperModule]);
        vectorDatabase.bgeM3SearchResults = [
            { document: helperModule, score: 0.8 },
            { document: sendAssistantForm, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'помощник отправить форма дерево вариантов проверка отправки', 2);

        expect(results[0].relativePath).toBe(sendAssistantForm.relativePath);
        expect(results[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('surfaces email print and save journal forms above account setup forms', async () => {
        const printForm = doc({
            id: 'email-print-form',
            content: 'Печать письма журнал электронная почта форма печати',
            relativePath: 'src/cf/DocumentJournals/ЭлектроннаяПочта/Forms/ПечатьПисьма/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const saveForm = doc({
            id: 'email-save-form',
            content: 'Сохранение письма журнал электронная почта вложения',
            relativePath: 'src/cf/DocumentJournals/ЭлектроннаяПочта/Forms/СохранениеПисьма/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const accountSetup = doc({
            id: 'email-account-setup',
            content: 'Настройка почты smtp учетная запись электронная почта',
            relativePath: 'src/cf/DataProcessors/НастройкаПочты/Forms/НастройкиВстроеннойПочты/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([printForm, saveForm, accountSetup]);
        vectorDatabase.bgeM3SearchResults = [
            { document: accountSetup, score: 0.8 },
            { document: printForm, score: 0.45 },
            { document: saveForm, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const printResults = await context.semanticSearch('/tmp/example', 'печать письма журнал электронной почты форма', 3);
        const saveResults = await context.semanticSearch('/tmp/example', 'сохранение письма электронная почта форма журнала', 3);

        expect(printResults[0].relativePath).toBe(printForm.relativePath);
        expect(saveResults[0].relativePath).toBe(saveForm.relativePath);
        expect(printResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
        expect(saveResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('adds compound-name diagnostics for email journal form names', async () => {
        const printForm = doc({
            id: 'email-print-compound',
            content: 'Печать письма журнал электронная почта форма печати',
            relativePath: 'src/cf/DocumentJournals/ЭлектроннаяПочта/Forms/ПечатьПисьма/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const attachmentForm = doc({
            id: 'email-attachment-compound',
            content: 'Просмотр вложенного письма вложение файл',
            relativePath: 'src/cf/DocumentJournals/ЭлектроннаяПочта/Forms/ПросмотрВложенногоПисьма/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const accountSetup = doc({
            id: 'email-account-compound',
            content: 'Настройка учетной записи smtp почта',
            relativePath: 'src/cf/DataProcessors/НастройкаПочты/Forms/НастройкиВстроеннойПочты/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([printForm, attachmentForm, accountSetup]);
        vectorDatabase.bgeM3SearchResults = [
            { document: accountSetup, score: 0.8 },
            { document: printForm, score: 0.45 },
            { document: attachmentForm, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const printResults = await context.semanticSearch('/tmp/example', 'форма печати письма в журнале электронной почты', 3);
        const attachmentResults = await context.semanticSearch('/tmp/example', 'просмотр вложенного письма форма журнала электронной почты', 3);

        expect(printResults[0].relativePath).toBe(printForm.relativePath);
        expect(attachmentResults[0].relativePath).toBe(attachmentForm.relativePath);
        expect(printResults[0].metadata?.oneCCompoundNameBoost).toBeGreaterThan(0);
        expect(attachmentResults[0].metadata?.oneCCompoundNameEvidence?.matchedTerms).toEqual(expect.arrayContaining(['просмотр', 'вложенного', 'письма']));
    });

    it('adds compound-name diagnostics for MCHD constants and counterparty state modules', async () => {
        const constantManager = doc({
            id: 'mchd-compound',
            content: 'АдресРеестраМЧД ФНС адрес реестра машиночитаемых доверенностей',
            relativePath: 'src/cf/Constants/АдресРеестраМЧД/Ext/ManagerModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const stateModule = doc({
            id: 'counterparty-state-compound',
            content: 'Сохраненное состояние контрагента ИНН КПП загрузить состояние проверки',
            relativePath: 'src/cf/CommonModules/ПроверкаКонтрагентовКлиентСервер/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const generic = doc({
            id: 'generic-mchd-counterparty',
            content: 'МЧД подписи контрагенты проверки состояние обмена',
            relativePath: 'src/cf/CommonModules/ОбменСКонтрагентами/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([constantManager, stateModule, generic]);
        vectorDatabase.bgeM3SearchResults = [
            { document: generic, score: 0.8 },
            { document: constantManager, score: 0.45 },
            { document: stateModule, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const constantResults = await context.semanticSearch('/tmp/example', 'адрес реестра МЧД ФНС константа менеджер', 3);
        const stateResults = await context.semanticSearch('/tmp/example', 'сохраненное состояние контрагента по ИНН КПП клиент сервер', 3);

        expect(constantResults[0].relativePath).toBe(constantManager.relativePath);
        expect(stateResults[0].relativePath).toBe(stateModule.relativePath);
        expect(constantResults[0].metadata?.oneCCompoundNameBoost).toBeGreaterThan(0);
        expect(stateResults[0].metadata?.oneCCompoundNameBoost).toBeGreaterThan(0);
    });

    it('supports SMS service-module acceptability and SMS notification document intent', async () => {
        const smsService = doc({
            id: 'sms-service',
            content: 'Отправка SMS клиент провайдер сервис доставка сообщения',
            relativePath: 'src/cf/CommonModules/ОтправкаSMSКлиент/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const smsDocument = doc({
            id: 'sms-document',
            content: 'Документ уведомление по SMS статус лимиты жизненный цикл',
            relativePath: 'src/cf/Documents/УведомлениеПоSMS/Ext/ManagerModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const genericNotification = doc({
            id: 'generic-notification',
            content: 'Уведомления пользователи сообщение состояние отправка',
            relativePath: 'src/cf/CommonForms/НастройкаУведомлений/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([smsService, smsDocument, genericNotification]);
        vectorDatabase.bgeM3SearchResults = [
            { document: genericNotification, score: 0.85 },
            { document: smsService, score: 0.5 },
            { document: smsDocument, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const serviceResults = await context.semanticSearch('/tmp/example', 'отправка SMS через провайдера сервисный модуль', 3);
        const documentResults = await context.semanticSearch('/tmp/example', 'документ уведомление по SMS статус лимиты форма', 3);

        expect(serviceResults[0].relativePath).toBe(smsService.relativePath);
        expect(documentResults[0].relativePath).toBe(smsDocument.relativePath);
        expect(serviceResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
        expect(documentResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
    });

    it('separates archive-transfer manager and object contexts from generic archive forms', async () => {
        const archiveManager = doc({
            id: 'archive-manager',
            content: 'Передача дел в архив менеджер печатная опись реестр',
            relativePath: 'src/cf/Documents/ПередачаДелВАрхив/Ext/ManagerModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const archiveObject = doc({
            id: 'archive-object',
            content: 'Передача дел в архив объект проверка подписей интеграция',
            relativePath: 'src/cf/Documents/ПередачаДелВАрхив/Ext/ObjectModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const genericArchive = doc({
            id: 'generic-archive-settings',
            content: 'Архив сертификаты хранилище настройка подписи',
            relativePath: 'src/cf/DataProcessors/НастройкаИнтеграцииСАрхивом/Forms/НастройкаИнтеграцииСАрхивом/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([archiveManager, archiveObject, genericArchive]);
        vectorDatabase.bgeM3SearchResults = [
            { document: genericArchive, score: 0.85 },
            { document: archiveObject, score: 0.5 },
            { document: archiveManager, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const managerResults = await context.semanticSearch('/tmp/example', 'передача дел в архив менеджер печатная опись', 3);
        const objectResults = await context.semanticSearch('/tmp/example', 'передача дел в архив объект проверка подписей', 3);

        expect(managerResults[0].relativePath).toBe(archiveManager.relativePath);
        expect(objectResults[0].relativePath).toBe(archiveObject.relativePath);
        expect(managerResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
        expect(objectResults[0].metadata?.oneCScenarioIntentBoost).toBeGreaterThan(0);
        expect(managerResults[0].metadata?.oneCCompoundNameBoost).toBeGreaterThan(0);
        expect(objectResults[0].metadata?.oneCCompoundNameBoost).toBeGreaterThan(0);
    });

    it('adds compound-name support for EDI message signature forms without over-ranking broad EDI queries', async () => {
        const signatureForm = doc({
            id: 'edi-signature-form-compound',
            content: 'Сообщение ЭДО подписи форма проверка подписи',
            relativePath: 'src/cf/Documents/СообщениеЭДО/Forms/Подписи/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const broadEdi = doc({
            id: 'broad-edi-module',
            content: 'ЭДО обмен документами общий модуль интеграции маршрутизация',
            relativePath: 'src/cf/CommonModules/ИнтеграцияЭДО/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([signatureForm, broadEdi]);
        vectorDatabase.bgeM3SearchResults = [
            { document: broadEdi, score: 0.8 },
            { document: signatureForm, score: 0.45 },
        ];
        const context = createContext(vectorDatabase);

        const signatureResults = await context.semanticSearch('/tmp/example', 'форма подписи сообщения ЭДО проверка подписи', 2);
        const broadResults = await context.semanticSearch('/tmp/example', 'ЭДО обмен документами общий модуль интеграции', 2);

        expect(signatureResults[0].relativePath).toBe(signatureForm.relativePath);
        expect(signatureResults[0].metadata?.oneCCompoundNameBoost).toBeGreaterThan(0);
        expect(broadResults[0].relativePath).toBe(broadEdi.relativePath);
        expect(broadResults.find((result) => result.relativePath === signatureForm.relativePath)?.metadata?.oneCCompoundNameBoost || 0).toBeLessThan(0.5);
    });

    it('keeps broad email and MCHD negative controls from exact-looking compound forms', async () => {
        const printForm = doc({
            id: 'email-negative-print',
            content: 'Печать письма журнал электронная почта форма печати',
            relativePath: 'src/cf/DocumentJournals/ЭлектроннаяПочта/Forms/ПечатьПисьма/Ext/Form/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const mailSettings = doc({
            id: 'email-settings-negative',
            content: 'Настройка электронной почты учетная запись smtp сервер',
            relativePath: 'src/cf/DataProcessors/НастройкаПочты/Forms/НастройкиВстроеннойПочты/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const registryAddress = doc({
            id: 'mchd-negative-address',
            content: 'АдресРеестраМЧД ФНС адрес реестра машиночитаемых доверенностей',
            relativePath: 'src/cf/Constants/АдресРеестраМЧД/Ext/ManagerModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const signatureCheck = doc({
            id: 'mchd-negative-signature',
            content: 'МЧД проверка полномочий подписи доверенность форма результата',
            relativePath: 'src/cf/DataProcessors/РезультатыПроверкиПодписи/Forms/ПроверкаПолномочийДоверенности/Ext/Form.xml',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([printForm, mailSettings, registryAddress, signatureCheck]);
        vectorDatabase.bgeM3SearchResults = [
            { document: printForm, score: 0.55 },
            { document: mailSettings, score: 0.8 },
            { document: registryAddress, score: 0.55 },
            { document: signatureCheck, score: 0.8 },
        ];
        const context = createContext(vectorDatabase);

        const emailResults = await context.semanticSearch('/tmp/example', 'настройка электронной почты учетная запись smtp', 2);
        const mchdResults = await context.semanticSearch('/tmp/example', 'МЧД проверка полномочий подписи доверенность форма результата', 2);

        expect(emailResults[0].relativePath).toBe(mailSettings.relativePath);
        expect(mchdResults[0].relativePath).toBe(signatureCheck.relativePath);
        expect(emailResults.find((result) => result.relativePath === printForm.relativePath)?.metadata?.oneCCompoundNameBoost || 0).toBe(0);
        expect(mchdResults.find((result) => result.relativePath === registryAddress.relativePath)?.metadata?.oneCCompoundNameBoost || 0).toBeLessThanOrEqual(0.5);
    });

    it('dampens generic term dominance only when specific scenario evidence exists', async () => {
        const fnsModule = doc({
            id: 'fns-specific-dampening',
            content: 'NdsResponse ФНС проверка контрагента ИНН КПП',
            relativePath: 'src/cf/CommonModules/ПроверкаКонтрагентовФНС/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const genericProcessing = doc({
            id: 'generic-processing-dampening',
            content: 'Обработка состояние проверка подпись настройка документ форма письмо',
            relativePath: 'src/cf/CommonModules/ОбщаяОбработкаСостояний/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([fnsModule, genericProcessing]);
        vectorDatabase.bgeM3SearchResults = [
            { document: genericProcessing, score: 1.1 },
            { document: fnsModule, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'NdsResponse ФНС обработка состояние проверка контрагента', 2);

        expect(results[0].relativePath).toBe(fnsModule.relativePath);
        expect(results.find((result) => result.relativePath === genericProcessing.relativePath)?.metadata?.oneCGenericTermPenalty).toBeGreaterThan(0);
    });

    it('keeps broad common modules neutral for broad 1C subsystem queries', async () => {
        const broadMchd = doc({
            id: 'broad-mchd-neutral',
            content: 'МЧД доверенности ЭДО подписи полномочия интеграция',
            relativePath: 'src/cf/CommonModules/МашиночитаемыеДоверенностиИнтеграцияЦентраЭДО/Ext/Module.bsl',
            startLine: 1,
            endLine: 5,
        });
        const exactConstant = doc({
            id: 'constant-neutral',
            content: 'Адрес реестра МЧД',
            relativePath: 'src/cf/Constants/АдресРеестраМЧД/Ext/ManagerModule.bsl',
            startLine: 1,
            endLine: 5,
        });
        const vectorDatabase = createDb([broadMchd, exactConstant]);
        vectorDatabase.bgeM3SearchResults = [
            { document: broadMchd, score: 0.8 },
            { document: exactConstant, score: 0.55 },
        ];
        const context = createContext(vectorDatabase);

        const results = await context.semanticSearch('/tmp/example', 'МЧД доверенности ЭДО интеграция', 2);

        expect(results[0].relativePath).toBe(broadMchd.relativePath);
        expect(results[0].metadata?.oneCGenericTermPenalty).toBe(0);
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

    it('keeps exact-symbol and provider-backed ordering active under generic profile', async () => {
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
            { document: relatedDistractor, score: 0.99 },
        ];
        const context = createContext(vectorDatabase, [provider]);

        const results = await context.semanticSearch(
            '/tmp/example',
            'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            3,
            0.5,
            undefined,
            { rankingProfile: 'generic' },
        );

        expect(results[0].relativePath).toBe(exactSymbolDocument.relativePath);
        expect(results[0].metadata?.rankingProfile).toBe('generic');
        expect(results[0].metadata?.exactSymbolBoost).toBeGreaterThan(0);
        expect(results[0].metadata?.providerRankBoost).toBeGreaterThan(0);
        expect(results[0].metadata?.oneCObjectKindBoost).toBe(0);
        expect(results[0].metadata?.oneCObjectNameBoost).toBe(0);
        expect(results[0].metadata?.oneCIntentBoost).toBe(0);
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
