import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardApiAdapter } from './dashboard-api.js';

function createAdapter(overrides: {
    statusResult?: Record<string, unknown>;
    codebases?: Array<{ path: string; status: string }>;
    handlerError?: { name: 'index' | 'search' | 'clear' | 'status'; message: string };
    searchResult?: { isError?: boolean; text?: string; structuredContent?: unknown };
} = {}) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapter = new DashboardApiAdapter({
        toolHandlers: {
            async handleIndexCodebase(args) {
                calls.push({ name: 'index', args });
                if (overrides.handlerError?.name === 'index') {
                    throw new Error(overrides.handlerError.message);
                }
                return { content: [{ type: 'text', text: 'index queued' }], structuredContent: { queued: true } };
            },
            async handleSearchCode(args) {
                calls.push({ name: 'search', args });
                if (overrides.handlerError?.name === 'search') {
                    throw new Error(overrides.handlerError.message);
                }
                if (overrides.searchResult) {
                    return {
                        isError: overrides.searchResult.isError,
                        content: [{ type: 'text', text: overrides.searchResult.text || 'results' }],
                        structuredContent: overrides.searchResult.structuredContent,
                    };
                }
                return { content: [{ type: 'text', text: 'results' }], structuredContent: { results: [] } };
            },
            async handleClearIndex(args) {
                calls.push({ name: 'clear', args });
                if (overrides.handlerError?.name === 'clear') {
                    throw new Error(overrides.handlerError.message);
                }
                return { content: [{ type: 'text', text: 'cleared' }], structuredContent: { cleared: true } };
            },
            async handleGetIndexingStatus(args) {
                calls.push({ name: 'status', args });
                if (overrides.handlerError?.name === 'status') {
                    throw new Error(overrides.handlerError.message);
                }
                return { content: [{ type: 'text', text: 'indexed' }], structuredContent: { status: 'indexed' } };
            },
        },
        getDaemonStatus: async () => ({
            content: [{ type: 'text', text: 'daemon' }],
            structuredContent: overrides.statusResult || { runtimes: [] },
        }),
        listCodebases: async () => overrides.codebases || [{ path: '/repo/a', status: 'indexed' }],
        cancelCodebaseWorkload: async (args) => {
            calls.push({ name: 'cancel', args });
            return { content: [{ type: 'text', text: 'cancelled' }], structuredContent: { queued: [], active: [] } };
        },
    });

    return { adapter, calls };
}

test('dashboard API maps read routes to daemon status and codebase status handlers', async () => {
    const { adapter, calls } = createAdapter();

    const daemon = await adapter.handle({
        method: 'GET',
        path: '/api/daemon/status',
        query: new URLSearchParams(),
    });
    assert.equal(daemon.statusCode, 200);
    assert.deepEqual(daemon.body, { ok: true, data: { runtimes: [] } });

    const codebases = await adapter.handle({
        method: 'GET',
        path: '/api/codebases',
        query: new URLSearchParams(),
    });
    assert.equal(codebases.statusCode, 200);
    assert.deepEqual(codebases.body, { ok: true, data: [{ path: '/repo/a', status: 'indexed' }] });

    const status = await adapter.handle({
        method: 'GET',
        path: '/api/codebases/status',
        query: new URLSearchParams({ path: '/repo/a' }),
    });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.body, { ok: true, data: { status: 'indexed' } });
    assert.deepEqual(calls, [{ name: 'status', args: { path: '/repo/a' } }]);
});

test('dashboard API maps mutation routes to existing handlers and preserves request bodies', async () => {
    const { adapter, calls } = createAdapter();

    await adapter.handle({
        method: 'POST',
        path: '/api/codebases/index',
        query: new URLSearchParams(),
        body: { path: '/repo/a', force: true },
    });
    await adapter.handle({
        method: 'POST',
        path: '/api/codebases/clear',
        query: new URLSearchParams(),
        body: { path: '/repo/a' },
    });
    await adapter.handle({
        method: 'POST',
        path: '/api/codebases/cancel',
        query: new URLSearchParams(),
        body: { path: '/repo/a', reason: 'operator' },
    });
    await adapter.handle({
        method: 'POST',
        path: '/api/search',
        query: new URLSearchParams(),
        body: { path: '/repo/a', query: 'foo', limit: 5 },
    });

    assert.deepEqual(calls, [
        { name: 'index', args: { path: '/repo/a', force: true } },
        { name: 'clear', args: { path: '/repo/a' } },
        { name: 'cancel', args: { path: '/repo/a', reason: 'operator' } },
        { name: 'search', args: { path: '/repo/a', query: 'foo', limit: 5 } },
    ]);
});

