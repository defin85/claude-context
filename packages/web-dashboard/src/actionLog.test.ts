import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ActionLogEntry,
    createActionRecorder,
    createDiagnosticsPayload,
    redactSecrets,
} from './actionLog';

test('action recorder stores success duration and trims oldest entries', async () => {
    const entries: ActionLogEntry[] = [];
    const recorder = createActionRecorder({
        entries,
        maxEntries: 2,
        now: (() => {
            const values = [1000, 1015, 2000, 2040, 3000, 3007];
            return () => values.shift() ?? 3007;
        })(),
    });

    await recorder.record('refresh', async () => undefined);
    await recorder.record('index', async () => undefined, { targetPath: '/repo/a' });
    await recorder.record('search', async () => ({ count: 3 }), { targetPath: '/repo/b' });

    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.action), ['index', 'search']);
    assert.equal(entries[1].status, 'success');
    assert.equal(entries[1].durationMs, 7);
    assert.equal(entries[1].targetPath, '/repo/b');
});

test('redaction removes secret-looking fields from strings and diagnostics', () => {
    const text = 'OPENAI_API_KEY=sk-live-abc Authorization: Bearer token-123 milvusToken: secret-value';
    const redacted = redactSecrets(text);

    assert.equal(redacted.includes('sk-live-abc'), false);
    assert.equal(redacted.includes('token-123'), false);
    assert.equal(redacted.includes('secret-value'), false);

    const payload = createDiagnosticsPayload({
        daemonSummary: {
            discovery: {
                endpointUrl: 'http://127.0.0.1:39393',
                tokenSha256: 'allowed-hash',
                authorization: 'Bearer raw-secret',
            },
        },
        selectedPath: '/repo/demo',
        selectedStatus: { status: 'indexed' },
        actionLog: [{
            id: '1',
            timestamp: '2026-06-18T10:00:00.000Z',
            action: 'index',
            status: 'failure',
            targetPath: '/repo/demo',
            durationMs: 12,
            error: 'apiKey=raw-secret',
        }],
    });

    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes('raw-secret'), false);
    assert.equal(serialized.includes('allowed-hash'), true);
    assert.equal(payload.selected.codebasePath, '/repo/demo');
});
