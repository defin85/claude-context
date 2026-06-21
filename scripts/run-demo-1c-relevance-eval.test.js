#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildComparison,
  buildThresholdRecommendation,
  enforceAcceptance,
  collectionDatasetForFixture,
  flattenUniversalMatrixForFixture,
  normalizeResults,
  score,
  validateLabels,
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

test('preserves ranking profile metadata in score and Markdown reports', () => {
  const dataset = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-1c',
    labelsAreProductionRules: false,
    queries: [{
      id: 'q1',
      query: 'печать расходной накладной',
      kind: 'unit',
      expectedPathPrefixes: ['Documents/РасходТовара'],
    }],
  };
  const results = [{
    id: 'q1',
    query: 'печать расходной накладной',
    rankingProfile: 'one-c',
    top10: [{
      path: 'Documents/РасходТовара/Ext/ObjectModule.bsl',
      rankingProfile: 'one-c',
      metadata: { rankingProfile: 'one-c' },
    }],
  }];
  const summary = score(dataset, normalizeResults(results, dataset), {
    backendLabel: 'unit',
    rankingProfile: 'one-c',
  });
  const reportPath = path.join(repoRoot, '.artifacts', 'tmp', 'ranking-profile-report.md');

  writeMarkdownReport(reportPath, summary);
  const markdown = fs.readFileSync(reportPath, 'utf8');

  assert.equal(summary.run.rankingProfile, 'one-c');
  assert.equal(summary.perQuery[0].topResults[0].rankingProfile, 'one-c');
  assert.match(markdown, /Ranking profile: one-c/);
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

test('rejects query-level baseline regressions even when aggregate non-regression passes', () => {
  const baseline = {
    dataset: 'unit',
    version: '1',
    metrics: {
      hitAt10Count: 1,
      hitAt10: 0.5,
    },
    run: {},
    perQuery: [
      {
        id: 'stable',
        query: 'previous strict hit',
        firstRelevantRank: 1,
        topResultPaths: ['CommonModules/Stable/Ext/Module.bsl'],
      },
      {
        id: 'new-hit',
        query: 'previous miss',
        firstRelevantRank: null,
        topResultPaths: [],
      },
    ],
  };
  const tuned = {
    dataset: 'unit',
    version: '1',
    metrics: {
      hitAt10Count: 1,
      queryCount: 2,
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
    },
    perQuery: [
      {
        id: 'stable',
        query: 'previous strict hit',
        firstRelevantRank: null,
        topResultPaths: [],
      },
      {
        id: 'new-hit',
        query: 'previous miss',
        firstRelevantRank: 1,
        topResultPaths: ['CommonModules/NewHit/Ext/Module.bsl'],
      },
    ],
  };
  tuned.comparison = buildComparison(baseline, tuned);

  assert.equal(tuned.comparison.regressions.length, 1);
  assert.throws(
    () => enforceAcceptance(tuned, { baselineMode: 'non-regression' }),
    /Query-level baseline regressions are not allowed: stable/,
  );
  assert.doesNotThrow(() => enforceAcceptance(tuned, {
    baselineMode: 'non-regression',
    allowQueryRegressions: true,
  }));
});

test('demo-do30 live runner defaults to the tuned strict top1 baseline threshold', () => {
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts', 'run-demo-do30-1c-live-mcp-eval.js'), 'utf8');

  assert.match(runner, /'--strict-hit-at1-threshold', '21'/);
  assert.match(runner, /'--strict-hit-at5-threshold', '24'/);
});

test('demo-do30 live runner requires the preserved tuned baseline by default', () => {
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts', 'run-demo-do30-1c-live-mcp-eval.js'), 'utf8');

  assert.doesNotMatch(runner, /if \(fs\.existsSync\(finalTunedBaseline\)\)/);
  assert.match(runner, /Required demo-do30 baseline artifact is missing/);
  assert.match(runner, /'--baseline', finalTunedBaseline/);
});

test('enforces required residual assertions even when aggregate acceptance passes', () => {
  const summary = {
    metrics: {
      hitAt10Count: 27,
      queryCount: 30,
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
    },
    residualQueries: [
      {
        id: 'r06',
        firstRelevantRank: 2,
        topResultPaths: [
          'Catalogs/Товары/Commands/ПечатьШтрихкода/Ext/CommandModule.bsl',
          'Catalogs/Товары/Ext/ObjectModule.bsl',
        ],
      },
    ],
  };

  assert.throws(
    () => enforceAcceptance(summary, {
      acceptanceThreshold: 27,
      requiredResidualAssertions: [{
        id: 'r06',
        mustHitAt10: true,
        rankBefore: {
          preferredPrefix: 'Catalogs/Товары/Ext/ObjectModule.bsl',
          disfavoredPrefix: 'Catalogs/Товары/Commands/ПечатьШтрихкода',
        },
      }],
    }),
    /Residual assertion r06 failed: expected Catalogs\/Товары\/Ext\/ObjectModule\.bsl before Catalogs\/Товары\/Commands\/ПечатьШтрихкода/,
  );
});

test('requires baseline comparison when residual no-regression assertions are configured', () => {
  const summary = {
    metrics: {
      hitAt10Count: 27,
      queryCount: 30,
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
    },
    residualQueries: [
      {
        id: 'r01',
        firstRelevantRank: 1,
        topResultPaths: ['Reports/ОстаткиТоваровНаСкладах/Ext/ObjectModule.bsl'],
      },
    ],
  };

  assert.throws(
    () => enforceAcceptance(summary, {
      acceptanceThreshold: 27,
      requiredResidualAssertions: [{
        id: 'r01',
        mustHitAt10: true,
        noRegression: true,
      }],
    }),
    /Residual assertion r01 failed: missing comparison for no-regression assertion/,
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
    'requiredResultRoles',
    'labelsAreProductionRules',
    'residualQueryIds',
  ]) {
    assert.equal(productionRanking.includes(forbidden), false, `unexpected production ranking reference: ${forbidden}`);
  }
});

