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
    dense_dimension: 3,
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
                rejectedFailureReason: 'metadata',
                rejectedRetrySafe: false,
            }),
        ]);
    });

    it('rejects a primary worker with incompatible metadata before dispatching batches', async () => {
        const fetchMock = jest.fn((url: string) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse({
                    ...fullMetadata,
                    model: 'different-model',
                }));
            }
            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'full',
            fetch: fetchMock,
        });

        await expect(embedding.embedMultiBatchWithWorkerPool(['query text'])).rejects.toThrow(
            'No healthy BGE-M3 workers available',
        );

        expect(fetchMock).not.toHaveBeenCalledWith(
            'http://127.0.0.1:8000/embed_batch',
            expect.anything(),
        );
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: false,
                rejectedReason: expect.stringContaining('model mismatch'),
                rejectedFailureReason: 'metadata',
                rejectedRetrySafe: false,
                poolState: 'rejected',
            }),
        ]);
    });

    it('classifies embedding timeout as retry-safe and reports the reason to retry callbacks', async () => {
        const retryReasons: string[] = [];
        const fetchMock = jest.fn((url: string, init: RequestInit) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8000/embed_batch' && init.method === 'POST') {
                return Promise.reject(new Error('request timeout after 1000ms'));
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

        const [result] = await embedding.embedMultiBatchWithWorkerPool(['query text'], (_endpoint, _error, failure) => {
            retryReasons.push(`${failure?.reason}:${failure?.retrySafe}`);
        });

        expect(result.dense.vector).toEqual([0.1, 0.2, 0.3]);
        expect(retryReasons).toEqual(['embedding_timeout:true']);
        expect(embedding.getWorkerSnapshot()[0]).toEqual(expect.objectContaining({
            endpoint: 'http://127.0.0.1:8000',
            healthy: false,
            rejectedFailureReason: 'embedding_timeout',
            rejectedRetrySafe: true,
        }));
    });

    it('does not reject a worker when cancellation interrupts an active batch', async () => {
        const cancellation = new Error('cancelled by operator');
        cancellation.name = 'AbortError';
        const fetchMock = jest.fn((url: string) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            return Promise.reject(cancellation);
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'full',
            retryBudget: 1,
            fetch: fetchMock,
        });

        await expect(embedding.embedMultiBatchWithWorkerPool(['query text'])).rejects.toThrow('cancelled by operator');

        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: true,
                rejectedReason: undefined,
                rejectedFailureReason: undefined,
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
                rejectedFailureReason: 'embedding_error',
                rejectedRetrySafe: true,
                lastFailureAt: expect.any(String),
                recoveryAttempts: 0,
                poolState: 'rejected',
            }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: true,
                lastSuccessAt: expect.any(String),
                poolState: 'accepted',
            }),
        ]);
    });

    it('enforces the retry budget and surfaces exhausted worker context', async () => {
        let retryCount = 0;
        const fetchMock = jest.fn((url: string) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            return Promise.resolve({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                json: async () => ({}),
            } as Response);
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'full',
            retryBudget: 1,
            fetch: fetchMock,
        });

        await expect(embedding.embedMultiBatchWithWorkerPool(['query text'], () => {
            retryCount++;
        })).rejects.toThrow(
            'BGE-M3 worker retry budget exhausted after 1 retry attempt(s). Last failure: embedding_error at http://127.0.0.1:8000',
        );

        expect(retryCount).toBe(1);
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: false,
                rejectedFailureReason: 'embedding_error',
                rejectedRetrySafe: true,
            }),
        ]);
    });

    it('does not revive a rejected primary before cooldown and validation', async () => {
        const fetchMock = jest.fn((url: string) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            return Promise.resolve({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                json: async () => ({}),
            } as Response);
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            mode: 'full',
            retryBudget: 1,
            workerRecoveryCooldownMs: 30000,
            fetch: fetchMock,
        });

        await expect(embedding.embedMultiBatchWithWorkerPool(['query text'])).rejects.toThrow(
            'No healthy BGE-M3 workers available',
        );

        const embedCalls = fetchMock.mock.calls.filter(([url]) => url === 'http://127.0.0.1:8000/embed_batch');
        expect(embedCalls).toHaveLength(1);
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: false,
                rejectedFailureReason: 'embedding_error',
                recoveryAttempts: 0,
                poolState: 'rejected',
            }),
        ]);
    });

    it('recovers the primary worker after a transient batch failure', async () => {
        let primaryFailuresRemaining = 1;
        let primaryEmbedBatchCalls = 0;

        const fetchMock = jest.fn((url: string, init: RequestInit) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8000/embed_batch' && init.method === 'POST') {
                primaryEmbedBatchCalls++;
                if (primaryFailuresRemaining > 0) {
                    primaryFailuresRemaining--;
                    return Promise.resolve({
                        ok: false,
                        status: 503,
                        statusText: 'Service Unavailable',
                        json: async () => ({}),
                    } as Response);
                }
                return Promise.resolve(jsonResponse([fullEmbedding]));
            }

            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            workerEndpoints: ['http://127.0.0.1:8001'],
            mode: 'full',
            retryBudget: 1,
            workerRecoveryCooldownMs: 10,
            fetch: fetchMock,
        });

        await embedding.embedMultiBatchWithWorkerPool(['first']);

        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: false,
                rejectedReason: expect.stringContaining('503 Service Unavailable'),
                recoveryAttempts: 0,
                poolState: 'rejected',
            }),
            expect.objectContaining({ endpoint: 'http://127.0.0.1:8001', healthy: true }),
        ]);

        await new Promise((resolve) => setTimeout(resolve, 15));
        await embedding.embedMultiBatchWithWorkerPool(['second']);

        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/health', expect.objectContaining({ method: 'GET' }));
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/metadata', expect.objectContaining({ method: 'GET' }));
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8000',
                healthy: true,
                rejectedReason: undefined,
                recoveryAttempts: 1,
                poolState: 'accepted',
            }),
            expect.objectContaining({ endpoint: 'http://127.0.0.1:8001', healthy: true }),
        ]);
        expect(primaryEmbedBatchCalls).toBeGreaterThanOrEqual(2);
    });

    it('registers managed worker endpoints after construction without duplicating the primary endpoint', async () => {
        const fetchMock = jest.fn((url: string) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000/',
            mode: 'full',
            fetch: fetchMock,
        });

        embedding.registerWorkerEndpoints([
            'http://127.0.0.1:8000',
            'http://127.0.0.1:8001/',
            'http://127.0.0.1:8001',
        ]);

        expect(embedding.getWorkerSnapshot().map((worker) => ({
            endpoint: worker.endpoint,
            healthy: worker.healthy,
        }))).toEqual([
            { endpoint: 'http://127.0.0.1:8000', healthy: true },
            { endpoint: 'http://127.0.0.1:8001', healthy: true },
        ]);

        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['first']),
            embedding.embedMultiBatchWithWorkerPool(['second']),
        ]);

        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8001/embed_batch', expect.objectContaining({ method: 'POST' }));
    });

    it('recovers a rejected extra worker and routes embedding batches to it again', async () => {
        let extraFailuresRemaining = 1;
        let extraEmbedBatchCalls = 0;
        let primaryEmbedBatchCalls = 0;

        const fetchMock = jest.fn((url: string, init: RequestInit) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8001/embed_batch' && init.method === 'POST') {
                extraEmbedBatchCalls++;
                if (extraFailuresRemaining > 0) {
                    extraFailuresRemaining--;
                    return Promise.resolve({
                        ok: false,
                        status: 503,
                        statusText: 'Service Unavailable',
                        json: async () => ({}),
                    } as Response);
                }
                return Promise.resolve(jsonResponse([fullEmbedding]));
            }
            if (url === 'http://127.0.0.1:8000/embed_batch' && init.method === 'POST') {
                primaryEmbedBatchCalls++;
                return Promise.resolve(jsonResponse([fullEmbedding]));
            }
            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            workerEndpoints: ['http://127.0.0.1:8001'],
            mode: 'full',
            retryBudget: 1,
            workerRecoveryCooldownMs: 10,
            fetch: fetchMock,
        });

        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['first']),
            embedding.embedMultiBatchWithWorkerPool(['second']),
        ]);

        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({ endpoint: 'http://127.0.0.1:8000', healthy: true }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: false,
                rejectedReason: expect.stringContaining('503 Service Unavailable'),
                lastFailureAt: expect.any(String),
                recoveryAttempts: 0,
                poolState: 'rejected',
            }),
        ]);

        await new Promise((resolve) => setTimeout(resolve, 15));
        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['third']),
            embedding.embedMultiBatchWithWorkerPool(['fourth']),
        ]);

        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8001/health', expect.objectContaining({ method: 'GET' }));
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8001/metadata', expect.objectContaining({ method: 'GET' }));
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({ endpoint: 'http://127.0.0.1:8000', healthy: true }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: true,
                rejectedReason: undefined,
                lastSuccessAt: expect.any(String),
                recoveryAttempts: 1,
                poolState: 'accepted',
            }),
        ]);

        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['fifth']),
            embedding.embedMultiBatchWithWorkerPool(['sixth']),
        ]);

        expect(primaryEmbedBatchCalls).toBeGreaterThanOrEqual(2);
        expect(extraEmbedBatchCalls).toBeGreaterThanOrEqual(2);
    });

    it('makes fetch failed workers immediately eligible for health-based recovery', async () => {
        let extraFailuresRemaining = 1;
        let extraEmbedBatchCalls = 0;

        const fetchMock = jest.fn((url: string, init: RequestInit) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8001/embed_batch' && init.method === 'POST') {
                extraEmbedBatchCalls++;
                if (extraFailuresRemaining > 0) {
                    extraFailuresRemaining--;
                    return Promise.reject(new TypeError('fetch failed'));
                }
                return Promise.resolve(jsonResponse([fullEmbedding]));
            }

            return Promise.resolve(jsonResponse([fullEmbedding]));
        });

        const embedding = new BgeM3Embedding({
            endpoint: 'http://127.0.0.1:8000',
            workerEndpoints: ['http://127.0.0.1:8001'],
            mode: 'full',
            retryBudget: 1,
            workerRecoveryCooldownMs: 30000,
            fetch: fetchMock,
        });

        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['first']),
            embedding.embedMultiBatchWithWorkerPool(['second']),
        ]);
        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['third']),
            embedding.embedMultiBatchWithWorkerPool(['fourth']),
        ]);

        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8001/health', expect.objectContaining({ method: 'GET' }));
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8001/metadata', expect.objectContaining({ method: 'GET' }));
        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({ endpoint: 'http://127.0.0.1:8000', healthy: true }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: true,
                rejectedReason: undefined,
                recoveryAttempts: 1,
                poolState: 'accepted',
            }),
        ]);
        expect(extraEmbedBatchCalls).toBeGreaterThanOrEqual(2);
    });

    it('keeps a recovered full-mode worker rejected when metadata outputs no longer match', async () => {
        let extraFailuresRemaining = 1;
        const fetchMock = jest.fn((url: string, init: RequestInit) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            if (url === 'http://127.0.0.1:8001/metadata' && extraFailuresRemaining === 0) {
                return Promise.resolve(jsonResponse({
                    ...fullMetadata,
                    outputs: ['dense', 'sparse'],
                }));
            }
            if (url.endsWith('/metadata')) {
                return Promise.resolve(jsonResponse(fullMetadata));
            }
            if (url === 'http://127.0.0.1:8001/embed_batch' && init.method === 'POST') {
                extraFailuresRemaining--;
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
            workerRecoveryCooldownMs: 10,
            fetch: fetchMock,
        });

        await Promise.all([
            embedding.embedMultiBatchWithWorkerPool(['first']),
            embedding.embedMultiBatchWithWorkerPool(['second']),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 15));
        await embedding.embedMultiBatchWithWorkerPool(['third']);

        expect(embedding.getWorkerSnapshot()).toEqual([
            expect.objectContaining({ endpoint: 'http://127.0.0.1:8000', healthy: true }),
            expect.objectContaining({
                endpoint: 'http://127.0.0.1:8001',
                healthy: false,
                rejectedReason: expect.stringContaining('missing colbert output'),
                recoveryAttempts: 1,
                poolState: 'rejected',
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
