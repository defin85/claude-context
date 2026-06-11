import assert from 'node:assert/strict';
import test from 'node:test';
import { createMcpConfig } from './config.js';

const trackedEnv = [
    'EMBEDDING_PROVIDER',
    'BGE_M3_ENDPOINT',
    'BGE_M3_MODE',
    'BGE_M3_STORE_COLBERT',
    'OPENAI_API_KEY',
    'VOYAGEAI_API_KEY',
    'GEMINI_API_KEY',
    'EMBEDDING_BATCH_SIZE',
    'INDEX_EMBEDDING_BATCH_SIZE',
    'INDEX_INSERT_BATCH_SIZE',
    'VECTOR_DATABASE_BACKEND',
];

function withEnv(env: Record<string, string | undefined>, run: () => void): void {
    const previous = new Map<string, string | undefined>();
    for (const name of trackedEnv) {
        previous.set(name, process.env[name]);
        delete process.env[name];
    }
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }

    try {
        run();
    } finally {
        for (const name of trackedEnv) {
            const value = previous.get(name);
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    }
}

test('BGE-M3 full mode rejects disabled ColBERT storage', () => {
    withEnv({
        EMBEDDING_PROVIDER: 'BGE_M3',
        BGE_M3_ENDPOINT: 'http://127.0.0.1:8000',
        BGE_M3_MODE: 'full',
        BGE_M3_STORE_COLBERT: 'false',
    }, () => {
        assert.throws(
            () => createMcpConfig(),
            /BGE_M3_STORE_COLBERT=false is incompatible with BGE_M3_MODE=full/,
        );
    });
});

test('index batch size summary uses core-compatible clamp and fallback', () => {
    withEnv({
        INDEX_EMBEDDING_BATCH_SIZE: '20000',
        INDEX_INSERT_BATCH_SIZE: '30000',
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.indexEmbeddingBatchSize, 10000);
        assert.equal(config.indexInsertBatchSize, 10000);
    });

    withEnv({
        EMBEDDING_BATCH_SIZE: '20000',
        INDEX_INSERT_BATCH_SIZE: undefined,
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.indexEmbeddingBatchSize, 10000);
        assert.equal(config.indexInsertBatchSize, 10000);
    });
});

test('vector database backend defaults to Qdrant while preserving explicit backends', () => {
    withEnv({
        VECTOR_DATABASE_BACKEND: undefined,
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.vectorDatabaseBackend, 'qdrant');
        assert.equal(config.qdrantUrl, 'http://127.0.0.1:6333');
    });

    withEnv({
        VECTOR_DATABASE_BACKEND: 'milvus',
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.vectorDatabaseBackend, 'milvus');
    });

    withEnv({
        VECTOR_DATABASE_BACKEND: 'lancedb',
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.vectorDatabaseBackend, 'lancedb');
    });
});
