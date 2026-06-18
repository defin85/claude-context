import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSearchRequestBody,
    formatRetrievalContext,
    getResultDiagnostics,
    parseExtensionFilters,
} from './searchDiagnostics';

test('parseExtensionFilters accepts comma and whitespace separated extensions', () => {
    assert.deepEqual(parseExtensionFilters('.bsl, .xml .ts'), ['.bsl', '.xml', '.ts']);
    assert.deepEqual(parseExtensionFilters(''), []);
});

test('buildSearchRequestBody forwards extension filters and ranking profile', () => {
    assert.deepEqual(buildSearchRequestBody({
        path: '/repo/demo',
        query: 'НДС',
        limit: 10,
        extensionFilterText: '.bsl, .xml',
        rankingProfile: 'one-c',
    }), {
        path: '/repo/demo',
        query: 'НДС',
        limit: 10,
        extensionFilter: ['.bsl', '.xml'],
        rankingProfile: 'one-c',
    });
});

test('formatRetrievalContext tolerates missing fields and includes available diagnostics', () => {
    assert.deepEqual(formatRetrievalContext({}), ['Retrieval: неизвестно']);
    assert.deepEqual(formatRetrievalContext({
        retrievalProfile: 'quality',
        retrievalMode: 'bge_m3_full',
        retrievalSchemaVersion: 1,
        oneCIndexScopeProfile: 'developer',
    }), [
        'Профиль: quality',
        'Режим: bge_m3_full',
        'Схема: 1',
        '1C scope: developer',
    ]);
});

test('getResultDiagnostics extracts known metadata fields', () => {
    assert.deepEqual(getResultDiagnostics({
        metadata: {
            rankingProfile: 'generic',
            semanticScore: 0.73,
            lexicalScore: 0.21,
            retrievalSources: ['dense', 'sparse'],
            boosts: { exactSymbol: 0.4 },
        },
    }), [
        ['rankingProfile', 'generic'],
        ['semanticScore', '0.73'],
        ['lexicalScore', '0.21'],
        ['retrievalSources', 'dense, sparse'],
        ['boosts', '{"exactSymbol":0.4}'],
    ]);
});
