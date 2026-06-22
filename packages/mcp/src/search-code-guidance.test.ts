import assert from 'node:assert/strict';
import test from 'node:test';
import { SEARCH_CODE_TOOL_DESCRIPTION } from './search-code-guidance.js';

test('search_code tool description includes generic 1C context-bundle guidance', () => {
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /non-trivial 1C exported-configuration tasks/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /context bundle/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /original user task/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /library API/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /client usage/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /server usage/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /applied usage/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /metadata\/state/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /index scope\/profile coverage or filesystem context/);
    assert.match(SEARCH_CODE_TOOL_DESCRIPTION, /does not change rankingProfile behavior/);
});

test('search_code tool description does not leak 1C evaluation labels', () => {
    const forbidden = [
        'runbook-long-operation',
        'runbook-print-form',
        'demo-bp30-1c',
        'expectedPathPrefixes',
        'scenarioId',
        'CommonModules/ДлительныеОперации/Ext/Module.bsl',
        'Documents/РеализацияТоваровУслуг',
    ];

    for (const value of forbidden) {
        assert.equal(SEARCH_CODE_TOOL_DESCRIPTION.includes(value), false);
    }
});
