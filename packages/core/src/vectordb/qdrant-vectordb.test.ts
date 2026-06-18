import { QdrantVectorDatabase } from './qdrant-vectordb';

describe('QdrantVectorDatabase filters', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('translates lexical like filters to Qdrant text matches', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({ result: { points: [] } }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        await db.query('chunks', 'content like "%ПараметрыЗаполнения%"', ['content'], 5);

        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
            filter: {
                must: [{
                    key: 'content',
                    match: { text: 'ПараметрыЗаполнения' },
                }],
            },
        }));
    });

    it('translates extension filters to Qdrant any matches', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({ result: { points: [] } }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        await db.query('chunks', "fileExtension in ['.ts', '.py']", ['content'], 5);

        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
            filter: {
                must: [{
                    key: 'fileExtension',
                    match: { any: ['.ts', '.py'] },
                }],
            },
        }));
    });
});

describe('QdrantVectorDatabase BGE-M3 full retrieval', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('requests ColBERT vectors for rerank candidates and maps them to documents', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({
                result: {
                    points: [{
                        id: 'point-1',
                        score: 0.75,
                        payload: {
                            id: 'chunk-1',
                            content: 'Процедура Печать()',
                            relativePath: 'Documents/РасходТовара/Ext/ObjectModule.bsl',
                            startLine: 10,
                            endLine: 20,
                            fileExtension: '.bsl',
                            metadata: {
                                retrievalMode: 'bge_m3_full',
                            },
                        },
                        vector: {
                            colbert: [
                                [0.1, 0.2],
                                [0.3, 0.4],
                            ],
                        },
                    }],
                },
            }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        const results = await db.bgeM3HybridSearch(
            'chunks',
            [
                { data: [0.1, 0.2], anns_field: 'dense_vector', param: {}, limit: 20 },
                { data: { indices: [1], values: [0.5] }, anns_field: 'sparse_vector', param: {}, limit: 20 },
            ],
            { limit: 10 },
        );

        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body).toEqual(expect.objectContaining({
            with_payload: true,
            with_vector: ['colbert'],
            prefetch: [
                expect.objectContaining({ using: 'dense' }),
                expect.objectContaining({ using: 'sparse' }),
            ],
        }));
        expect(results[0].document.colbertVectors).toEqual([
            [0.1, 0.2],
            [0.3, 0.4],
        ]);
    });

    it('keeps dense search payload-only', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({ result: { points: [] } }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        await db.search('chunks', [0.1, 0.2], { topK: 5 });

        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
            with_vector: false,
        }));
    });

    it('omits sparse and ColBERT vectors when inserting dense-only BGE-M3 documents', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({ result: { operation_id: 1, status: 'completed' } }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        await db.insert('bge_m3_dense_code_chunks_test', [{
            id: 'chunk-1',
            vector: [0.1, 0.2],
            content: 'content',
            relativePath: 'file.bsl',
            startLine: 1,
            endLine: 2,
            fileExtension: '.bsl',
            metadata: { retrievalMode: 'bge_m3_dense' },
        }]);

        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.points[0].vector).toEqual({
            dense: [0.1, 0.2],
        });
    });

    it('declares parallel-safe idempotent upsert write capabilities', () => {
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        expect(db.getWriteCapabilities('chunks')).toEqual(expect.objectContaining({
            parallelWritesToSameCollection: true,
            idempotentUpsert: true,
            recommendedInsertConcurrency: 4,
            writeCoalescingRecommended: true,
            ambiguousWriteFailureMode: 'retry_safe',
        }));
    });

    it('allows concurrent same-collection BGE-M3 upserts through the adapter', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({ result: { operation_id: 1, status: 'completed' } }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });
        const document = {
            id: 'chunk-1',
            vector: [0.1, 0.2],
            sparseVector: { indices: [1], values: [0.5] },
            colbertVectors: [[0.1, 0.2]],
            content: 'content',
            relativePath: 'file.ts',
            startLine: 1,
            endLine: 2,
            fileExtension: '.ts',
            metadata: { retrievalMode: 'bge_m3_full' },
        };

        await expect(Promise.all([
            db.upsertBgeM3('chunks', [document]),
            db.upsertBgeM3('chunks', [{ ...document, id: 'chunk-2' }]),
        ])).resolves.toEqual([undefined, undefined]);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.every((call) => String(call[0]).includes('/collections/chunks/points?wait=true'))).toBe(true);
        expect(fetchMock.mock.calls.every((call) => (
            (call[1]?.headers as Record<string, string> | undefined)?.connection === 'close'
        ))).toBe(true);
    });

    it('retries transient fetch failures for idempotent Qdrant upserts', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ result: { operation_id: 1, status: 'completed' } }),
            } as Response);
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        await expect(db.upsertBgeM3('chunks', [{
            id: 'chunk-1',
            vector: [0.1, 0.2],
            sparseVector: { indices: [1], values: [0.5] },
            colbertVectors: [[0.1, 0.2]],
            content: 'content',
            relativePath: 'file.ts',
            startLine: 1,
            endLine: 2,
            fileExtension: '.ts',
            metadata: { retrievalMode: 'bge_m3_full' },
        }])).resolves.toBeUndefined();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.every((call) => String(call[0]).includes('/collections/chunks/points?wait=true'))).toBe(true);
    });
});

describe('QdrantVectorDatabase payload projection', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('maps metadata_json projection to metadata payload for code-symbol retrieval compatibility', async () => {
        const metadata = { language: 'bsl', retrievalMode: 'bge_m3_full' };
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({
                result: {
                    points: [{
                        payload: {
                            id: 'chunk-1',
                            content: 'Процедура Печать()',
                            relativePath: 'Documents/РасходТовара/Ext/ObjectModule.bsl',
                            startLine: 10,
                            endLine: 20,
                            fileExtension: '.bsl',
                            metadata,
                        },
                    }],
                },
            }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        const rows = await db.query(
            'chunks',
            'content like "%Печать%"',
            ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata', 'metadata_json'],
            5,
        );

        expect(rows[0]).toEqual({
            id: 'chunk-1',
            content: 'Процедура Печать()',
            relativePath: 'Documents/РасходТовара/Ext/ObjectModule.bsl',
            startLine: 10,
            endLine: 20,
            fileExtension: '.bsl',
            metadata,
            metadata_json: metadata,
        });
    });
});

describe('QdrantVectorDatabase collection compatibility metadata', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('describes BGE-M3 full collections from Qdrant vector schema', async () => {
        const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
            ok: true,
            json: async () => ({
                result: {
                    config: {
                        params: {
                            vectors: {
                                dense: { size: 1024 },
                                colbert: { size: 1024 },
                            },
                            sparse_vectors: {
                                sparse: {},
                            },
                        },
                    },
                },
            }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;
        const db = new QdrantVectorDatabase({ url: 'http://qdrant.local' });

        await expect(db.getCollectionDescription('bge_m3_code_chunks_f390eec0')).resolves.toContain('retrievalMode:bge_m3_full');
        await expect(db.getCollectionDescription('bge_m3_code_chunks_f390eec0')).resolves.toContain('retrievalSchemaVersion:1');
    });
});
