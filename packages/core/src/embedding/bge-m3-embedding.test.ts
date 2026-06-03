import { BgeM3Embedding } from './bge-m3-embedding';

function jsonResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
    } as Response;
}

describe('BgeM3Embedding', () => {
    it('returns dense, sparse, and ColBERT vectors in full mode', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse({
            dense: [0.1, 0.2, 0.3],
            sparse: {
                indices: [10, 20],
                values: [0.7, 0.8],
            },
            colbert: [
                [0.01, 0.02],
                [0.03, 0.04],
            ],
        }));

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'full',
            fetch: fetchMock,
        });

        const result = await embedding.embedMulti('query text');

        expect(result).toEqual({
            dense: {
                vector: [0.1, 0.2, 0.3],
                dimension: 3,
            },
            sparse: {
                indices: [10, 20],
                values: [0.7, 0.8],
            },
            colbert: {
                vectors: [
                    [0.01, 0.02],
                    [0.03, 0.04],
                ],
                dimension: 2,
                tokenCount: 2,
            },
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:8000/embed',
            expect.objectContaining({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    input: 'query text',
                    model: 'BAAI/bge-m3',
                    mode: 'full',
                }),
            }),
        );
    });

    it('rejects full mode responses that omit sparse or ColBERT vectors', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse({
            dense: [0.1, 0.2, 0.3],
        }));

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'full',
            fetch: fetchMock,
        });

        await expect(embedding.embedMulti('query text')).rejects.toThrow(
            'BGE-M3 full mode requires dense, sparse, and ColBERT vectors',
        );
    });

    it('allows dense-only responses only when mode is dense', async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse({
            dense: [0.1, 0.2, 0.3],
        }));

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'dense',
            fetch: fetchMock,
        });

        const result = await embedding.embedMulti('query text');

        expect(result).toEqual({
            dense: {
                vector: [0.1, 0.2, 0.3],
                dimension: 3,
            },
        });
        expect(embedding.getRetrievalMode()).toBe('BGE-M3 dense-only');
    });
});