test('records r05 print audit decision by accepting the document object print context', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'demo-1c-relevance.json'));
  const r05 = dataset.queries.find((query) => query.id === 'r05');

  assert.ok(r05);
  assert.equal(
    r05.expectedPathPrefixes.includes('Documents/РасходТовара/Ext/ObjectModule.bsl'),
    true,
  );
});

test('loads the committed demo-do30 scenario dataset with reachable strict and acceptable labels', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'demo-do30-1c-scenarios.json'));
  const validation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-do30-1c'));

  assert.equal(dataset.dataset, 'demo-do30-1c-scenarios');
  assert.equal(dataset.fixture, 'examples/demo-do30-1c');
  assert.equal(dataset.labelsAreProductionRules, false);
  assert.equal(dataset.queries.length, 30);
  assert.equal(validation.unreachablePrefixCount, 0);
  assert.ok(validation.acceptablePrefixCount > 0);
  assert.ok(dataset.queries.every((query) => query.failureClass && query.note));
});

test('validates acceptable path prefixes and reports stale alternates', () => {
  const dataset = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-do30-1c',
    labelsAreProductionRules: false,
    queries: [{
      id: 'q1',
      query: 'проверка',
      kind: 'unit',
      expectedPathPrefixes: ['CommonModules'],
      acceptablePathPrefixes: ['NoSuchObject/StaleAlternate'],
    }],
  };

  const validation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-do30-1c'));

  assert.equal(validation.unreachablePrefixCount, 1);
  assert.equal(validation.expectedPrefixCount, 1);
  assert.equal(validation.acceptablePrefixCount, 1);
  assert.equal(validation.unreachable[0].prefixes[0].labelKind, 'acceptable');
});

test('loads compound-name holdout with reachable demo-do30 labels and separate negative controls', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'compound-1c-name-holdout.json'));
  const validation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-do30-1c'), {
    matrixFixture: 'demo-do30-1c',
  });
  const collection = collectionDatasetForFixture(dataset, 'demo-do30-1c');
  const positives = collection.queries.filter((query) => query.kind !== 'negative-control');
  const negatives = collection.queries.filter((query) => query.kind === 'negative-control');

  assert.equal(dataset.dataset, 'compound-1c-name-holdout');
  assert.equal(dataset.matrix, 'universal-1c-search');
  assert.equal(dataset.labelsAreProductionRules, false);
  assert.equal(positives.length, 8);
  assert.equal(negatives.length, 5);
  assert.equal(validation.fixtureKey, 'demo-do30-1c');
  assert.equal(validation.unreachablePrefixCount, 0);
  assert.equal(validation.issueCount, 0);
  assert.ok(dataset.queries.every((query) => query.intent && query.domain && query.kind && query.controlClass && query.note));
  assert.ok(positives.every((query) => query.targetStatus === 'applicable'));
  assert.ok(positives.every((query) => query.expectedPathPrefixes.length > 0));
});

test('compound-name holdout validation fails stale strict and acceptable labels', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'compound-1c-name-holdout.json'));
  const broken = structuredClone(dataset);
  const target = broken.queries.find((query) => query.id === 'cnh01').targets['demo-do30-1c'];
  target.expectedPathPrefixes = ['DocumentJournals/ЭлектроннаяПочта/Forms/НетТакойФормы'];
  target.acceptablePathPrefixes = ['DocumentJournals/ЭлектроннаяПочта/Commands/НетТакойКоманды'];

  const validation = validateLabels(broken, path.join(repoRoot, 'examples', 'demo-do30-1c'), {
    matrixFixture: 'demo-do30-1c',
  });

  assert.equal(validation.unreachablePrefixCount, 2);
  assert.deepEqual(
    validation.unreachable[0].prefixes.map((prefix) => prefix.labelKind),
    ['strict', 'acceptable'],
  );
});

test('compound-name holdout scores positive misses separately from negative-control failures', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'compound-1c-name-holdout.json'));
  const collection = collectionDatasetForFixture(dataset, 'demo-do30-1c');
  const results = [
    { id: 'cnh01', top10: [{ path: 'DocumentJournals/ЭлектроннаяПочта/Forms/ПечатьПисьма/Ext/Form/Module.bsl' }] },
    { id: 'cnh02', top10: [{ path: 'DocumentJournals/ЭлектроннаяПочта/Forms/ФормаСписка/Ext/Form/Module.bsl' }] },
    { id: 'cnh09', top10: [{ path: 'DocumentJournals/ЭлектроннаяПочта/Forms/ПечатьПисьма/Ext/Form/Module.bsl' }] },
  ];

  const summary = score(dataset, normalizeResults(results, collection), {
    backendLabel: 'unit',
    matrixFixture: 'demo-do30-1c',
  });

  assert.equal(summary.metrics.queryCount, 8);
  assert.equal(summary.metrics.strict.hitAt10Count, 1);
  assert.equal(summary.perQuery.find((row) => row.id === 'cnh02').firstStrictRank, null);
  assert.equal(summary.negativeControls.queryCount, 5);
  assert.equal(summary.negativeControls.failCount, 1);
  assert.equal(summary.negativeControls.failures[0].id, 'cnh09');
});

