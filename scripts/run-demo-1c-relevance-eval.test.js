#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  enforceAcceptance,
  normalizeResults,
  score,
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
