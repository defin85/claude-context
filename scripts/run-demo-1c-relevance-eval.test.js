#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildComparison,
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
  assert.equal(positive.length, 40);
  assert.equal(negative.length, 6);
  assert.deepEqual(fixtures, ['demo-do30-1c', 'demo-bp30-1c', 'demo-ut-1c', 'demo-unf-1c']);
  assert.equal(dataset.queries.every((query) => fixtures.every((fixture) => query.targets[fixture])), true);
  for (const [coverageName, pattern] of Object.entries(requiredCoverage)) {
    assert.match(positiveText, pattern, `missing universal matrix coverage: ${coverageName}`);
  }
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
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['CommonModules/Strict'] } },
      },
      {
        id: 'optional',
        query: 'optional module',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'optional', expectedPathPrefixes: ['CommonModules/Optional'] } },
      },
      {
        id: 'not-applicable',
        query: 'foreign domain',
        kind: 'positive',
        intent: 'foreign',
        domain: 'foreign',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'not-applicable' } },
      },
      {
        id: 'needs-inspection',
        query: 'unknown domain',
        kind: 'positive',
        intent: 'unknown',
        domain: 'unknown',
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
        controlClass: 'source-inspected',
        targets: {},
      },
      {
        id: 'bad-status',
        query: 'bad target status',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'unknown', expectedPathPrefixes: ['CommonModules/Missing'] } },
      },
      {
        id: 'unreachable',
        query: 'unreachable strict label',
        kind: 'positive',
        intent: 'module',
        domain: 'common',
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['CommonModules/Missing'] } },
      },
    ],
  };

  const validation = validateLabels(dataset, fixtureRoot, { matrixFixture: 'demo-unit' });

  assert.equal(validation.missingTargetCount, 1);
  assert.equal(validation.issueCount, 2);
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
        controlClass: 'source-inspected',
        targets: { 'demo-unit': { status: 'applicable', expectedPathPrefixes: ['Catalogs/Контрагенты'] } },
      },
      {
        id: 'n1',
        query: 'зарплатный проект',
        kind: 'negative-control',
        intent: 'negative-control',
        domain: 'payroll',
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
  assert.equal(summary.negativeControls.queryCount, 1);
  assert.equal(summary.negativeControls.failCount, 1);
  assert.deepEqual(summary.negativeControls.failures[0].violations, ['Catalogs/Контрагенты/Ext/ObjectModule.bsl']);
});

test('keeps universal matrix labels out of production ranking code', () => {
  const productionRanking = fs.readFileSync(
    path.join(repoRoot, 'packages', 'core', 'src', 'code-symbol-retrieval.ts'),
    'utf8',
  );

  for (const forbidden of [
    'universal-1c-search-matrix',
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