test('enforces compound-name holdout positive and negative-control thresholds', () => {
  const summary = {
    dataset: 'compound-1c-name-holdout',
    metrics: {
      queryCount: 8,
      hitAt10Count: 7,
      strict: {
        hitAt10Count: 7,
      },
    },
    negativeControls: {
      passCount: 4,
      queryCount: 5,
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
    },
    perQuery: [],
  };

  assert.throws(
    () => enforceAcceptance(summary, { strictPositiveHitAt10Threshold: 8 }),
    /Strict positive Hit@10 count 7 is below acceptance threshold 8/,
  );
  assert.throws(
    () => enforceAcceptance(summary, { negativeControlPassThreshold: 5 }),
    /Negative-control pass count 4 is below acceptance threshold 5/,
  );
  assert.doesNotThrow(() => enforceAcceptance(summary, {
    strictPositiveHitAt10Threshold: 7,
    negativeControlPassThreshold: 4,
  }));
});

test('scores strict and acceptable hits separately without counting alternates as strict hits', () => {
  const dataset = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-do30-1c',
    labelsAreProductionRules: false,
    queries: [{
      id: 'q1',
      query: 'sms provider',
      kind: 'unit',
      expectedPathPrefixes: ['Documents/SMSУведомление'],
      acceptablePathPrefixes: ['CommonModules/SMSПровайдер'],
      failureClass: 'sms-document-vs-service',
    }],
  };
  const results = [{
    id: 'q1',
    top10: [{
      path: 'CommonModules/SMSПровайдер/Ext/Module.bsl',
    }],
  }];

  const summary = score(dataset, normalizeResults(results, dataset), { backendLabel: 'unit' });

  assert.equal(summary.metrics.hitAt10Count, 0);
  assert.equal(summary.metrics.strict.hitAt10Count, 0);
  assert.equal(summary.metrics.acceptable.hitAt10Count, 1);
  assert.equal(summary.perQuery[0].firstRelevantRank, null);
  assert.equal(summary.perQuery[0].firstStrictRank, null);
  assert.equal(summary.perQuery[0].firstAcceptableRank, 1);
  assert.equal(summary.perQuery[0].acceptableOnlyHit, true);
});

