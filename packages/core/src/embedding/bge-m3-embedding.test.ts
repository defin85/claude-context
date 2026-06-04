import { BgeM3Embedding } from './bge-m3-embedding';

function jsonResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
    } as Response;
}

const fullMetadata = {
    model: 'BAAI/bge-m3',
    default_mode: 'full',
    supported_modes: ['full', 'dense'],
    outputs: ['dense', 'sparse', 'colbert'],
    dense_dimension: 1024,
    precision: 'fp16',
    max_tokens: 8192,
    preprocessing_profile: 'bge-m3-default-v1',
};

const fullEmbedding = {
    dense: [0.1, 0.2, 0.3],
    sparse: {
        indices: [10, 20],
        values: [0.7, 0.8],
    },
    colbert: [
        [0.01, 0.02],
        [0.03, 0.04],
    ],
};

describe('BgeM3Embedding', () => {
    it('returns dense, sparse, and ColBERT vectors in full mode', async () => {
        const fetchMock = jest.fn((url: string) => Promise.resolve(
            jsonResponse(url.endsWith('/metadata') ? fullMetadata : fullEmbedding),
        ));

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
        const fetchMock = jest.fn((url: string) => Promise.resolve(
            jsonResponse(url.endsWith('/metadata') ? fullMetadata : { dense: [0.1, 0.2, 0.3] }),
        ));

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
        const fetchMock = jest.fn((url: string) => Promise.resolve(
            jsonResponse(url.endsWith('/metadata')
                ? {
                    ...fullMetadata,
                    default_mode: 'dense',
                    outputs: ['dense'],
                }
                : { dense: [0.1, 0.2, 0.3] }),
        ));

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

    it('rejects worker endpoints with mismatched metadata', async () => {
        const fetchMock = jest.fn((url: string) => {
            if (url === 'http://127.0.0.1:8000/metadata') {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8001/metadata') {
                return Promise.resolve(jsonResponse({
                    ...fullMetadata,
                    model: 'different-model',
                }));
            }
            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            workerEndpoints: ['http://127.0.0.1:8001'],
            mode: 'full',
            fetch: fetchMock,
        });

        await embedding.embedMultiBatchWithWorkerPool(['query text']);

        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: true,
            }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: false,
                rejectedReason: expect.stringContaining('model mismatch'),
            }),
        ]);
    });

    it('retries failed batches on another healthy worker', async () => {
        let retryCount = 0;
        const fetchMock = jest.fn((url: string, init: RequestInit) => {
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8000/embed_batch' && init.method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                    json: async () => ({}),
                } as Response);
            }
            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            workerEndpoints: ['http://127.0.0.1:8001'],
            mode: 'full',
            retryBudget: 1,
            fetch: fetchMock,
        });

        const [result] = await embedding.embedMultiBatchWithWorkerPool(['query text'], () => {
            retryCount++;
        });

        expect(result.dense.vector).toEqual([0.1, 0.2, 0.3]);
        expect(retryCount).toBe(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:8001/embed_batch',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: false,
                rejectedReason: expect.stringContaining('500 Internal Server Error'),
            }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: true,
            }),
        ]);
    });

    it('uses only the primary endpoint for regular batch embedding', async () => {
        const fetchMock = jest.fn((url: string) => Promise.resolve(
            jsonResponse(url.endsWith('/metadata') ? fullMetadata : [fullEmbedding]),
        ));

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            workerEndpoints: ['http://127.0.0.1:8001'],
            mode: 'full',
            fetch: fetchMock,
        });

        const [result] = await embedding.embedMultiBatch(['query text']);

        expect(result.dense.vector).toEqual([0.1, 0.2, 0.3]);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:8000/embed_batch',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(fetchMock).not.toHaveBeenCalledWith(
            'http://127.0.0.1:8001/embed_batch',
            expect.anything(),
        );
    });
});
