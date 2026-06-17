import assert from 'node:assert/strict';
import test from 'node:test';
import { createMcpConfig, createMcpRuntimeConfig } from './config.js';

const trackedEnv = [
    'EMBEDDING_PROVIDER',
    'BGE_M3_ENDPOINT',
    'BGE_M3_MODE',
    'BGE_M3_STORE_COLBERT',
    'RETRIEVAL_PROFILE',
    'HYBRID_MODE',
    'OPENAI_API_KEY',
    'VOYAGEAI_API_KEY',
    'GEMINI_API_KEY',
    'EMBEDDING_BATCH_SIZE',
    'INDEX_EMBEDDING_BATCH_SIZE',
    'INDEX_INSERT_BATCH_SIZE',
    'VECTOR_DATABASE_BACKEND',
    'MCP_RUNTIME_MODE',
    'MCP_DAEMON_ALLOW_ROOTS',
    'MCP_DAEMON_TOKEN',
    'MCP_DASHBOARD_ENABLED',
    'MCP_DASHBOARD_ROUTE',
    'MCP_DASHBOARD_STATIC_DIR',
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

test('retrieval profile parses BGE-M3 fast with matching low-level settings and preserves unset-profile compatibility', () => {
    withEnv({
        EMBEDDING_PROVIDER: 'BGE_M3',
        BGE_M3_ENDPOINT: 'http://127.0.0.1:8000',
        RETRIEVAL_PROFILE: 'fast',
        BGE_M3_MODE: 'dense',
        BGE_M3_STORE_COLBERT: 'false',
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.retrievalProfile, 'fast');
        assert.equal(config.resolvedRetrievalProfile.retrievalMode, 'bge_m3_dense');
        assert.equal(config.bgeM3Mode, 'dense');
        assert.equal(config.bgeM3StoreColbert, false);
    });

    withEnv({
        EMBEDDING_PROVIDER: 'BGE_M3',
        BGE_M3_ENDPOINT: 'http://127.0.0.1:8000',
    }, () => {
        const config = createMcpConfig();

        assert.equal(config.retrievalProfile, undefined);
        assert.equal(config.resolvedRetrievalProfile.explicitProfile, false);
        assert.equal(config.resolvedRetrievalProfile.retrievalMode, 'bge_m3_full');
        assert.equal(config.bgeM3Mode, 'full');
    });
});

test('retrieval profile rejects invalid values and explicit low-level conflicts', () => {
    withEnv({
        RETRIEVAL_PROFILE: 'slow',
    }, () => {
        assert.throws(
            () => createMcpConfig(),
            /Invalid RETRIEVAL_PROFILE 'slow'/,
        );
    });

    withEnv({
        EMBEDDING_PROVIDER: 'BGE_M3',
        BGE_M3_ENDPOINT: 'http://127.0.0.1:8000',
        RETRIEVAL_PROFILE: 'fast',
        BGE_M3_MODE: 'full',
    }, () => {
        assert.throws(
            () => createMcpConfig(),
            /RETRIEVAL_PROFILE=fast conflicts with BGE_M3_MODE=full/,
        );
    });

    withEnv({
        EMBEDDING_PROVIDER: 'BGE_M3',
        BGE_M3_ENDPOINT: 'http://127.0.0.1:8000',
        RETRIEVAL_PROFILE: 'fast',
        BGE_M3_MODE: 'dense',
        BGE_M3_STORE_COLBERT: 'true',
    }, () => {
        assert.throws(
            () => createMcpConfig(),
            /RETRIEVAL_PROFILE=fast conflicts with BGE_M3_STORE_COLBERT=true/,
        );
    });

    withEnv({
        EMBEDDING_PROVIDER: 'OpenAI',
        RETRIEVAL_PROFILE: 'fast',
        HYBRID_MODE: 'true',
    }, () => {
        assert.throws(
            () => createMcpConfig(),
            /RETRIEVAL_PROFILE=fast conflicts with HYBRID_MODE=true/,
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

test('daemon dashboard is disabled by default and can be enabled from CLI', () => {
    withEnv({
        MCP_DAEMON_ALLOW_ROOTS: '/repo',
        MCP_DAEMON_TOKEN: 'test-token',
    }, () => {
        const disabled = createMcpRuntimeConfig(['--mode', 'daemon']);

        assert.equal(disabled.daemon?.dashboard.enabled, false);
        assert.equal(disabled.daemon?.dashboard.routePrefix, '/dashboard');
        assert.equal(disabled.daemon?.dashboard.apiPrefix, '/dashboard/api');

        const enabled = createMcpRuntimeConfig([
            '--mode', 'daemon',
            '--dashboard',
            '--dashboard-route', '/ops',
            '--dashboard-static-dir', '/tmp/dashboard',
        ]);

        assert.equal(enabled.daemon?.dashboard.enabled, true);
        assert.equal(enabled.daemon?.dashboard.routePrefix, '/ops');
        assert.equal(enabled.daemon?.dashboard.apiPrefix, '/ops/api');
        assert.equal(enabled.daemon?.dashboard.staticDir, '/tmp/dashboard');
    });
});

test('daemon dashboard can be enabled from environment and rejects MCP route collisions', () => {
    withEnv({
        MCP_RUNTIME_MODE: 'daemon',
        MCP_DAEMON_ALLOW_ROOTS: '/repo',
        MCP_DAEMON_TOKEN: 'test-token',
        MCP_DASHBOARD_ENABLED: 'true',
        MCP_DASHBOARD_ROUTE: '/mcp',
    }, () => {
        assert.throws(
            () => createMcpRuntimeConfig(),
            /Dashboard route '\/mcp' conflicts with daemon MCP endpoint '\/mcp'/,
        );
    });

    withEnv({
        MCP_RUNTIME_MODE: 'daemon',
        MCP_DAEMON_ALLOW_ROOTS: '/repo',
        MCP_DAEMON_TOKEN: 'test-token',
        MCP_DASHBOARD_ENABLED: 'true',
        MCP_DASHBOARD_ROUTE: '/dashboard/',
        MCP_DASHBOARD_STATIC_DIR: '/tmp/dashboard',
    }, () => {
        const config = createMcpRuntimeConfig();

        assert.equal(config.daemon?.dashboard.enabled, true);
        assert.equal(config.daemon?.dashboard.routePrefix, '/dashboard');
        assert.equal(config.daemon?.dashboard.apiPrefix, '/dashboard/api');
        assert.equal(config.daemon?.dashboard.staticDir, '/tmp/dashboard');
    });
});