test('enforces strict hit@1 and hit@5 thresholds for demo-do30 acceptance', () => {
  const summary = {
    metrics: {
      queryCount: 30,
      hitAt10Count: 30,
      strict: {
        hitAt1Count: 17,
        hitAt5Count: 24,
      },
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
    },
    perQuery: [],
  };

  assert.throws(
    () => enforceAcceptance(summary, { strictHitAt1Threshold: 18, strictHitAt5Threshold: 24 }),
    /Strict Hit@1 count 17 is below acceptance threshold 18/,
  );

  assert.doesNotThrow(() => enforceAcceptance({
    ...summary,
    metrics: {
      ...summary.metrics,
      strict: {
        hitAt1Count: 18,
        hitAt5Count: 24,
      },
    },
  }, { strictHitAt1Threshold: 18, strictHitAt5Threshold: 24 }));
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
    residualAssertions: [
      {
        id: 'r01',
        passed: false,
        failures: ['expected hit within top 10'],
        firstRelevantRank: null,
        comparisonStatus: 'unchanged',
        topResultPaths: ['Documents/РасходТовара/Ext/ObjectModule.bsl'],
      },
      {
        id: 'r06',
        passed: true,
        failures: [],
        firstRelevantRank: 2,
        comparisonStatus: 'improved',
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
  assert.match(markdown, /## Residual assertions/);
  assert.match(markdown, /\| r01 \| no \|  \| unchanged \| expected hit within top 10 \|/);
  assert.match(markdown, /\| r06 \| yes \| 2 \| improved \|  \|/);
});

test('writes strict misses and acceptable-only hits to markdown reports', () => {
  const outPath = path.join(repoRoot, '.artifacts', 'test', 'strict-acceptable-report.md');
  const summary = {
    dataset: 'unit',
    version: '1',
    fixture: 'examples/demo-do30-1c',
    run: { backendLabel: 'unit' },
    metrics: {
      queryCount: 2,
      hitAt10Count: 1,
      hitAt10: 0.5,
      mrrAt10: 0.5,
      precisionAt10: 0.05,
      failures: 1,
      strict: { hitAt1Count: 1, hitAt5Count: 1, hitAt10Count: 1, mrrAt10: 0.5 },
      acceptable: { hitAt1Count: 2, hitAt5Count: 2, hitAt10Count: 2, mrrAt10: 1 },
    },
    perQuery: [
      {
        id: 's01',
        query: 'strict miss acceptable hit',
        firstStrictRank: null,
        firstAcceptableRank: 1,
        acceptableOnlyHit: true,
        failureClass: 'fns-counterparty-state',
        latencyMs: 12,
        topResultPaths: ['CommonModules/ПроверкаКонтрагентовФНСПовтИсп/Ext/Module.bsl'],
      },
      {
        id: 's02',
        query: 'strict hit',
        firstStrictRank: 1,
        firstAcceptableRank: 1,
        acceptableOnlyHit: false,
        failureClass: 'saved-counterparty-state',
        latencyMs: 10,
        topResultPaths: ['CommonModules/ПроверкаКонтрагентовКлиентСервер/Ext/Module.bsl'],
      },
    ],
  };

  writeMarkdownReport(outPath, summary);

  const markdown = fs.readFileSync(outPath, 'utf8');
  assert.match(markdown, /Strict Hit@5: 1\/2/);
  assert.match(markdown, /Acceptable Hit@5: 2\/2/);
  assert.match(markdown, /## Strict misses/);
  assert.match(markdown, /\| s01 \| fns-counterparty-state \| 1 \|/);
  assert.match(markdown, /## Acceptable-only hits/);
});

test('loads the universal 1C matrix with complete fixture targets', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json'));
  const fixtures = Object.keys(dataset.fixtures);
  const positive = dataset.queries.filter((query) => query.kind !== 'negative-control');
  const negative = dataset.queries.filter((query) => query.kind === 'negative-control');
  const purposeCounts = dataset.queries.reduce((counts, query) => {
    counts[query.queryPurpose] = (counts[query.queryPurpose] || 0) + 1;
    return counts;
  }, {});
  const roleBearingRows = dataset.queries.filter((query) => (
    query.queryPurpose === 'task-implementation' &&
    Object.values(query.targets).some((target) => target.requiredResultRoles?.length)
  ));
  const positiveText = JSON.stringify(positive);
  const requiredCoverage = {
    reports: /Reports\//,
    informationRegisters: /InformationRegisters\//,
    accumulationRegisters: /AccumulationRegisters\//,
    accountingRegisters: /AccountingRegisters\//,
    documentPosting: /document-posting|проведение/i,
    beforeWrite: /before-write|перед записью/i,
    fillOnBase: /fill-on-base|ввод на основании/i,
    exchangePlans: /ExchangePlans\//,
    scheduledJobs: /ScheduledJobs\//,
    accounting: /accounting|бухгалтер/i,
    trade: /trade|торгов/i,
    warehouse: /warehouse|склад/i,
    production: /production|производ/i,
    retail: /retail|розниц/i,
  };

  assert.equal(dataset.dataset, 'universal-1c-search-matrix');
  assert.equal(dataset.labelsAreProductionRules, false);
  assert.equal(positive.length, 70);
  assert.equal(negative.length, 8);
  assert.deepEqual(purposeCounts, {
    navigation: 48,
    'applied-usage': 10,
    'negative-control': 8,
    'library-oriented': 4,
    'task-implementation': 8,
  });
  assert.equal(roleBearingRows.length, 8);
  assert.deepEqual(fixtures, [
    'demo-do30-1c',
    'demo-bp30-1c',
    'demo-ut-1c',
    'demo-unf-1c',
    'demo-zup-1c',
    'demo-ssl-1c',
    'demo-led-1c',
  ]);
  assert.deepEqual(dataset.fixtures['demo-zup-1c'], {
    label: 'Зарплата и управление персоналом',
    path: 'examples/demo-zup-1c',
  });
  assert.equal(dataset.queries.every((query) => fixtures.every((fixture) => query.targets[fixture])), true);
  for (const [coverageName, pattern] of Object.entries(requiredCoverage)) {
    assert.match(positiveText, pattern, `missing universal matrix coverage: ${coverageName}`);
  }
  for (const pattern of [/payroll/i, /hr-/i, /leave/i, /sick/i, /time-sheet/i, /ndfl/i, /sedo-fss/i, /military/i]) {
    assert.match(positiveText, pattern, `missing ZUP matrix coverage: ${pattern}`);
  }
  for (const pattern of [/bsp-mail/i, /bsp-sms/i, /bsp-files/i, /bsp-crypto/i]) {
    assert.match(positiveText, pattern, `missing SSL matrix coverage: ${pattern}`);
  }
  for (const pattern of [/edo-accounts/i, /edo-invitations/i, /edo-center/i, /mobile-signature/i]) {
    assert.match(positiveText, pattern, `missing LED matrix coverage: ${pattern}`);
  }
  const longOperations = dataset.queries.find((query) => query.id === 'ssl09');
  const bpRoles = longOperations.targets['demo-bp30-1c'].requiredResultRoles;
  assert.deepEqual(bpRoles.map((role) => role.id), [
    'library-api',
    'client-usage',
    'server-usage',
    'applied-usage',
    'metadata',
  ]);
  assert.equal(bpRoles.filter((role) => !role.optional).length, 4);
});

test('validates demo-zup-1c matrix labels and unresolved classifications', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json'));
  const validation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-zup-1c'), {
    matrixFixture: 'demo-zup-1c',
  });
  const collection = collectionDatasetForFixture(dataset, 'demo-zup-1c');

  assert.equal(validation.fixtureKey, 'demo-zup-1c');
  assert.equal(validation.applicableTargetCount, 48);
  assert.equal(validation.notApplicableTargetCount, 30);
  assert.equal(validation.needsInspectionCount, 0);
  assert.equal(validation.unreachablePrefixCount, 0);
  assert.equal(validation.issueCount, 0);
  assert.equal(validation.strictAcceptanceReady, true);
  assert.equal(collection.queries.filter((query) => query.kind !== 'negative-control').length, 40);
  assert.equal(collection.queries.filter((query) => query.kind === 'negative-control').length, 8);
  assert.equal(collection.queries.some((query) => query.id === 'zupn01'), true);
  assert.match(
    validation.notApplicable.find((row) => row.id === 'u24').reason,
    /Хозрасчетный/,
  );
  assert.deepEqual(validation.unresolved, []);
});

test('validates demo-ssl-1c and demo-led-1c matrix labels', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json'));
  const sslValidation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-ssl-1c'), {
    matrixFixture: 'demo-ssl-1c',
  });
  const ledValidation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-led-1c'), {
    matrixFixture: 'demo-led-1c',
  });
  const sslCollection = collectionDatasetForFixture(dataset, 'demo-ssl-1c');
  const ledCollection = collectionDatasetForFixture(dataset, 'demo-led-1c');

  assert.equal(sslValidation.applicableTargetCount, 24);
  assert.equal(sslValidation.notApplicableTargetCount, 54);
  assert.equal(sslValidation.needsInspectionCount, 0);
  assert.equal(sslValidation.unreachablePrefixCount, 0);
  assert.equal(sslValidation.issueCount, 0);
  assert.equal(sslValidation.strictAcceptanceReady, true);
  assert.equal(sslCollection.queries.filter((query) => query.kind !== 'negative-control').length, 18);
  assert.equal(sslCollection.queries.filter((query) => query.kind === 'negative-control').length, 6);
  assert.equal(sslCollection.queries.some((query) => query.id === 'ssl01'), true);
  assert.equal(sslCollection.queries.some((query) => query.id === 'ssl08'), true);

  assert.equal(ledValidation.applicableTargetCount, 29);
  assert.equal(ledValidation.notApplicableTargetCount, 49);
  assert.equal(ledValidation.needsInspectionCount, 0);
  assert.equal(ledValidation.unreachablePrefixCount, 0);
  assert.equal(ledValidation.issueCount, 0);
  assert.equal(ledValidation.strictAcceptanceReady, true);
  assert.equal(ledCollection.queries.filter((query) => query.kind !== 'negative-control').length, 23);
  assert.equal(ledCollection.queries.filter((query) => query.kind === 'negative-control').length, 6);
  assert.equal(ledCollection.queries.some((query) => query.id === 'led01'), true);
  assert.equal(ledCollection.queries.some((query) => query.id === 'led08'), true);
});

