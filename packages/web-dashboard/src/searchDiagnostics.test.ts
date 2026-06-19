import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildProfileStateSections,
    buildSearchRequestBody,
    formatRetrievalContext,
    getResultDiagnostics,
    parseExtensionFilters,
} from './searchDiagnostics';

test('parseExtensionFilters accepts comma and whitespace separated extensions', () => {
    assert.deepEqual(parseExtensionFilters('.bsl, .xml .ts'), ['.bsl', '.xml', '.ts']);
    assert.deepEqual(parseExtensionFilters(''), []);
});

test('buildProfileStateSections renders server-provided profile state classifications', () => {
    const sections = buildProfileStateSections({
        profileState: {
            daemon: {
                retrieval: {
                    resolvedProfile: 'quality',
                    retrievalMode: 'bge_m3_full',
                    retrievalSchemaVersion: 1,
                    shape: 'bge-m3-full',
                    compatibility: 'effective',
                },
            },
            codebase: {
                retrieval: {
                    indexedProfile: 'fast',
                    retrievalMode: 'bge_m3_dense',
                    retrievalSchemaVersion: 1,
                    shape: 'bge-m3-dense',
                    compatibility: 'default-difference',
                },
                oneCIndexScope: {
                    profile: 'developer',
                    status: 'reduced-coverage',
                },
                rlmBslEnrichment: {
                    mode: 'optional',
                    status: 'partial',
                },
            },
            search: {
                ranking: {
                    requestedProfile: 'generic',
                    resolvedProfile: 'generic',
                    oneCSignalsActive: false,
                },
            },
        },
    });

    assert.equal(sections.length, 3);
    assert.equal(sections[1].tone, 'attention');
    assert.deepEqual(sections[1].items, [
        'Профиль поиска: fast',
        'Режим: bge_m3_dense',
        'Схема: 1',
        'Форма хранения: bge-m3-dense',
        'Совместимость: default-difference',
        'Охват 1C: developer',
        'Состояние охвата: reduced-coverage',
        'RLM BSL: optional',
        'Состояние RLM BSL: partial',
    ]);
    assert.deepEqual(sections[2].items, [
        'Запрошенное ранжирование: generic',
        'Применённое ранжирование: generic',
        'Сигналы 1C: не активны',
    ]);
});

test('buildProfileStateSections falls back to legacy retrieval and ranking fields', () => {
    const sections = buildProfileStateSections({
        fallbackRetrieval: {
            retrievalProfile: 'quality',
            retrievalMode: 'bge_m3_full',
            retrievalSchemaVersion: 1,
            oneCIndexScopeProfile: 'minimal',
        },
        fallbackRankingProfile: 'auto',
    });

    assert.equal(sections[0].items[0], 'Профиль: quality');
    assert.equal(sections[1].items[3], 'Охват 1C: minimal');
    assert.deepEqual(sections[2].items, ['Ранжирование: auto']);
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
    assert.deepEqual(formatRetrievalContext({}), ['Поиск: профиль неизвестен']);
    assert.deepEqual(formatRetrievalContext({
        retrievalProfile: 'quality',
        retrievalMode: 'bge_m3_full',
        retrievalSchemaVersion: 1,
        oneCIndexScopeProfile: 'developer',
    }), [
        'Профиль: quality',
        'Режим: bge_m3_full',
        'Схема: 1',
        'Охват 1C: developer',
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