test('dashboard API rejects missing bodies, missing path query, and unknown routes', async () => {
    const { adapter } = createAdapter();

    assert.deepEqual(await adapter.handle({
        method: 'POST',
        path: '/api/search',
        query: new URLSearchParams(),
    }), {
        statusCode: 400,
        body: { ok: false, error: 'Expected a JSON object request body.' },
    });

    assert.deepEqual(await adapter.handle({
        method: 'GET',
        path: '/api/codebases/status',
        query: new URLSearchParams(),
    }), {
        statusCode: 400,
        body: { ok: false, error: "Missing required query parameter 'path'." },
    });

    assert.deepEqual(await adapter.handle({
        method: 'GET',
        path: '/api/nope',
        query: new URLSearchParams(),
    }), {
        statusCode: 404,
        body: { ok: false, error: 'Dashboard API route not found.' },
    });
});

test('dashboard API passes allowed paths through existing handlers', async () => {
    const { adapter, calls } = createAdapter();

    const response = await adapter.handle({
        method: 'POST',
        path: '/api/codebases/index',
        query: new URLSearchParams(),
        body: { path: '/repo/a', customExtensions: ['.ts'] },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, data: { queued: true } });
    assert.deepEqual(calls, [
        { name: 'index', args: { path: '/repo/a', customExtensions: ['.ts'] } },
    ]);
});

test('dashboard API normalizes disallowed path and not-indexed handler errors', async () => {
    const { adapter: disallowedAdapter } = createAdapter({
        searchResult: {
            isError: true,
            text: "Path '/etc' is not allowed by daemon access policy.",
            structuredContent: { code: 'path_not_allowed' },
        },
    });

    assert.deepEqual(await disallowedAdapter.handle({
        method: 'POST',
        path: '/api/search',
        query: new URLSearchParams(),
        body: { path: '/etc', query: 'secret' },
    }), {
        statusCode: 400,
        body: {
            ok: false,
            error: "Path '/etc' is not allowed by daemon access policy.",
            data: { code: 'path_not_allowed' },
        },
    });

    const { adapter: notIndexedAdapter } = createAdapter({
        searchResult: {
            isError: true,
            text: "Codebase '/repo/a' is not indexed.",
            structuredContent: { code: 'not_indexed' },
        },
    });

    assert.deepEqual(await notIndexedAdapter.handle({
        method: 'POST',
        path: '/api/search',
        query: new URLSearchParams(),
        body: { path: '/repo/a', query: 'symbol' },
    }), {
        statusCode: 400,
        body: {
            ok: false,
            error: "Codebase '/repo/a' is not indexed.",
            data: { code: 'not_indexed' },
        },
    });
});

test('dashboard API converts handler exceptions to typed errors', async () => {
    const { adapter } = createAdapter({
        handlerError: { name: 'status', message: 'status backend unavailable' },
    });

    assert.deepEqual(await adapter.handle({
        method: 'GET',
        path: '/api/codebases/status',
        query: new URLSearchParams({ path: '/repo/a' }),
    }), {
        statusCode: 500,
        body: { ok: false, error: 'status backend unavailable' },
    });
});

test('dashboard JSON status responses omit configured secret values', async () => {
    const secretToken = 'dashboard-test-token-value';
    const providerSecret = 'provider-secret-value';
    const milvusSecret = 'milvus-secret-value';
    const { adapter } = createAdapter({
        statusResult: {
            discovery: {
                endpointUrl: 'http://127.0.0.1:39393/mcp',
                tokenSha256: 'sha256-only',
            },
            runtimes: [],
            retrievalConfiguration: {
                retrievalMode: 'bge_m3_dense',
            },
        },
    });

    const response = await adapter.handle({
        method: 'GET',
        path: '/api/daemon/status',
        query: new URLSearchParams(),
    });

    const serialized = JSON.stringify(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(serialized.includes(secretToken), false);
    assert.equal(serialized.includes(providerSecret), false);
    assert.equal(serialized.includes(milvusSecret), false);
    assert.equal(serialized.includes('bearerToken'), false);
    assert.equal(serialized.includes('OPENAI_API_KEY'), false);
    assert.equal(serialized.includes('MILVUS_TOKEN'), false);
});