test('rejects unreachable demo-zup-1c applicable labels', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json'));
  const broken = structuredClone(dataset);
  broken.queries.find((query) => query.id === 'zup01').targets['demo-zup-1c'].expectedPathPrefixes = [
    'Documents/НетТакогоДокументаЗУП',
  ];

  const validation = validateLabels(broken, path.join(repoRoot, 'examples', 'demo-zup-1c'), {
    matrixFixture: 'demo-zup-1c',
  });

  assert.equal(validation.unreachablePrefixCount, 1);
  assert.equal(validation.unreachable[0].id, 'zup01');
  assert.equal(validation.unreachable[0].prefixes[0].prefix, 'Documents/НетТакогоДокументаЗУП');
});

test('validates required result role prefixes for universal matrix labels', () => {
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json'));
  const validation = validateLabels(dataset, path.join(repoRoot, 'examples', 'demo-bp30-1c'), {
    matrixFixture: 'demo-bp30-1c',
  });
  const ssl09 = validation.perQuery.find((row) => row.id === 'ssl09');
  const broken = structuredClone(dataset);
  broken.queries.find((query) => query.id === 'ssl09')
    .targets['demo-bp30-1c']
    .requiredResultRoles[0]
    .pathPrefixes = ['CommonModules/НетТакойДлительнойОперации'];
  const brokenValidation = validateLabels(broken, path.join(repoRoot, 'examples', 'demo-bp30-1c'), {
    matrixFixture: 'demo-bp30-1c',
  });

  assert.equal(validation.resultRolePrefixCount, 36);
  assert.equal(ssl09.prefixes.filter((prefix) => prefix.labelKind === 'result-role').length, 6);
  assert.equal(brokenValidation.unreachablePrefixCount, 1);
  assert.equal(brokenValidation.unreachable[0].id, 'ssl09');
  assert.equal(brokenValidation.unreachable[0].prefixes[0].labelKind, 'result-role');
});

