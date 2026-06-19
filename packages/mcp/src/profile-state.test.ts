import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createCodebaseProfileState,
    createDaemonProfileState,
    createSearchProfileState,
} from './profile-state.js';

test('daemon profile state distinguishes BGE-M3 dense and full retrieval shapes', () => {
    const dense = createDaemonProfileState({
        retrievalProfile: 'fast',
        resolvedRetrievalProfile: 'fast',
        explicitProfile: true,
        retrievalMode: 'bge_m3_dense',
        retrievalSchemaVersion: 1,
        bgeM3Mode: 'dense',
        usesBgeM3Sparse: false,
        usesColbert: false,
    });

    assert.equal(dense.daemon?.retrieval.shape, 'bge-m3-dense');
    assert.equal(dense.daemon?.retrieval.bgeM3?.usesColbert, false);

    const full = createDaemonProfileState({
        retrievalProfile: 'quality',
        resolvedRetrievalProfile: 'quality',
        explicitProfile: true,
        retrievalMode: 'bge_m3_full',
        retrievalSchemaVersion: 1,
        bgeM3Mode: 'full',
        usesBgeM3Sparse: true,
        usesColbert: true,
    });

    assert.equal(full.daemon?.retrieval.shape, 'bge-m3-full');
    assert.equal(full.daemon?.retrieval.bgeM3?.usesSparse, true);
    assert.equal(full.daemon?.retrieval.bgeM3?.usesColbert, true);
});

test('codebase profile state classifies matching, mismatched, and missing retrieval metadata', () => {
    const daemonRetrieval = {
        resolvedRetrievalProfile: 'quality' as const,
        retrievalMode: 'bge_m3_full' as const,
        retrievalSchemaVersion: 1,
    };

    const matching = createCodebaseProfileState({
        config: {
            retrievalProfile: 'quality',
            retrievalMode: 'bge_m3_full',
            retrievalSchemaVersion: 1,
        },
        daemonRetrievalConfiguration: daemonRetrieval,
    });
    assert.equal(matching.codebase?.retrieval.compatibility, 'effective');

    const mismatch = createCodebaseProfileState({
        config: {
            retrievalProfile: 'fast',
            retrievalMode: 'bge_m3_dense',
            retrievalSchemaVersion: 1,
        },
        daemonRetrievalConfiguration: daemonRetrieval,
    });
    assert.equal(mismatch.codebase?.retrieval.compatibility, 'default-difference');

    const missing = createCodebaseProfileState({
        config: null,
        daemonRetrievalConfiguration: daemonRetrieval,
    });
    assert.equal(missing.codebase?.retrieval.compatibility, 'unknown');
});

test('codebase profile state reports reduced 1C coverage and sanitized RLM BSL enrichment status', () => {
    const state = createCodebaseProfileState({
        config: {
            oneCIndexScopeProfile: 'developer',
            rlmBslEnrichment: {
                mode: 'optional',
                command: 'secret-bearing-command --token value',
            },
        },
        oneCScopeStatus: {
            oneCIndexScopeProfile: 'developer',
            reducedCoverageWarning: 'reduced coverage',
        },
        rlmBslEnrichmentStatus: {
            mode: 'optional',
            configured: true,
            commandConfigured: true,
            status: 'partial',
            provider: 'rlm-tools-bsl',
            rawCommand: 'must not leak',
        } as Record<string, unknown>,
    });

    assert.equal(state.codebase?.oneCIndexScope.status, 'reduced-coverage');
    assert.equal(state.codebase?.rlmBslEnrichment.status, 'partial');
    assert.equal(state.codebase?.rlmBslEnrichment.commandConfigured, true);
    assert.equal(JSON.stringify(state).includes('secret-bearing-command'), false);
    assert.equal(JSON.stringify(state).includes('must not leak'), false);
});

test('search profile state reports requested and resolved ranking profile without codebase state', () => {
    const state = createSearchProfileState({
        requestedRankingProfile: 'auto',
        resultMetadata: { rankingProfile: 'one-c' },
    });

    assert.equal(state.search?.ranking.requestedProfile, 'auto');
    assert.equal(state.search?.ranking.resolvedProfile, 'one-c');
    assert.equal(state.search?.ranking.oneCSignalsActive, true);
    assert.equal(state.codebase, undefined);
});
