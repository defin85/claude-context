#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const key = arg
        .slice(2)
        .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCsvList(value) {
  if (!value || value === true) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonOption(value, fieldName) {
  if (!value || value === true) {
    return undefined;
  }
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`Invalid JSON for --${fieldName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, ' ');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

const UNIVERSAL_MATRIX_DATASET = 'universal-1c-search-matrix';
const UNIVERSAL_TARGET_STATUSES = new Set([
  'applicable',
  'optional',
  'not-applicable',
  'needs-inspection',
]);

function isUniversalMatrixDataset(dataset) {
  return Boolean(
    dataset &&
    Array.isArray(dataset.queries) &&
    (dataset.dataset === UNIVERSAL_MATRIX_DATASET || dataset.matrix === 'universal-1c-search'),
  );
}

function inferMatrixFixtureKey(dataset, options = {}) {
  if (options.matrixFixture) {
    return options.matrixFixture;
  }
  if (options.fixtureKey) {
    return options.fixtureKey;
  }
  if (options.codebasePath) {
    return path.basename(path.resolve(options.codebasePath));
  }
  const fixtureKeys = Object.keys(dataset.fixtures || {});
  if (fixtureKeys.length === 1) {
    return fixtureKeys[0];
  }
  throw new Error('Universal 1C matrix scoring requires --matrix-fixture or --codebase-path.');
}

function comparisonKey(row) {
  return row.fixtureKey ? `${row.fixtureKey}::${row.id}` : row.id;
}

function isNegativeControlQuery(query) {
  return query.kind === 'negative-control' || query.controlClass === 'negative-control';
}

function universalTargetForFixture(query, fixtureKey) {
  return query.targets && query.targets[fixtureKey];
}

function universalQueriesForFixture(dataset, fixtureKey, options = {}) {
  const includeOptional = Boolean(options.includeOptionalTargets);
  const includeNegativeControls = Boolean(options.includeNegativeControls);
  const queries = [];
  for (const query of dataset.queries) {
    const target = universalTargetForFixture(query, fixtureKey);
    if (!target) {
      continue;
    }
    if (!['applicable', ...(includeOptional ? ['optional'] : [])].includes(target.status)) {
      continue;
    }
    if (isNegativeControlQuery(query) && !includeNegativeControls) {
      continue;
    }
    if (!isNegativeControlQuery(query) || includeNegativeControls) {
      queries.push({
        ...query,
        fixtureKey,
        matrixQueryId: query.id,
        targetStatus: target.status,
        expectedPathPrefixes: target.expectedPathPrefixes || [],
        acceptablePathPrefixes: target.acceptablePathPrefixes || [],
        prohibitedPathPrefixes: target.prohibitedPathPrefixes || [],
        requiredResultRoles: target.requiredResultRoles || [],
        note: target.note || query.note,
      });
    }
  }
  return queries;
}

function flattenUniversalMatrixForFixture(dataset, fixtureKey, options = {}) {
  const fixtureInfo = dataset.fixtures?.[fixtureKey] || {};
  return {
    dataset: `${dataset.dataset}:${fixtureKey}`,
    version: dataset.version,
    fixture: fixtureInfo.path || fixtureKey,
    labelsAreProductionRules: dataset.labelsAreProductionRules,
    matrix: dataset.dataset,
    matrixFixture: fixtureKey,
    queries: universalQueriesForFixture(dataset, fixtureKey, {
      includeOptionalTargets: options.includeOptionalTargets,
      includeNegativeControls: false,
    }),
  };
}

function collectionDatasetForFixture(dataset, fixtureKey, options = {}) {
  if (!isUniversalMatrixDataset(dataset)) {
    return dataset;
  }
  const fixtureInfo = dataset.fixtures?.[fixtureKey] || {};
  return {
    dataset: `${dataset.dataset}:${fixtureKey}:collection`,
    version: dataset.version,
    fixture: fixtureInfo.path || fixtureKey,
    labelsAreProductionRules: dataset.labelsAreProductionRules,
    matrix: dataset.dataset,
    matrixFixture: fixtureKey,
    queries: universalQueriesForFixture(dataset, fixtureKey, {
      includeOptionalTargets: options.includeOptionalTargets,
      includeNegativeControls: true,
    }),
  };
}

function normalizeResultItem(item) {
  const relativePath = normalizePath(item.relativePath || item.path || item.filePath || '');
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  return {
    relativePath,
    path: relativePath,
    startLine: item.startLine ?? item.start ?? item.lines?.[0],
    endLine: item.endLine ?? item.end ?? item.lines?.[1],
    score: item.score,
    metadata,
    rank: item.rank,
    sources: item.sources,
    lexicalScore: item.lexicalScore ?? metadata.lexicalScore,
    semanticScore: item.semanticScore ?? metadata.semanticScore,
    exactSymbolBoost: item.exactSymbolBoost ?? metadata.exactSymbolBoost,
    pathBoost: item.pathBoost ?? metadata.pathBoost,
    fusionScore: item.fusionScore ?? metadata.fusionScore,
    rankingProfile: item.rankingProfile ?? metadata.rankingProfile,
  };
}

function datasetLookup(dataset) {
  const byId = new Map();
  const byQuery = new Map();
  for (const query of dataset.queries) {
    byId.set(query.id, query);
    byQuery.set(normalizeText(query.query), query);
  }
  return { byId, byQuery };
}

function datasetFromReport(rawResults) {
  if (!rawResults || !Array.isArray(rawResults.results)) {
    throw new Error('--use-report-labels requires a live report with results[].expectedPrefixes.');
  }
  return {
    dataset: rawResults.dataset || 'demo-1c-live-report-labels',
    version: rawResults.version || rawResults.startedAt || 'report-local',
    fixture: rawResults.codebasePath,
    labelsAreProductionRules: false,
    queries: rawResults.results.map((row) => {
      if (!Array.isArray(row.expectedPrefixes)) {
        throw new Error(`Report row ${row.id || row.query || '<unknown>'} is missing expectedPrefixes.`);
      }
      return {
        id: row.id,
        query: row.query,
        kind: row.kind || 'live-report',
        expectedPathPrefixes: row.expectedPrefixes,
      };
    }),
  };
}

function normalizeEntryToResults(entry, backend) {
  if (Array.isArray(entry)) {
    return {
      results: entry.map(normalizeResultItem),
    };
  }
  if (!entry || typeof entry !== 'object') {
    return {
      results: [],
    };
  }
  if (backend && entry.backends && Array.isArray(entry.backends[backend])) {
    return {
      results: entry.backends[backend].map(normalizeResultItem),
      latencyMs: entry.timingsMs ? entry.timingsMs[backend] : undefined,
      error: entry.error || null,
    };
  }
  if (Array.isArray(entry.results)) {
    return {
      results: entry.results.map(normalizeResultItem),
      latencyMs: entry.latencyMs ?? entry.elapsedMs,
      error: entry.error || null,
    };
  }
  if (Array.isArray(entry.top10)) {
    return {
      results: entry.top10.map(normalizeResultItem),
      latencyMs: entry.latencyMs ?? entry.elapsedMs,
      error: entry.error || null,
      sourceId: entry.id,
      sourceQuery: entry.query,
    };
  }
  if (Array.isArray(entry.topResultPaths)) {
    return {
      results: entry.topResultPaths.map((pathValue, index) => normalizeResultItem({
        path: pathValue,
        rank: index + 1,
      })),
      latencyMs: entry.latencyMs ?? entry.elapsedMs,
      error: entry.error || null,
    };
  }
  return {
    results: [],
    latencyMs: entry.latencyMs ?? entry.elapsedMs,
    error: entry.error || null,
  };
}

function normalizeResults(resultsInput, dataset, backend) {
  const lookup = datasetLookup(dataset);
  const byId = {};
  const unsupported = [];
  const assign = (sourceId, sourceQuery, entry) => {
    const datasetQuery = lookup.byId.get(sourceId) || lookup.byQuery.get(normalizeText(sourceQuery));
    if (!datasetQuery) {
      unsupported.push({ id: sourceId, query: sourceQuery, reason: 'no matching dataset query id or query text' });
      return;
    }
    byId[datasetQuery.id] = normalizeEntryToResults(entry, backend);
  };

  if (Array.isArray(resultsInput)) {
    for (const item of resultsInput) {
      if (item.id && Array.isArray(item.results)) {
        assign(item.id, item.query, item);
      } else if (backend && item.id && item.backends && Array.isArray(item.backends[backend])) {
        assign(item.id, item.query, item);
      } else if (item.id && Array.isArray(item.top10)) {
        assign(item.id, item.query, item);
      } else if (item.id && Array.isArray(item.topResultPaths)) {
        assign(item.id, item.query, item);
      } else {
        unsupported.push({ id: item.id, query: item.query, reason: 'unsupported array item shape' });
      }
    }
    assertNoUnsupportedResults(unsupported);
    return byId;
  }
  if (resultsInput && typeof resultsInput === 'object') {
    if (Array.isArray(resultsInput.results)) {
      return normalizeResults(resultsInput.results, dataset, backend);
    }
    if (Array.isArray(resultsInput.perQuery)) {
      return normalizeResults(resultsInput.perQuery, dataset, backend);
    }
    const source = resultsInput.resultsById || resultsInput;
    for (const [id, entry] of Object.entries(source)) {
      assign(id, entry?.query, entry);
    }
    assertNoUnsupportedResults(unsupported);
    return byId;
  }
  return {};
}

function assertNoUnsupportedResults(unsupported) {
  if (unsupported.length > 0) {
    const preview = unsupported
      .slice(0, 5)
      .map((item) => `${item.id || '<missing id>'}: ${item.reason}`)
      .join('; ');
    throw new Error(`Unsupported live result schema for ${unsupported.length} row(s): ${preview}`);
  }
}

function isRelevant(result, expectedPathPrefixes) {
  const relativePath = normalizePath(result.relativePath || result.path || '');
  return expectedPathPrefixes.some((prefix) => relativePath.startsWith(normalizePath(prefix)));
}

function firstRelevantRank(results, expectedPathPrefixes, limit = 10) {
  const capped = results.slice(0, limit);
  for (let index = 0; index < capped.length; index += 1) {
    if (isRelevant(capped[index], expectedPathPrefixes)) {
      return index + 1;
    }
  }
  return null;
}

function evaluateResultRoles(results, roles = [], limit = 10) {
  const capped = results.slice(0, limit);
  return roles.map((role) => {
    const prefixes = role.pathPrefixes || [];
    const matchedPaths = capped
      .map((result) => normalizePath(result.relativePath || result.path || ''))
      .filter((resultPath) => prefixes.some((prefix) => resultPath.startsWith(normalizePath(prefix))));
    return {
      id: role.id,
      label: role.label,
      description: role.description,
      optional: Boolean(role.optional),
      pathPrefixes: prefixes,
      found: matchedPaths.length > 0,
      matchedPaths,
    };
  });
}

function summarizeRoleCoverage(roleRows) {
  const requiredRows = roleRows.filter((row) => !row.optional);
  const foundRequiredRows = requiredRows.filter((row) => row.found);
  return {
    roleCount: roleRows.length,
    requiredRoleCount: requiredRows.length,
    foundRoleCount: roleRows.filter((row) => row.found).length,
    foundRequiredRoleCount: foundRequiredRows.length,
    missingRequiredRoleCount: requiredRows.length - foundRequiredRows.length,
    complete: requiredRows.every((row) => row.found),
  };
}

function metricBucket() {
  return {
    hitAt1Count: 0,
    hitAt3Count: 0,
    hitAt5Count: 0,
    hitAt10Count: 0,
    hitAt1: 0,
    hitAt3: 0,
    hitAt5: 0,
    hitAt10: 0,
    mrrAt10: 0,
  };
}

function addRankMetrics(bucket, rank) {
  bucket.hitAt1Count += rank !== null && rank <= 1 ? 1 : 0;
  bucket.hitAt3Count += rank !== null && rank <= 3 ? 1 : 0;
  bucket.hitAt5Count += rank !== null && rank <= 5 ? 1 : 0;
  bucket.hitAt10Count += rank !== null && rank <= 10 ? 1 : 0;
  bucket.hitAt1 += rank !== null && rank <= 1 ? 1 : 0;
  bucket.hitAt3 += rank !== null && rank <= 3 ? 1 : 0;
  bucket.hitAt5 += rank !== null && rank <= 5 ? 1 : 0;
  bucket.hitAt10 += rank !== null && rank <= 10 ? 1 : 0;
  bucket.mrrAt10 += rank !== null ? 1 / rank : 0;
}

function finalizeRankMetrics(bucket, queryCount) {
  for (const key of ['hitAt1', 'hitAt3', 'hitAt5', 'hitAt10', 'mrrAt10']) {
    bucket[key] = Number((bucket[key] / queryCount).toFixed(4));
  }
}

function precisionAt(results, expectedPathPrefixes, k) {
  const capped = results.slice(0, k);
  if (capped.length === 0) {
    return 0;
  }
  return capped.filter((result) => isRelevant(result, expectedPathPrefixes)).length / k;
}

function scoreFlatDataset(dataset, resultsById, runMetadata = {}) {
  const perQuery = [];
  const metrics = {
    queryCount: dataset.queries.length,
    failures: 0,
    hitAt1Count: 0,
    hitAt3Count: 0,
    hitAt5Count: 0,
    hitAt10Count: 0,
    hitAt1: 0,
    hitAt3: 0,
    hitAt5: 0,
    hitAt10: 0,
    mrrAt10: 0,
    precisionAt3: 0,
    precisionAt5: 0,
    precisionAt10: 0,
    relevantHitsAt10: 0,
    latencyMs: {
      average: 0,
      max: 0,
    },
    strict: metricBucket(),
    acceptable: metricBucket(),
  };
  let latencyTotal = 0;
  let latencyCount = 0;

  for (const query of dataset.queries) {
    const entry = resultsById[query.id] || [];
    const results = Array.isArray(entry) ? entry : entry.results || [];
    const latencyMs = Array.isArray(entry) ? undefined : entry.latencyMs;
    const error = Array.isArray(entry) ? null : entry.error || null;
    const strictPrefixes = query.expectedPathPrefixes || [];
    const acceptablePrefixes = [
      ...strictPrefixes,
      ...(query.acceptablePathPrefixes || []),
    ];
    const strictRank = firstRelevantRank(results, strictPrefixes, 10);
    const acceptableRank = firstRelevantRank(results, acceptablePrefixes, 10);
    const alternateRank = firstRelevantRank(results, query.acceptablePathPrefixes || [], 10);
    const resultRoles = evaluateResultRoles(results, query.requiredResultRoles || [], 10);
    const roleCoverage = summarizeRoleCoverage(resultRoles);
    const rank = strictRank;
    const relevantAt10 = results
      .slice(0, 10)
      .filter((result) => isRelevant(result, strictPrefixes)).length;
    const row = {
      id: query.id,
      query: query.query,
      kind: query.kind,
      firstRelevantRank: rank,
      firstStrictRank: strictRank,
      firstAcceptableRank: acceptableRank,
      firstAlternateRank: alternateRank,
      acceptableOnlyHit: strictRank === null && alternateRank !== null,
      relevantHitsAt10: relevantAt10,
      topResultPaths: results.slice(0, 10).map((result) => result.relativePath || result.path || ''),
      topResults: results.slice(0, 10),
      resultRoles,
      roleCoverage,
      missingRequiredRoles: resultRoles.filter((role) => !role.optional && !role.found),
      missing: rank === null,
      latencyMs,
      error,
      failureClass: query.failureClass,
      note: query.note,
    };
    perQuery.push(row);

    if (rank === null || error) {
      metrics.failures += 1;
    }
    addRankMetrics(metrics.strict, strictRank);
    addRankMetrics(metrics.acceptable, acceptableRank);
    metrics.hitAt1Count = metrics.strict.hitAt1Count;
    metrics.hitAt3Count = metrics.strict.hitAt3Count;
    metrics.hitAt5Count = metrics.strict.hitAt5Count;
    metrics.hitAt10Count = metrics.strict.hitAt10Count;
    metrics.hitAt1 = metrics.strict.hitAt1;
    metrics.hitAt3 = metrics.strict.hitAt3;
    metrics.hitAt5 = metrics.strict.hitAt5;
    metrics.hitAt10 = metrics.strict.hitAt10;
    metrics.mrrAt10 = metrics.strict.mrrAt10;
    metrics.precisionAt3 += precisionAt(results, strictPrefixes, 3);
    metrics.precisionAt5 += precisionAt(results, strictPrefixes, 5);
    metrics.precisionAt10 += precisionAt(results, strictPrefixes, 10);
    metrics.relevantHitsAt10 += relevantAt10;
    if (Number.isFinite(latencyMs)) {
      latencyTotal += latencyMs;
      latencyCount += 1;
      metrics.latencyMs.max = Math.max(metrics.latencyMs.max, latencyMs);
    }
  }

  for (const key of ['hitAt1', 'hitAt3', 'hitAt5', 'hitAt10', 'mrrAt10', 'precisionAt3', 'precisionAt5', 'precisionAt10']) {
    metrics[key] = Number((metrics[key] / dataset.queries.length).toFixed(4));
  }
  finalizeRankMetrics(metrics.strict, dataset.queries.length);
  finalizeRankMetrics(metrics.acceptable, dataset.queries.length);
  metrics.latencyMs.average = latencyCount > 0 ? Number((latencyTotal / latencyCount).toFixed(2)) : null;
  if (latencyCount === 0) {
    metrics.latencyMs.max = null;
  }

  const residualQueryIds = new Set(runMetadata.residualQueryIds || []);
  const summary = {
    dataset: dataset.dataset,
    version: dataset.version,
    fixture: dataset.fixture,
    labelsAreProductionRules: dataset.labelsAreProductionRules,
    run: runMetadata,
    metrics,
    perQuery,
    bundleRoles: summarizeBundleRoles(perQuery),
    ...(residualQueryIds.size > 0
      ? { residualQueries: perQuery.filter((row) => residualQueryIds.has(row.id)) }
      : {}),
  };
  if (Array.isArray(runMetadata.requiredResidualAssertions) && runMetadata.requiredResidualAssertions.length > 0) {
    summary.residualAssertions = evaluateResidualAssertions(summary, runMetadata.requiredResidualAssertions);
  }
  return summary;
}

function summarizeBundleRoles(perQuery) {
  const rows = perQuery.filter((row) => row.roleCoverage?.roleCount > 0);
  return {
    queryCount: rows.length,
    completeCount: rows.filter((row) => row.roleCoverage.complete).length,
    incompleteCount: rows.filter((row) => !row.roleCoverage.complete).length,
    missingRequiredRoleCount: rows.reduce((sum, row) => sum + row.roleCoverage.missingRequiredRoleCount, 0),
    incompleteQueries: rows
      .filter((row) => !row.roleCoverage.complete)
      .map((row) => ({
        id: row.id,
        query: row.query,
        missingRequiredRoles: row.missingRequiredRoles.map((role) => ({
          id: role.id,
          label: role.label,
          pathPrefixes: role.pathPrefixes,
        })),
      })),
  };
}

function groupPerQuery(rows, fieldName) {
  const groups = {};
  for (const row of rows) {
    const key = row[fieldName] || 'unspecified';
    if (!groups[key]) {
      groups[key] = {
        queryCount: 0,
        failures: 0,
        strict: metricBucket(),
        acceptable: metricBucket(),
      };
    }
    const group = groups[key];
    group.queryCount += 1;
    group.failures += row.firstStrictRank === null || row.error ? 1 : 0;
    addRankMetrics(group.strict, row.firstStrictRank);
    addRankMetrics(group.acceptable, row.firstAcceptableRank);
  }
  for (const group of Object.values(groups)) {
    finalizeRankMetrics(group.strict, group.queryCount);
    finalizeRankMetrics(group.acceptable, group.queryCount);
  }
  return groups;
}

function scoreNegativeControls(dataset, resultsById, fixtureKey, options = {}) {
  const queries = universalQueriesForFixture(dataset, fixtureKey, {
    includeOptionalTargets: options.includeOptionalTargets,
    includeNegativeControls: true,
  }).filter(isNegativeControlQuery);
  const perQuery = queries.map((query) => {
    const entry = resultsById[query.id] || [];
    const results = Array.isArray(entry) ? entry : entry.results || [];
    const error = Array.isArray(entry) ? null : entry.error || null;
    const prohibitedPrefixes = query.prohibitedPathPrefixes || [];
    const topResultPaths = results.slice(0, 10).map((result) => result.relativePath || result.path || '');
    const violations = topResultPaths
      .filter((resultPath) => prohibitedPrefixes.some((prefix) => normalizePath(resultPath).startsWith(normalizePath(prefix))));
    return {
      id: query.id,
      query: query.query,
      intent: query.intent,
      domain: query.domain,
      controlClass: query.controlClass,
      targetStatus: query.targetStatus,
      passed: violations.length === 0 && !error,
      violations,
      prohibitedPathPrefixes: prohibitedPrefixes,
      topResultPaths,
      error,
      note: query.note,
    };
  });
  return {
    queryCount: perQuery.length,
    passCount: perQuery.filter((row) => row.passed).length,
    failCount: perQuery.filter((row) => !row.passed).length,
    failures: perQuery.filter((row) => !row.passed),
    perQuery,
  };
}

function scoreUniversalMatrixDataset(dataset, resultsById, runMetadata = {}) {
  const fixtureKey = inferMatrixFixtureKey(dataset, runMetadata);
  const flatDataset = flattenUniversalMatrixForFixture(dataset, fixtureKey, {
    includeOptionalTargets: runMetadata.includeOptionalTargets,
  });
  const notApplicableTargets = dataset.queries
    .map((query) => {
      const target = universalTargetForFixture(query, fixtureKey);
      if (target?.status !== 'not-applicable') {
        return null;
      }
      return {
        id: query.id,
        query: query.query,
        fixtureKey,
        intent: query.intent,
        domain: query.domain,
        controlClass: query.controlClass,
        targetStatus: target.status,
        reason: target.reason || target.note || null,
      };
    })
    .filter(Boolean);
  const summary = scoreFlatDataset(flatDataset, resultsById, {
    ...runMetadata,
    matrixFixture: fixtureKey,
  });
  for (const row of summary.perQuery) {
    const source = flatDataset.queries.find((query) => query.id === row.id);
    row.fixtureKey = fixtureKey;
    row.intent = source?.intent;
    row.domain = source?.domain;
    row.controlClass = source?.controlClass;
    row.targetStatus = source?.targetStatus;
  }
  summary.matrix = {
    dataset: dataset.dataset,
    fixtureKey,
    fixtureLabel: dataset.fixtures?.[fixtureKey]?.label,
    positiveQueryCount: summary.metrics.queryCount,
    sourceQueryCount: dataset.queries.length,
    includeOptionalTargets: Boolean(runMetadata.includeOptionalTargets),
    notApplicableTargets,
  };
  summary.grouped = {
    fixture: groupPerQuery(summary.perQuery, 'fixtureKey'),
    domain: groupPerQuery(summary.perQuery, 'domain'),
    intent: groupPerQuery(summary.perQuery, 'intent'),
    controlClass: groupPerQuery(summary.perQuery, 'controlClass'),
  };
  summary.negativeControls = scoreNegativeControls(dataset, resultsById, fixtureKey, {
    includeOptionalTargets: runMetadata.includeOptionalTargets,
  });
  summary.dataset = dataset.dataset;
  summary.fixture = dataset.fixtures?.[fixtureKey]?.path || summary.fixture;
  return summary;
}

function score(dataset, resultsById, runMetadata = {}) {
  if (isUniversalMatrixDataset(dataset)) {
    return scoreUniversalMatrixDataset(dataset, resultsById, runMetadata);
  }
  return scoreFlatDataset(dataset, resultsById, runMetadata);
}

function validateFlatLabels(dataset, codebasePath) {
  const files = listFiles(codebasePath).map(normalizePath);
  const perQuery = dataset.queries.map((query) => {
    const prefixes = [
      ...(query.expectedPathPrefixes || []).map((prefix) => ({ prefix, labelKind: 'strict' })),
      ...(query.acceptablePathPrefixes || []).map((prefix) => ({ prefix, labelKind: 'acceptable' })),
    ].map(({ prefix, labelKind }) => {
      const normalizedPrefix = normalizePath(prefix);
      const matchingFiles = files.filter((file) => file.startsWith(normalizedPrefix));
      return {
        prefix,
        labelKind,
        reachable: matchingFiles.length > 0,
        matchingFileCount: matchingFiles.length,
        sampleMatches: matchingFiles.slice(0, 5),
      };
    });
    return {
      id: query.id,
      query: query.query,
      allReachable: prefixes.every((prefix) => prefix.reachable),
      prefixes,
    };
  });
  return {
    codebasePath,
    queryCount: dataset.queries.length,
    expectedPrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => prefix.labelKind === 'strict').length
    ), 0),
    acceptablePrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => prefix.labelKind === 'acceptable').length
    ), 0),
    resultRolePrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => prefix.labelKind === 'result-role').length
    ), 0),
    unreachablePrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => !prefix.reachable).length
    ), 0),
    ambiguousQueryIds: [],
    unreachable: perQuery
      .filter((row) => !row.allReachable)
      .map((row) => ({
        id: row.id,
        query: row.query,
        prefixes: row.prefixes.filter((prefix) => !prefix.reachable),
      })),
    perQuery,
  };
}

function validateUniversalMatrixLabels(dataset, codebasePath, options = {}) {
  const fixtureKey = inferMatrixFixtureKey(dataset, {
    ...options,
    codebasePath,
  });
  const files = listFiles(codebasePath).map(normalizePath);
  const perQuery = dataset.queries.map((query) => {
    const target = universalTargetForFixture(query, fixtureKey);
    if (!target) {
      return {
        id: query.id,
        query: query.query,
        kind: query.kind,
        fixtureKey,
        targetStatus: 'missing-target',
        allReachable: false,
        prefixes: [],
        issues: [`missing target for fixture ${fixtureKey}`],
      };
    }
    const issues = [];
    if (!UNIVERSAL_TARGET_STATUSES.has(target.status)) {
      issues.push(`invalid target status ${target.status}`);
    }
    const shouldValidatePrefixes = ['applicable', 'optional'].includes(target.status) && !isNegativeControlQuery(query);
    if (target.status === 'applicable' && !isNegativeControlQuery(query) && !target.expectedPathPrefixes?.length) {
      issues.push('applicable positive target must include expectedPathPrefixes');
    }
    const prefixes = shouldValidatePrefixes
      ? [
        ...(target.expectedPathPrefixes || []).map((prefix) => ({ prefix, labelKind: 'strict' })),
        ...(target.acceptablePathPrefixes || []).map((prefix) => ({ prefix, labelKind: 'acceptable' })),
        ...(target.requiredResultRoles || []).flatMap((role) => (
          (role.pathPrefixes || []).map((prefix) => ({
            prefix,
            labelKind: 'result-role',
            roleId: role.id,
            roleLabel: role.label,
            optionalRole: Boolean(role.optional),
          }))
        )),
      ].map((label) => {
        const normalizedPrefix = normalizePath(label.prefix);
        const matchingFiles = files.filter((file) => file.startsWith(normalizedPrefix));
        return {
          prefix: label.prefix,
          labelKind: label.labelKind,
          roleId: label.roleId,
          roleLabel: label.roleLabel,
          optionalRole: Boolean(label.optionalRole),
          reachable: matchingFiles.length > 0,
          matchingFileCount: matchingFiles.length,
          sampleMatches: matchingFiles.slice(0, 5),
        };
      })
      : [];
    return {
      id: query.id,
      query: query.query,
      kind: query.kind,
      intent: query.intent,
      domain: query.domain,
      controlClass: query.controlClass,
      fixtureKey,
      targetStatus: target.status,
      allReachable: prefixes.every((prefix) => prefix.reachable) && issues.length === 0,
      prefixes,
      issues,
      note: target.note,
      reason: target.reason,
    };
  });
  const unreachable = perQuery
    .filter((row) => row.prefixes.some((prefix) => !prefix.reachable) || row.issues.length > 0)
    .map((row) => ({
      id: row.id,
      query: row.query,
      targetStatus: row.targetStatus,
      issues: row.issues,
      prefixes: row.prefixes.filter((prefix) => !prefix.reachable),
    }));
  return {
    codebasePath,
    fixtureKey,
    queryCount: dataset.queries.length,
    applicableTargetCount: perQuery.filter((row) => row.targetStatus === 'applicable').length,
    optionalTargetCount: perQuery.filter((row) => row.targetStatus === 'optional').length,
    notApplicableTargetCount: perQuery.filter((row) => row.targetStatus === 'not-applicable').length,
    needsInspectionCount: perQuery.filter((row) => row.targetStatus === 'needs-inspection').length,
    missingTargetCount: perQuery.filter((row) => row.targetStatus === 'missing-target').length,
    expectedPrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => prefix.labelKind === 'strict').length
    ), 0),
    acceptablePrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => prefix.labelKind === 'acceptable').length
    ), 0),
    resultRolePrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => prefix.labelKind === 'result-role').length
    ), 0),
    unreachablePrefixCount: perQuery.reduce((sum, row) => (
      sum + row.prefixes.filter((prefix) => !prefix.reachable).length
    ), 0),
    issueCount: perQuery.reduce((sum, row) => sum + row.issues.length, 0),
    strictAcceptanceReady: unreachable.length === 0 && perQuery.every((row) => row.targetStatus !== 'needs-inspection'),
    ambiguousQueryIds: [],
    unresolved: perQuery
      .filter((row) => row.targetStatus === 'needs-inspection')
      .map((row) => ({ id: row.id, query: row.query, fixtureKey, note: row.note })),
    notApplicable: perQuery
      .filter((row) => row.targetStatus === 'not-applicable')
      .map((row) => ({
        id: row.id,
        query: row.query,
        fixtureKey,
        reason: row.reason || row.note || null,
      })),
    unreachable,
    perQuery,
  };
}

function validateLabels(dataset, codebasePath, options = {}) {
  if (isUniversalMatrixDataset(dataset)) {
    return validateUniversalMatrixLabels(dataset, codebasePath, options);
  }
  return validateFlatLabels(dataset, codebasePath);
}

function listFiles(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Fixture path not found: ${root}`);
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Fixture path is not a directory: ${root}`);
  }
  const results = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relativePath = path.join(prefix, entry.name);
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  };
  walk(root);
  return results;
}

function buildComparison(baseline, tuned) {
  const baselineById = new Map(baseline.perQuery.map((row) => [comparisonKey(row), row]));
  const tunedIds = new Set(tuned.perQuery.map((row) => comparisonKey(row)));
  const baselineOnlyIds = baseline.perQuery
    .map((row) => comparisonKey(row))
    .filter((key) => !tunedIds.has(key));
  const tunedOnlyIds = tuned.perQuery
    .map((row) => comparisonKey(row))
    .filter((key) => !baselineById.has(key));
  const perQuery = tuned.perQuery.map((row) => {
    const previous = baselineById.get(comparisonKey(row));
    if (!previous) {
      return {
        id: row.id,
        query: row.query,
        fixtureKey: row.fixtureKey,
        baselineRank: null,
        tunedRank: row.firstRelevantRank,
        status: 'not_comparable',
        baselineTopPaths: [],
        tunedTopPaths: row.topResultPaths,
      };
    }
    return {
      id: row.id,
      query: row.query,
      fixtureKey: row.fixtureKey,
      baselineRank: previous?.firstRelevantRank ?? null,
      tunedRank: row.firstRelevantRank,
      status: compareRanks(previous?.firstRelevantRank ?? null, row.firstRelevantRank),
      baselineTopPaths: previous?.topResultPaths || [],
      tunedTopPaths: row.topResultPaths,
    };
  });
  return {
    baseline: {
      dataset: baseline.dataset,
      version: baseline.version,
      hitAt10Count: baseline.metrics.hitAt10Count,
      hitAt10: baseline.metrics.hitAt10,
      run: baseline.run,
    },
    tuned: {
      dataset: tuned.dataset,
      version: tuned.version,
      hitAt10Count: tuned.metrics.hitAt10Count,
      hitAt10: tuned.metrics.hitAt10,
      run: tuned.run,
    },
    comparable: baselineOnlyIds.length === 0 && tunedOnlyIds.length === 0,
    baselineOnlyIds,
    tunedOnlyIds,
    improvements: perQuery.filter((row) => row.status === 'improved'),
    regressions: perQuery.filter((row) => row.status === 'regressed'),
    unchanged: perQuery.filter((row) => row.status === 'unchanged'),
    notComparable: perQuery.filter((row) => row.status === 'not_comparable'),
    perQuery,
  };
}

function findPrefixRank(paths, prefix) {
  const normalizedPrefix = normalizePath(prefix);
  const index = paths.findIndex((item) => normalizePath(item).startsWith(normalizedPrefix));
  return index >= 0 ? index + 1 : null;
}

function evaluateResidualAssertions(summary, assertions) {
  const perQueryById = new Map((summary.perQuery || []).map((row) => [row.id, row]));
  const residualById = new Map((summary.residualQueries || []).map((row) => [row.id, row]));
  const comparisonById = new Map((summary.comparison?.perQuery || []).map((row) => [row.id, row]));

  return assertions.map((assertion) => {
    const row = residualById.get(assertion.id) || perQueryById.get(assertion.id);
    const comparison = comparisonById.get(assertion.id);
    const topPaths = row?.topResultPaths || [];
    const failures = [];

    if (!row) {
      failures.push('missing residual query result');
    }
    if (assertion.mustHitAt10 && !row?.firstRelevantRank) {
      failures.push('expected hit within top 10');
    }
    if (assertion.noRegression) {
      if (!comparison) {
        failures.push('missing comparison for no-regression assertion');
      } else if (comparison.status === 'regressed') {
        failures.push(`expected no regression, got ${comparison.status}`);
      }
    }
    if (assertion.rankBefore) {
      const preferredRank = findPrefixRank(topPaths, assertion.rankBefore.preferredPrefix);
      const disfavoredRank = findPrefixRank(topPaths, assertion.rankBefore.disfavoredPrefix);
      if (preferredRank === null || disfavoredRank === null || preferredRank >= disfavoredRank) {
        failures.push(
          `expected ${assertion.rankBefore.preferredPrefix} before ${assertion.rankBefore.disfavoredPrefix}`,
        );
      }
    }

    return {
      id: assertion.id,
      passed: failures.length === 0,
      failures,
      firstRelevantRank: row?.firstRelevantRank ?? null,
      comparisonStatus: comparison?.status || null,
      topResultPaths: topPaths,
      assertion,
    };
  });
}

function enforceAcceptance(summary, options = {}) {
  const acceptanceThreshold = Number(options.acceptanceThreshold ?? summary.run?.acceptanceThreshold);
  const strictHitAt1Threshold = Number(options.strictHitAt1Threshold ?? summary.run?.strictHitAt1Threshold);
  const strictHitAt5Threshold = Number(options.strictHitAt5Threshold ?? summary.run?.strictHitAt5Threshold);
  const strictPositiveHitAt10Threshold = Number(options.strictPositiveHitAt10Threshold ?? summary.run?.strictPositiveHitAt10Threshold);
  const negativeControlPassThreshold = Number(options.negativeControlPassThreshold ?? summary.run?.negativeControlPassThreshold);
  const rawSummary = summary.run?.rawSummary || {};
  const toolErrors = Number(rawSummary.toolErrors || 0);
  const missingColbertErrors = Number(rawSummary.missingColbertErrors || 0);
  const baselineHitAt10Count = Number(summary.comparison?.baseline?.hitAt10Count);
  const baselineMode = options.baselineMode || 'strict-improvement';
  const labelValidation = options.labelValidation || summary.run?.labelValidation;

  if (summary.dataset === UNIVERSAL_MATRIX_DATASET &&
    labelValidation &&
    labelValidation.strictAcceptanceReady === false &&
    !options.allowIncompleteMatrixLabels) {
    throw new Error(
      `Universal matrix labels are not strict-acceptance ready for ${labelValidation.fixtureKey || 'unknown fixture'}: ` +
      `${labelValidation.needsInspectionCount || 0} needs-inspection target(s), ` +
      `${labelValidation.unreachablePrefixCount || 0} unreachable prefix(es), ` +
      `${labelValidation.issueCount || 0} validation issue(s).`,
    );
  }
  if (Number.isFinite(acceptanceThreshold) &&
    !options.allowBelowAcceptanceThreshold &&
    summary.metrics.hitAt10Count < acceptanceThreshold) {
    throw new Error(
      `Hit@10 count ${summary.metrics.hitAt10Count} is below acceptance threshold ${acceptanceThreshold}.`,
    );
  }
  if (Number.isFinite(strictHitAt1Threshold) &&
    !options.allowBelowAcceptanceThreshold &&
    Number(summary.metrics.strict?.hitAt1Count ?? summary.metrics.hitAt1Count) < strictHitAt1Threshold) {
    throw new Error(
      `Strict Hit@1 count ${summary.metrics.strict?.hitAt1Count ?? summary.metrics.hitAt1Count} is below acceptance threshold ${strictHitAt1Threshold}.`,
    );
  }
  if (Number.isFinite(strictHitAt5Threshold) &&
    !options.allowBelowAcceptanceThreshold &&
    Number(summary.metrics.strict?.hitAt5Count ?? summary.metrics.hitAt5Count) < strictHitAt5Threshold) {
    throw new Error(
      `Strict Hit@5 count ${summary.metrics.strict?.hitAt5Count ?? summary.metrics.hitAt5Count} is below acceptance threshold ${strictHitAt5Threshold}.`,
    );
  }
  if (Number.isFinite(strictPositiveHitAt10Threshold) &&
    !options.allowBelowAcceptanceThreshold &&
    Number(summary.metrics.strict?.hitAt10Count ?? summary.metrics.hitAt10Count) < strictPositiveHitAt10Threshold) {
    throw new Error(
      `Strict positive Hit@10 count ${summary.metrics.strict?.hitAt10Count ?? summary.metrics.hitAt10Count} is below acceptance threshold ${strictPositiveHitAt10Threshold}.`,
    );
  }
  if (Number.isFinite(negativeControlPassThreshold) &&
    !options.allowNegativeControlFailures &&
    Number(summary.negativeControls?.passCount ?? 0) < negativeControlPassThreshold) {
    throw new Error(
      `Negative-control pass count ${summary.negativeControls?.passCount ?? 0} is below acceptance threshold ${negativeControlPassThreshold}.`,
    );
  }
  if (!options.allowToolErrors && toolErrors > 0) {
    throw new Error(`Expected 0 MCP tool errors, got ${toolErrors}.`);
  }
  if (!options.allowMissingColbertErrors && missingColbertErrors > 0) {
    throw new Error(`Expected 0 missing ColBERT vector errors, got ${missingColbertErrors}.`);
  }
  if (Number.isFinite(baselineHitAt10Count) && !options.allowNoBaselineImprovement) {
    if (baselineMode === 'non-regression') {
      if (summary.metrics.hitAt10Count < baselineHitAt10Count) {
        throw new Error(
          `Hit@10 count ${summary.metrics.hitAt10Count} is below baseline ${baselineHitAt10Count}.`,
        );
      }
      const regressions = summary.comparison?.regressions || [];
      if (!options.allowQueryRegressions && regressions.length > 0) {
        const preview = regressions
          .slice(0, 5)
          .map((row) => row.fixtureKey ? `${row.fixtureKey}::${row.id}` : row.id)
          .join(', ');
        throw new Error(`Query-level baseline regressions are not allowed: ${preview}.`);
      }
    } else if (summary.metrics.hitAt10Count <= baselineHitAt10Count) {
      throw new Error(
        `Hit@10 count ${summary.metrics.hitAt10Count} does not improve over baseline ${baselineHitAt10Count}.`,
      );
    }
  }
  const requiredResidualAssertions = options.requiredResidualAssertions || summary.run?.requiredResidualAssertions || [];
  const residualAssertions = summary.residualAssertions || evaluateResidualAssertions(summary, requiredResidualAssertions);
  for (const assertion of residualAssertions) {
    if (!assertion.passed) {
      throw new Error(`Residual assertion ${assertion.id} failed: ${assertion.failures.join('; ')}`);
    }
  }
}

function buildThresholdRecommendation(summary, labelValidation) {
  if (!labelValidation) {
    return undefined;
  }
  const queryCount = Number(summary?.metrics?.queryCount);
  const hitAt10Count = Number(summary?.metrics?.hitAt10Count);
  const denominator = Number.isFinite(queryCount) ? queryCount : 'current';
  const numerator = Number.isFinite(hitAt10Count) ? hitAt10Count : 'current';
  if (labelValidation.strictAcceptanceReady !== false && labelValidation.unreachablePrefixCount === 0) {
    return `Hit@10 ${numerator}/${denominator} is valid for the current reachable label set.`;
  }
  return `Do not use Hit@10 ${numerator}/${denominator} as strict acceptance until unresolved or unreachable labels are corrected or excluded.`;
}

function compareRanks(before, after) {
  if (before === after) {
    return 'unchanged';
  }
  if (before === null && after !== null) {
    return 'improved';
  }
  if (before !== null && after === null) {
    return 'regressed';
  }
  return after < before ? 'improved' : 'regressed';
}

function writeMarkdownReport(filePath, summary, labelValidation, comparison) {
  const lines = [];
  const comparisonById = new Map((comparison?.perQuery || []).map((row) => [row.id, row]));
  lines.push(`# Demo 1C relevance report`);
  lines.push('');
  lines.push(`- Dataset: \`${summary.dataset}\` ${summary.version || ''}`.trim());
  lines.push(`- Backend: ${summary.run.backendLabel || 'unspecified'}`);
  lines.push(`- Retrieval mode: ${summary.run.retrievalMode || 'unspecified'}`);
  lines.push(`- Ranking profile: ${summary.run.rankingProfile || 'unspecified'}`);
  lines.push(`- Codebase: \`${summary.run.codebasePath || summary.fixture || 'unspecified'}\``);
  if (summary.run.indexStatus) {
    lines.push(`- Index status: ${summary.run.indexStatus.status || summary.run.indexStatus.state || 'recorded'}`);
  }
  if (summary.run.rlmBslEnrichment) {
    const enrichment = summary.run.rlmBslEnrichment;
    lines.push(`- RLM BSL enrichment: mode=${enrichment.mode || 'unknown'}, provider=${enrichment.provider || 'unknown'}, status=${enrichment.status || 'unknown'}, configured=${enrichment.configured === false ? 'false' : 'true'}`);
    if (enrichment.sourceFingerprint) {
      lines.push(`- RLM BSL source fingerprint: ${enrichment.sourceFingerprint}`);
    }
  }
  if (summary.run.rawSummary) {
    lines.push(`- MCP tool errors: ${summary.run.rawSummary.toolErrors ?? 0}`);
    lines.push(`- Missing ColBERT vector errors: ${summary.run.rawSummary.missingColbertErrors ?? 0}`);
  }
  lines.push(`- Query count: ${summary.metrics.queryCount}`);
  lines.push(`- Hit@10: ${summary.metrics.hitAt10Count}/${summary.metrics.queryCount} (${(summary.metrics.hitAt10 * 100).toFixed(1)}%)`);
  if (summary.metrics.strict) {
    lines.push(`- Strict Hit@1: ${summary.metrics.strict.hitAt1Count}/${summary.metrics.queryCount}`);
    lines.push(`- Strict Hit@5: ${summary.metrics.strict.hitAt5Count}/${summary.metrics.queryCount}`);
    lines.push(`- Strict MRR@10: ${summary.metrics.strict.mrrAt10}`);
  }
  if (summary.metrics.acceptable) {
    lines.push(`- Acceptable Hit@1: ${summary.metrics.acceptable.hitAt1Count}/${summary.metrics.queryCount}`);
    lines.push(`- Acceptable Hit@5: ${summary.metrics.acceptable.hitAt5Count}/${summary.metrics.queryCount}`);
    lines.push(`- Acceptable MRR@10: ${summary.metrics.acceptable.mrrAt10}`);
  }
  lines.push(`- MRR@10: ${summary.metrics.mrrAt10}`);
  lines.push(`- Precision@10: ${summary.metrics.precisionAt10}`);
  lines.push(`- Failures: ${summary.metrics.failures}`);
  if (summary.run.acceptanceThreshold) {
    lines.push(`- Acceptance threshold: ${summary.run.acceptanceThreshold}/30`);
  }
  if (labelValidation) {
    lines.push(`- Label validation: ${labelValidation.unreachablePrefixCount === 0 ? 'all expected prefixes reachable' : `${labelValidation.unreachablePrefixCount} unreachable prefixes`}`);
    if (labelValidation.needsInspectionCount !== undefined) {
      lines.push(`- Needs inspection: ${labelValidation.needsInspectionCount}`);
    }
  }
  if (summary.matrix) {
    lines.push(`- Matrix fixture: ${summary.matrix.fixtureKey}`);
    if (summary.matrix.notApplicableTargets?.length) {
      lines.push(`- Not-applicable targets: ${summary.matrix.notApplicableTargets.length}`);
    }
  }
  if (summary.negativeControls) {
    lines.push(`- Negative controls: ${summary.negativeControls.passCount}/${summary.negativeControls.queryCount} passed`);
  }
  if (summary.bundleRoles?.queryCount) {
    lines.push(`- Bundle roles: ${summary.bundleRoles.completeCount}/${summary.bundleRoles.queryCount} complete`);
    if (summary.bundleRoles.missingRequiredRoleCount > 0) {
      lines.push(`- Missing required bundle roles: ${summary.bundleRoles.missingRequiredRoleCount}`);
    }
  }
  if (comparison) {
    lines.push(`- Compared baseline Hit@10: ${comparison.baseline.hitAt10Count}/${summary.metrics.queryCount}`);
    lines.push(`- Comparison comparable: ${comparison.comparable ? 'yes' : 'no'}`);
    if (comparison.comparable) {
      lines.push(`- Improvements: ${comparison.improvements.length}`);
      lines.push(`- Regressions: ${comparison.regressions.length}`);
    } else {
      lines.push(`- Non-comparable query IDs: baseline-only ${comparison.baselineOnlyIds.length}, tuned-only ${comparison.tunedOnlyIds.length}`);
    }
  }
  lines.push('');
  lines.push('| id | hit@10 | first strict rank | first acceptable rank | latency ms | top paths |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
  for (const row of summary.perQuery) {
    const firstStrictRank = row.firstStrictRank ?? row.firstRelevantRank ?? null;
    const firstAcceptableRank = row.firstAcceptableRank ?? firstStrictRank;
    lines.push(`| ${row.id} | ${firstStrictRank ? 'yes' : 'no'} | ${firstStrictRank ?? ''} | ${firstAcceptableRank ?? ''} | ${row.latencyMs ?? ''} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
  }
  if (summary.grouped) {
    lines.push('');
    lines.push('## Grouped summary');
    for (const [groupName, groups] of Object.entries(summary.grouped)) {
      lines.push('');
      lines.push(`### ${groupName}`);
      lines.push('| group | queries | strict hit@10 | acceptable hit@10 | failures |');
      lines.push('| --- | ---: | ---: | ---: | ---: |');
      for (const [key, value] of Object.entries(groups)) {
        lines.push(`| ${key} | ${value.queryCount} | ${value.strict.hitAt10Count} | ${value.acceptable.hitAt10Count} | ${value.failures} |`);
      }
    }
  }
  if (summary.bundleRoles?.queryCount) {
    lines.push('');
    lines.push('## Bundle role coverage');
    lines.push('| id | complete | found required roles | missing required roles |');
    lines.push('| --- | --- | ---: | --- |');
    for (const row of summary.perQuery.filter((item) => item.roleCoverage?.roleCount > 0)) {
      lines.push(`| ${row.id} | ${row.roleCoverage.complete ? 'yes' : 'no'} | ${row.roleCoverage.foundRequiredRoleCount}/${row.roleCoverage.requiredRoleCount} | ${row.missingRequiredRoles.map((role) => role.label || role.id).join('<br>')} |`);
    }
  }
  if (summary.negativeControls?.perQuery?.length) {
    lines.push('');
    lines.push('## Negative controls');
    lines.push('| id | passed | violations | top paths |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of summary.negativeControls.perQuery) {
      lines.push(`| ${row.id} | ${row.passed ? 'yes' : 'no'} | ${row.violations.join('<br>')} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
    }
  }
  if (summary.matrix?.notApplicableTargets?.length) {
    lines.push('');
    lines.push('## Not-applicable targets');
    lines.push('| id | reason |');
    lines.push('| --- | --- |');
    for (const row of summary.matrix.notApplicableTargets) {
      lines.push(`| ${row.id} | ${row.reason || ''} |`);
    }
  }
  const strictMisses = summary.perQuery.filter((row) => !(row.firstStrictRank ?? row.firstRelevantRank));
  if (strictMisses.length > 0) {
    lines.push('');
    lines.push('## Strict misses');
    lines.push('| id | failure class | first acceptable rank | top paths |');
    lines.push('| --- | --- | ---: | --- |');
    for (const row of strictMisses) {
      lines.push(`| ${row.id} | ${row.failureClass || ''} | ${row.firstAcceptableRank ?? ''} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
    }
  }
  const acceptableOnlyHits = summary.perQuery.filter((row) => row.acceptableOnlyHit);
  if (acceptableOnlyHits.length > 0) {
    lines.push('');
    lines.push('## Acceptable-only hits');
    lines.push('| id | failure class | first acceptable rank | top paths |');
    lines.push('| --- | --- | ---: | --- |');
    for (const row of acceptableOnlyHits) {
      lines.push(`| ${row.id} | ${row.failureClass || ''} | ${row.firstAcceptableRank ?? ''} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
    }
  }
  if (summary.residualQueries?.length) {
    lines.push('');
    lines.push('## Residual queries');
    lines.push('| id | status | first relevant rank | top paths |');
    lines.push('| --- | --- | ---: | --- |');
    for (const row of summary.residualQueries) {
      const comparisonRow = comparisonById.get(row.id);
      const status = comparisonRow?.status || (row.firstRelevantRank ? 'hit' : 'missing');
      lines.push(`| ${row.id} | ${status} | ${row.firstRelevantRank ?? ''} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
    }
  }
  if (summary.residualAssertions?.length) {
    lines.push('');
    lines.push('## Residual assertions');
    lines.push('| id | passed | first relevant rank | comparison status | failures | top paths |');
    lines.push('| --- | --- | ---: | --- | --- | --- |');
    for (const row of summary.residualAssertions) {
      lines.push(`| ${row.id} | ${row.passed ? 'yes' : 'no'} | ${row.firstRelevantRank ?? ''} | ${row.comparisonStatus || ''} | ${row.failures.join('<br>')} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
    }
  }
  if (comparison?.regressions.length) {
    lines.push('');
    lines.push('## Regressions');
    for (const row of comparison.regressions) {
      lines.push(`- ${row.id}: baseline rank ${row.baselineRank ?? 'miss'}, tuned rank ${row.tunedRank ?? 'miss'}`);
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const datasetPath = args.dataset || path.join(__dirname, '..', 'evaluation', 'retrieval', 'demo-1c-relevance.json');
  if (!args.results) {
    console.error('Usage: run-demo-1c-relevance-eval.js --results <results.json> [--dataset <dataset.json>] [--out <summary.json>]');
    process.exit(2);
  }
  const rawResults = readJson(args.results);
  const dataset = args.useReportLabels ? datasetFromReport(rawResults) : readJson(datasetPath);
  const resultsById = normalizeResults(rawResults.results || rawResults, dataset, args.backend);
  const requiredResidualAssertions = parseJsonOption(args.requiredResidualAssertionsJson, 'required-residual-assertions-json');
  const labelValidation = args.validateLabelsAgainst
    ? validateLabels(dataset, args.validateLabelsAgainst, { matrixFixture: args.matrixFixture })
    : undefined;
  const runMetadata = {
    backendLabel: args.backendLabel || args.backend || rawResults.backend,
    retrievalMode: args.retrievalMode || rawResults.retrievalMode,
    rankingProfile: args.rankingProfile || rawResults.rankingProfile,
    codebasePath: args.codebasePath || rawResults.codebasePath || dataset.fixture,
    datasetPath,
    resultsPath: args.results,
    labelSource: args.useReportLabels ? 'live-report expectedPrefixes' : datasetPath,
    acceptanceThreshold: args.acceptanceThreshold ? Number(args.acceptanceThreshold) : undefined,
    strictHitAt1Threshold: args.strictHitAt1Threshold ? Number(args.strictHitAt1Threshold) : undefined,
    strictHitAt5Threshold: args.strictHitAt5Threshold ? Number(args.strictHitAt5Threshold) : undefined,
    strictPositiveHitAt10Threshold: args.strictPositiveHitAt10Threshold ? Number(args.strictPositiveHitAt10Threshold) : undefined,
    negativeControlPassThreshold: args.negativeControlPassThreshold ? Number(args.negativeControlPassThreshold) : undefined,
    startedAt: rawResults.startedAt,
    finishedAt: rawResults.finishedAt,
    rawSummary: rawResults.summary,
    indexStatus: rawResults.indexStatus,
    matrixFixture: args.matrixFixture,
    includeOptionalTargets: Boolean(args.includeOptionalTargets),
    residualQueryIds: parseCsvList(args.residualQueryIds),
    requiredResidualAssertions,
    baselineMode: args.baselineMode || undefined,
    labelValidation: labelValidation ? {
      codebasePath: labelValidation.codebasePath,
      fixtureKey: labelValidation.fixtureKey,
      unreachablePrefixCount: labelValidation.unreachablePrefixCount,
      needsInspectionCount: labelValidation.needsInspectionCount,
      notApplicableTargetCount: labelValidation.notApplicableTargetCount,
      issueCount: labelValidation.issueCount,
      strictAcceptanceReady: labelValidation.strictAcceptanceReady,
      ambiguousQueryIds: labelValidation.ambiguousQueryIds,
      notApplicable: labelValidation.notApplicable,
    } : undefined,
  };
  const summary = score(dataset, resultsById, runMetadata);
  if (summary.run?.labelValidation) {
    summary.run.labelValidation.thresholdRecommendation = buildThresholdRecommendation(summary, labelValidation);
  }
  const comparison = args.baseline
    ? buildComparison(readJson(args.baseline), summary)
    : undefined;
  if (comparison) {
    summary.comparison = comparison;
  }
  if (Array.isArray(requiredResidualAssertions) && requiredResidualAssertions.length > 0) {
    summary.residualAssertions = evaluateResidualAssertions(summary, requiredResidualAssertions);
  }
  const output = JSON.stringify(summary, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
  if (args.labelValidationOut && labelValidation) {
    fs.mkdirSync(path.dirname(args.labelValidationOut), { recursive: true });
    fs.writeFileSync(args.labelValidationOut, `${JSON.stringify(labelValidation, null, 2)}\n`);
  }
  if (args.compareOut && comparison) {
    fs.mkdirSync(path.dirname(args.compareOut), { recursive: true });
    fs.writeFileSync(args.compareOut, `${JSON.stringify(comparison, null, 2)}\n`);
  }
  if (args.markdownOut) {
    writeMarkdownReport(args.markdownOut, summary, labelValidation, comparison);
  }
  if (args.expectHitAt10Count !== undefined) {
    const expected = Number(args.expectHitAt10Count);
    if (summary.metrics.hitAt10Count !== expected) {
      console.error(`Expected Hit@10 count ${expected}, got ${summary.metrics.hitAt10Count}.`);
      process.exit(1);
    }
  }
  try {
    enforceAcceptance(summary, {
      acceptanceThreshold: args.acceptanceThreshold,
      strictHitAt1Threshold: args.strictHitAt1Threshold,
      strictHitAt5Threshold: args.strictHitAt5Threshold,
      allowBelowAcceptanceThreshold: Boolean(args.allowBelowAcceptanceThreshold),
      allowNegativeControlFailures: Boolean(args.allowNegativeControlFailures),
      allowToolErrors: Boolean(args.allowToolErrors),
      allowMissingColbertErrors: Boolean(args.allowMissingColbertErrors),
      allowNoBaselineImprovement: Boolean(args.allowNoBaselineImprovement),
      allowQueryRegressions: Boolean(args.allowQueryRegressions),
      allowIncompleteMatrixLabels: Boolean(args.allowIncompleteMatrixLabels),
      baselineMode: args.baselineMode,
      labelValidation,
      requiredResidualAssertions,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  enforceAcceptance,
  parseCsvList,
  parseJsonOption,
  isUniversalMatrixDataset,
  inferMatrixFixtureKey,
  flattenUniversalMatrixForFixture,
  collectionDatasetForFixture,
  normalizeResults,
  score,
  validateLabels,
  buildComparison,
  writeMarkdownReport,
  evaluateResidualAssertions,
  buildThresholdRecommendation,
};