test('scores demo-zup-1c negative controls and reports them in markdown', () => {
  const outPath = path.join(repoRoot, '.artifacts', 'test', 'universal-zup-negative.md');
  const dataset = readJson(path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json'));
  const collection = collectionDatasetForFixture(dataset, 'demo-zup-1c');
  const results = [
    {
      id: 'zup01',
      top10: [{ path: 'Documents/НачислениеЗарплаты/Ext/ObjectModule.bsl' }],
    },
    {
      id: 'zupn01',
      top10: [{ path: 'Documents/НачислениеЗарплаты/Ext/ObjectModule.bsl' }],
    },
  ];

  const summary = score(dataset, normalizeResults(results, collection), {
    backendLabel: 'unit',
    matrixFixture: 'demo-zup-1c',
  });
  writeMarkdownReport(outPath, summary);
  const markdown = fs.readFileSync(outPath, 'utf8');

  assert.equal(summary.negativeControls.queryCount, 8);
  assert.equal(summary.negativeControls.failCount, 1);
  assert.equal(summary.negativeControls.failures[0].id, 'zupn01');
  assert.match(markdown, /Negative controls: 7\/8 passed/);
  assert.match(markdown, /zupn01/);
});

test('validates universal target statuses without scoring unresolved targets as misses', () => {
  const fixtureRoot = path.join(repoRoot, '.artifacts', 'test', 'universal-fixture');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixtureRoot, 'CommonModules', 'Strict', 'Ext'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'CommonModules', 'Optional', 'Ext'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'CommonModules', 'Strict', 'Ext', 'Module.bsl'), '', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'CommonModules', 'Optional', 'Ext', 'Module.bsl'), '', 'utf8');
  const dataset = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    labelsAreProductionRules: false,
    fixtures: { 'demo-unit': { path: fixtureRoot } },
    queries: [
      {
        id: 'applicable',
        query: 'strict module',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['CommonModules/Strict'] } },
      },
      {
        id: 'optional',
        query: 'optional module',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'optional', expectedPathPrefixes: ['CommonModules/Optional'] } },
      },
      {
        id: 'not-applicable',
        query: 'foreign domain',
        kind: 'positive',
        intent: 'foreign',
        domain: 'foreign',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'not-applicable' } },
      },
      {
        id: 'needs-inspection',
        query: 'unknown domain',
        kind: 'positive',
        intent: 'unknown',
        domain: 'unknown',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'needs-inspection', note: 'manual review pending' } },
      },
    ],
  };

  const validation = validateLabels(dataset, fixtureRoot, { matrixFixture: 'demo-unit' });
  const flat = flattenUniversalMatrixForFixture(dataset, 'demo-unit');

  assert.equal(validation.applicableTargetCount, 1);
  assert.equal(validation.optionalTargetCount, 1);
  assert.equal(validation.notApplicableTargetCount, 1);
  assert.deepEqual(validation.notApplicable, [{
    id: 'not-applicable',
    query: 'foreign domain',
    fixtureKey: 'demo-unit',
    reason: null,
  }]);
  assert.equal(validation.needsInspectionCount, 1);
  assert.equal(validation.unreachablePrefixCount, 0);
  assert.equal(validation.strictAcceptanceReady, false);
  assert.deepEqual(flat.queries.map((query) => query.id), ['applicable']);
});

test('rejects universal acceptance while fixture labels still need inspection', () => {
  const summary = {
    dataset: 'universal-1c-search-matrix',
    metrics: {
      hitAt10Count: 1,
      queryCount: 1,
    },
    run: {
      rawSummary: {
        toolErrors: 0,
        missingColbertErrors: 0,
      },
      labelValidation: {
        fixtureKey: 'demo-unit',
        strictAcceptanceReady: false,
        needsInspectionCount: 1,
        unreachablePrefixCount: 0,
        issueCount: 0,
      },
    },
    perQuery: [],
  };

  assert.throws(
    () => enforceAcceptance(summary),
    /Universal matrix labels are not strict-acceptance ready for demo-unit/,
  );
});

test('reports malformed universal targets and unreachable applicable labels', () => {
  const fixtureRoot = path.join(repoRoot, '.artifacts', 'test', 'universal-invalid-fixture');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const dataset = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    labelsAreProductionRules: false,
    fixtures: { 'demo-unit': { path: fixtureRoot } },
    queries: [
      {
        id: 'missing',
        query: 'missing target',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: {},
      },
      {
        id: 'bad-status',
        query: 'bad target status',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        queryPurpose: 'unknown-purpose',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'unknown', expectedPathPrefixes: ['CommonModules/Missing'] } },
      },
      {
        id: 'unreachable',
        query: 'unreachable strict label',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['CommonModules/Missing'] } },
      },
    ],
  };

  const validation = validateLabels(dataset, fixtureRoot, { matrixFixture: 'demo-unit' });

  assert.equal(validation.missingTargetCount, 1);
  assert.equal(validation.issueCount, 3);
  assert.equal(validation.queryPurposeCoverage.unknownCount, 1);
  assert.equal(validation.unreachablePrefixCount, 1);
  assert.equal(validation.unreachable.some((row) => row.id === 'missing'), true);
  assert.equal(validation.unreachable.some((row) => row.id === 'bad-status'), true);
  assert.equal(validation.unreachable.some((row) => row.id === 'unreachable'), true);
});

