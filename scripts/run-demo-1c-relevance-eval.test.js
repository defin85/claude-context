#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildComparison,
  enforceAcceptance,
  normalizeResults,
  score,
  writeMarkdownReport,
} = require('./run-demo-1c-relevance-eval.js');

const repoRoot = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('normalizes live top10 path rows before scoring', () => {
  const dataset = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-1c',
    labelsAreProductionRules: false,
    queries: [{
      id: 'q1',
      query: 'печать расходной накладной',
      kind: 'unit',
      expectedPathPrefixes: ['Documents/РасходТовара/Commands/ПечатьРасходнойНакладной'],
    }],
  };
  const results = [{
    id: 'q1',
    query: 'печать расходной накладной',
    top10: [{
      path: 'Documents/РасходТовара/Commands/ПечатьРасходнойНакладной/Ext/CommandModule.bsl',
      metadata: { fusionScore: 1.5 },
    }],
  }];

  const summary = score(dataset, normalizeResults(results, dataset), { backendLabel: 'unit' });

  assert.equal(summary.metrics.hitAt10Count, 1);
  assert.equal(summary.perQuery[0].topResults[0].relativePath, results[0].top10[0].path);
  assert.equal(summary.perQuery[0].topResults[0].fusionScore, 1.5);
});

test('rejects unsupported live result schemas explicitly', () => {
  const dataset = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-1c',
    labelsAreProductionRules: false,
    queries: [{ id: 'q1', query: 'запрос', kind: 'unit', expectedPathPrefixes: ['CommonModules/A'] }],
  };

  assert.throws(
    () => normalizeResults([{ id: 'q1', query: 'запрос', rows: [] }], dataset),
    /Unsupported live result schema/,
  );
});

test('scores the preserved fixed Qdrant live report as the 18 of 30 baseline', () => {
  const reportPath = path.join(
    repoRoot,
    '.artifacts',
    'hybrid-code-symbol-retrieval',
    'live-demo-1c',
    'qdrant-fixed-mcp-search-30-report.json',
  );
  if (!fs.existsSync(reportPath)) {
    assert.fail(`Missing preserved baseline artifact: ${reportPath}`);
  }

  const rawReport = readJson(reportPath);
  const dataset = {
    dataset: rawReport.dataset || 'demo-1c-live-report-labels',
    version: rawReport.version || rawReport.startedAt || 'report-local',
    fixture: rawReport.codebasePath,
    labelsAreProductionRules: false,
    queries: rawReport.results.map((row) => ({
      id: row.id,
      query: row.query,
      kind: row.kind || 'live-report',
      expectedPathPrefixes: row.expectedPrefixes,
    })),
  };

  const summary = score(dataset, normalizeResults(rawReport, dataset), {
    backendLabel: 'qdrant-default-fixed-baseline',
  });

  assert.equal(summary.metrics.queryCount, 30);
  assert.equal(summary.metrics.hitAt10Count, 18);
});

test('enforces acceptance threshold and live backend correctness', () => {
  const summary = {
    metrics: {
      hitAt10Count: 23,
      queryCount: 30,
    },
    run: {
      rawSummary: {
        toolErrors: 1,
        missingColbertErrors: 1,
      },
    },
  };

  assert.throws(
    () => enforceAcceptance(summary, { acceptanceThreshold: 24 }),
    /Hit@10 count 23 is below acceptance threshold 24/,
  );

  assert.throws(
    () => enforceAcceptance({
      ...summary,
      metrics: { ...summary.metrics, hitAt10Count: 24 },
    }, { acceptanceThreshold: 24 }),
    /Expected 0 MCP tool errors, got 1/,
  );

  assert.doesNotThrow(() => enforceAcceptance(summary, {
    acceptanceThreshold: 24,
    allowBelowAcceptanceThreshold: true,
    allowToolErrors: true,
    allowMissingColbertErrors: true,
  }));
});

