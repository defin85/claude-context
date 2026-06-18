import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProgressSummary } from './operationsView';

test('progress summary uses daemon progressPercentage and lastUpdated when detailed progress is absent', () => {
    const summary = buildProgressSummary({
        status: 'indexing',
        progressPercentage: 12.4,
        lastUpdated: '2026-06-17T18:18:06.130Z',
    });

    assert.equal(summary.percentage, 12);
    assert.equal(summary.phase, 'indexing');
    assert.equal(summary.updatedText, 'Обновлено: 2026-06-17 18:18:06');
});