test('keeps fixture keys in baseline comparison rows for universal matrix reports', () => {
  const baseline = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    metrics: { hitAt10Count: 0, hitAt10: 0 },
    run: {},
    perQuery: [
      {
        id: 'u31',
        query: 'журнал регистрации',
        fixtureKey: 'demo-bp30-1c',
        firstRelevantRank: null,
        topResultPaths: [],
      },
      {
        id: 'u31',
        query: 'журнал регистрации',
        fixtureKey: 'demo-ut-1c',
        firstRelevantRank: 1,
        topResultPaths: ['DataProcessors/ЖурналРегистрации/Ext/ObjectModule.bsl'],
      },
    ],
  };
  const tuned = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    metrics: { hitAt10Count: 1, hitAt10: 1 },
    run: {},
    perQuery: [
      {
        id: 'u31',
        query: 'журнал регистрации',
        fixtureKey: 'demo-bp30-1c',
        firstRelevantRank: 1,
        topResultPaths: ['DataProcessors/ЖурналРегистрации/Ext/ObjectModule.bsl'],
      },
      {
        id: 'u31',
        query: 'журнал регистрации',
        fixtureKey: 'demo-ut-1c',
        firstRelevantRank: null,
        topResultPaths: [],
      },
    ],
  };

  const comparison = buildComparison(baseline, tuned);

  assert.equal(comparison.comparable, true);
  assert.equal(comparison.improvements[0].fixtureKey, 'demo-bp30-1c');
  assert.equal(comparison.regressions[0].fixtureKey, 'demo-ut-1c');
});

test('scores universal positives by fixture and reports negative controls separately', () => {
  const dataset = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    labelsAreProductionRules: false,
    fixtures: { 'demo-unit': { path: 'examples/demo-unit' } },
    queries: [
      {
        id: 'q1',
        query: 'контрагент форма',
        kind: 'positive',
        intent: 'object-card-navigation',
        domain: 'counterparties',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['Catalogs/Контрагенты'] } },
      },
      {
        id: 'n1',
        query: 'зарплатный проект',
        kind: 'negative-control',
        intent: 'negative-control',
        domain: 'payroll',
        queryPurpose: 'negative-control',
        controlClass: 'negative-control',
        targets: { 'demo-unit': { status: 'applicable', prohibitedPathPrefixes: ['Catalogs/Контрагенты'] } },
      },
    ],
  };
  const collection = collectionDatasetForFixture(dataset, 'demo-unit');
  const results = [
    { id: 'q1', top10: [{ path: 'Catalogs/Контрагенты/Forms/ФормаЭлемента/Ext/Form/Module.bsl' }] },
    { id: 'n1', top10: [{ path: 'Catalogs/Контрагенты/Ext/ObjectModule.bsl' }] },
  ];

  const summary = score(dataset, normalizeResults(results, collection), {
    backendLabel: 'unit',
    matrixFixture: 'demo-unit',
  });

  assert.equal(collection.queries.length, 2);
  assert.equal(summary.metrics.queryCount, 1);
  assert.equal(summary.metrics.strict.hitAt10Count, 1);
  assert.equal(summary.grouped.fixture['demo-unit'].queryCount, 1);
  assert.equal(summary.grouped.domain.counterparties.strict.hitAt10Count, 1);
  assert.equal(summary.grouped.queryPurpose.navigation.strict.hitAt10Count, 1);
  assert.equal(summary.matrix.queryPurposeCoverage.counts.navigation, 1);
  assert.equal(summary.matrix.queryPurposeCoverage.counts['negative-control'], 1);
  assert.equal(summary.negativeControls.queryCount, 1);
  assert.equal(summary.negativeControls.failCount, 1);
  assert.deepEqual(summary.negativeControls.failures[0].violations, ['Catalogs/Контрагенты/Ext/ObjectModule.bsl']);
});