test('supports non-regression baseline mode without requiring strict improvement', () => {
  const baseline = {
    dataset: 'unit',
    version: '1',
    metrics: {
      hitAt10Count: 26,
      hitAt10: 0.8667,
    },
    run: {},
    perQuery: [],
  };
  const equalSummary = {
    dataset: 'unit',
    version: '1',
    metrics: {
      hitAt10Count: 26,
      queryCount: 30,
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
    },
    perQuery: [],
  };
  equalSummary.comparison = buildComparison(baseline, equalSummary);

  assert.throws(
    () => enforceAcceptance(equalSummary, { baselineMode: 'strict-improvement' }),
    /does not improve over baseline 26/,
  );
  assert.doesNotThrow(() => enforceAcceptance(equalSummary, { baselineMode: 'non-regression' }));

  const lowerSummary = {
    ...equalSummary,
    metrics: {
      ...equalSummary.metrics,
      hitAt10Count: 25,
    },
  };
  lowerSummary.comparison = buildComparison(baseline, lowerSummary);

  assert.throws(
    () => enforceAcceptance(lowerSummary, { baselineMode: 'non-regression' }),
    /is below baseline 26/,
  );
});

test('reports residual queries from caller-provided ids only', () => {
  const dataset = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-1c',
    labelsAreProductionRules: false,
    queries: [
      { id: 'r01', query: 'остатки', kind: 'unit', expectedPathPrefixes: ['Reports/A'] },
      { id: 'r06', query: 'карточка', kind: 'unit', expectedPathPrefixes: ['Catalogs/A'] },
      { id: 'other', query: 'другое', kind: 'unit', expectedPathPrefixes: ['CommonModules/A'] },
    ],
  };
  const resultsById = {
    r01: { results: [] },
    r06: { results: [] },
    other: { results: [] },
  };

  const summary = score(dataset, resultsById, {
    residualQueryIds: ['r06'],
  });

  assert.deepEqual(summary.residualQueries.map((row) => row.id), ['r06']);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'knownMisses'), false);
});

test('keeps residual evaluation labels out of production ranking code', () => {
  const productionRanking = fs.readFileSync(
    path.join(repoRoot, 'packages', 'core', 'src', 'code-symbol-retrieval.ts'),
    'utf8',
  );

  for (const forbidden of [
    'r01',
    'r05',
    'r06',
    'r28',
    'expectedPathPrefixes',
    'labelsAreProductionRules',
    'residualQueryIds',
  ]) {
    assert.equal(productionRanking.includes(forbidden), false, `unexpected production ranking reference: ${forbidden}`);
  }
});

test('writes residual query outcomes to markdown reports', () => {
  const outPath = path.join(repoRoot, '.artifacts', 'test', 'residual-report.md');
  const summary = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-1c',
    run: { backendLabel: 'unit' },
    metrics: {
      queryCount: 2,
      hitAt10Count: 1,
      hitAt10: 0.5,
      mrrAt10: 0.5,
      precisionAt10: 0.05,
      failures: 0,
    },
    perQuery: [
      {
        id: 'r01',
        firstRelevantRank: null,
        latencyMs: 12,
        topResultPaths: ['Documents/РасходТовара/Ext/ObjectModule.bsl'],
      },
      {
        id: 'r06',
        firstRelevantRank: 2,
        latencyMs: 10,
        topResultPaths: ['Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form/Module.bsl'],
      },
    ],
    residualQueries: [
      {
        id: 'r01',
        firstRelevantRank: null,
        latencyMs: 12,
        topResultPaths: ['Documents/РасходТовара/Ext/ObjectModule.bsl'],
      },
      {
        id: 'r06',
        firstRelevantRank: 2,
        latencyMs: 10,
        topResultPaths: ['Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form/Module.bsl'],
      },
    ],
  };
  const comparison = {
    baseline: {
      hitAt10Count: 1,
    },
    comparable: true,
    improvements: [{ id: 'r06' }],
    perQuery: [
      { id: 'r01', status: 'unchanged' },
      { id: 'r06', status: 'improved' },
    ],
    regressions: [],
  };

  writeMarkdownReport(outPath, summary, undefined, comparison);

  const markdown = fs.readFileSync(outPath, 'utf8');
  assert.match(markdown, /## Residual queries/);
  assert.match(markdown, /\| r01 \| unchanged \|/);
  assert.match(markdown, /\| r06 \| improved \| 2 \|/);
});
