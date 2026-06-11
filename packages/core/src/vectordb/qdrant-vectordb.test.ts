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