test('scores and reports required bundle roles separately from strict hits', () => {
  const outPath = path.join(repoRoot, '.artifacts', 'test', 'universal-bundle-roles.md');
  const dataset = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    labelsAreProductionRules: false,
    fixtures: { 'demo-unit': { path: 'examples/demo-unit' } },
    queries: [
      {
        id: 'bundle',
        query: 'длительная операция',
        kind: 'positive',
        intent: 'long-operation-navigation',
        domain: 'bsp-long-operations',
        queryPurpose: 'task-implementation',
        controlClass: 'source-inspected',
        targets: {
          'demo-unit': {
            status: 'applicable',
            expectedPathPrefixes: ['CommonModules/ДлительныеОперации/Ext/Module.bsl'],
            requiredResultRoles: [
              { id: 'api', label: 'API', pathPrefixes: ['CommonModules/ДлительныеОперации/Ext/Module.bsl'] },
              { id: 'client', label: 'Client', pathPrefixes: ['CommonModules/ДлительныеОперацииКлиент/Ext/Module.bsl'] },
            ],
          },
        },
      },
    ],
  };
  const collection = collectionDatasetForFixture(dataset, 'demo-unit');
  const summary = score(
    dataset,
    normalizeResults([{
      id: 'bundle',
      top10: [{ path: 'CommonModules/ДлительныеОперации/Ext/Module.bsl' }],
    }], collection),
    { matrixFixture: 'demo-unit' },
  );

  assert.equal(summary.metrics.strict.hitAt10Count, 1);
  assert.deepEqual(summary.bundleRoles, {
    queryCount: 1,
    completeCount: 0,
    incompleteCount: 1,
    missingRequiredRoleCount: 1,
    missingRequiredRolesById: {
      client: {
        roleId: 'client',
        label: 'Client',
        count: 1,
        failures: [{
          id: 'bundle',
          query: 'длительная операция',
          fixtureKey: 'demo-unit',
          intent: 'long-operation-navigation',
          domain: 'bsp-long-operations',
          queryPurpose: 'task-implementation',
          pathPrefixes: ['CommonModules/ДлительныеОперацииКлиент/Ext/Module.bsl'],
        }],
      },
    },
    incompleteQueries: [{
      id: 'bundle',
      query: 'длительная операция',
      missingRequiredRoles: [{
        id: 'client',
        label: 'Client',
        pathPrefixes: ['CommonModules/ДлительныеОперацииКлиент/Ext/Module.bsl'],
      }],
    }],
  });
  assert.equal(summary.perQuery[0].roleCoverage.complete, false);
  assert.equal(summary.perQuery[0].missingRequiredRoles[0].id, 'client');

  writeMarkdownReport(outPath, summary);
  const markdown = fs.readFileSync(outPath, 'utf8');
  assert.match(markdown, /Bundle roles: 0\/1 complete/);
  assert.match(markdown, /## Bundle role coverage/);
  assert.match(markdown, /## Missing required bundle roles/);
  assert.match(markdown, /\| Client \| 1 \| demo-unit::bundle \|/);
  assert.match(markdown, /\| bundle \| no \| 1\/2 \| Client \|/);
});

test('preserves not-applicable reasons in universal matrix summaries and markdown', () => {
  const outPath = path.join(repoRoot, '.artifacts', 'test', 'universal-not-applicable.md');
  const dataset = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    labelsAreProductionRules: false,
    fixtures: { 'demo-unit': { path: 'examples/demo-unit' } },
    queries: [
      {
        id: 'q1',
        query: 'контрагент форма',
        kind: 'positive',
        intent: 'object-card-navigation',
        domain: 'counterparties',
        queryPurpose: 'navigation',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['Catalogs/Контрагенты'] } },
      },
      {
        id: 'q2',
        query: 'торговый заказ',
        kind: 'positive',
        intent: 'sales-order',
        domain: 'trade',
        queryPurpose: 'applied-usage',
        controlClass: 'source-inspected',
        targets: {
          'demo-unit': {
            status: 'not-applicable',
            reason: 'В этой фикстуре нет торгового заказа.',
          },
        },
      },
    ],
  };
  const collection = collectionDatasetForFixture(dataset, 'demo-unit');
  const summary = score(
    dataset,
    normalizeResults([{ id: 'q1', top10: [{ path: 'Catalogs/Контрагенты/Ext/ObjectModule.bsl' }] }], collection),
    { matrixFixture: 'demo-unit' },
  );

  assert.equal(summary.metrics.queryCount, 1);
  assert.deepEqual(summary.matrix.notApplicableTargets, [{
    id: 'q2',
    query: 'торговый заказ',
    fixtureKey: 'demo-unit',
    intent: 'sales-order',
    domain: 'trade',
    controlClass: 'source-inspected',
    queryPurpose: 'applied-usage',
    targetStatus: 'not-applicable',
    reason: 'В этой фикстуре нет торгового заказа.',
  }]);

  writeMarkdownReport(outPath, summary);
  const markdown = fs.readFileSync(outPath, 'utf8');
  assert.match(markdown, /Not-applicable targets: 1/);
  assert.match(markdown, /В этой фикстуре нет торгового заказа/);
});

test('uses actual universal matrix query counts in threshold recommendations', () => {
  const fixtureRoot = path.join(repoRoot, '.artifacts', 'test', 'universal-threshold-fixture');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixtureRoot, 'CommonModules', 'Strict'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'CommonModules', 'Strict', 'Module.bsl'), '', 'utf8');
  const dataset = {
    dataset: 'universal-1c-search-matrix',
    version: 1,
    labelsAreProductionRules: false,
    fixtures: { 'demo-unit': { path: fixtureRoot } },
    queries: [{
      id: 'q1',
      query: 'strict module',
      kind: 'positive',
      intent: 'module',
      domain: 'common',
      queryPurpose: 'navigation',
      controlClass: 'source-inspected',
      targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['CommonModules/Strict'] } },
    }],
  };
  const collection = collectionDatasetForFixture(dataset, 'demo-unit');
  const validation = validateLabels(dataset, fixtureRoot, { matrixFixture: 'demo-unit' });
  const summary = score(
    dataset,
    normalizeResults([{ id: 'q1', top10: [{ path: 'CommonModules/Strict/Module.bsl' }] }], collection),
    {
      matrixFixture: 'demo-unit',
      labelValidation: {
        strictAcceptanceReady: validation.strictAcceptanceReady,
        unreachablePrefixCount: validation.unreachablePrefixCount,
      },
    },
  );
  summary.run.labelValidation.thresholdRecommendation = buildThresholdRecommendation(summary, validation);

  assert.match(summary.run.labelValidation.thresholdRecommendation, /Hit@10 1\/1/);
  assert.doesNotMatch(summary.run.labelValidation.thresholdRecommendation, /24\/30/);
});

test('keeps universal matrix labels out of production ranking code', () => {
  const productionRanking = fs.readFileSync(
    path.join(repoRoot, 'packages', 'core', 'src', 'code-symbol-retrieval.ts'),
    'utf8',
  );

  for (const forbidden of [
    'universal-1c-search-matrix',
    'queryPurpose',
    'requiredResultRoles',
    'demo-bp30-1c',
    'demo-ut-1c',
    'demo-unf-1c',
    'needs-inspection',
    'prohibitedPathPrefixes',
    'u31',
    'n01',
  ]) {
    assert.equal(productionRanking.includes(forbidden), false, `unexpected production ranking reference: ${forbidden}`);
  }
});
