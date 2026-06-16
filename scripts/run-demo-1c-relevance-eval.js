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

function precisionAt(results, expectedPathPrefixes, k) {
  const capped = results.slice(0, k);
  if (capped.length === 0) {
    return 0;
  }
  return capped.filter((result) => isRelevant(result, expectedPathPrefixes)).length / k;
}

function score(dataset, resultsById, runMetadata = {}) {
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
  };
  let latencyTotal = 0;
  let latencyCount = 0;

  for (const query of dataset.queries) {
    const entry = resultsById[query.id] || [];
    const results = Array.isArray(entry) ? entry : entry.results || [];
    const latencyMs = Array.isArray(entry) ? undefined : entry.latencyMs;
    const error = Array.isArray(entry) ? null : entry.error || null;
    const rank = firstRelevantRank(results, query.expectedPathPrefixes, 10);
    const relevantAt10 = results
      .slice(0, 10)
      .filter((result) => isRelevant(result, query.expectedPathPrefixes)).length;
    const row = {
      id: query.id,
      query: query.query,
      kind: query.kind,
      firstRelevantRank: rank,
      relevantHitsAt10: relevantAt10,
      topResultPaths: results.slice(0, 10).map((result) => result.relativePath || result.path || ''),
      topResults: results.slice(0, 10),
      missing: rank === null,
      latencyMs,
      error,
    };
    perQuery.push(row);

    if (rank === null || error) {
      metrics.failures += 1;
    }
    metrics.hitAt1Count += rank !== null && rank <= 1 ? 1 : 0;
    metrics.hitAt3Count += rank !== null && rank <= 3 ? 1 : 0;
    metrics.hitAt5Count += rank !== null && rank <= 5 ? 1 : 0;
    metrics.hitAt10Count += rank !== null && rank <= 10 ? 1 : 0;
    metrics.hitAt1 += rank !== null && rank <= 1 ? 1 : 0;
    metrics.hitAt3 += rank !== null && rank <= 3 ? 1 : 0;
    metrics.hitAt5 += rank !== null && rank <= 5 ? 1 : 0;
    metrics.hitAt10 += rank !== null && rank <= 10 ? 1 : 0;
    metrics.mrrAt10 += rank !== null ? 1 / rank : 0;
    metrics.precisionAt3 += precisionAt(results, query.expectedPathPrefixes, 3);
    metrics.precisionAt5 += precisionAt(results, query.expectedPathPrefixes, 5);
    metrics.precisionAt10 += precisionAt(results, query.expectedPathPrefixes, 10);
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
    ...(residualQueryIds.size > 0
      ? { residualQueries: perQuery.filter((row) => residualQueryIds.has(row.id)) }
      : {}),
  };
  if (Array.isArray(runMetadata.requiredResidualAssertions) && runMetadata.requiredResidualAssertions.length > 0) {
    summary.residualAssertions = evaluateResidualAssertions(summary, runMetadata.requiredResidualAssertions);
  }
  return summary;
}

function validateLabels(dataset, codebasePath) {
  const files = listFiles(codebasePath).map(normalizePath);
  const perQuery = dataset.queries.map((query) => {
    const prefixes = query.expectedPathPrefixes.map((prefix) => {
      const normalizedPrefix = normalizePath(prefix);
      const matchingFiles = files.filter((file) => file.startsWith(normalizedPrefix));
      return {
        prefix,
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
    expectedPrefixCount: perQuery.reduce((sum, row) => sum + row.prefixes.length, 0),
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

function listFiles(root) {
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
  const baselineById = new Map(baseline.perQuery.map((row) => [row.id, row]));
  const tunedIds = new Set(tuned.perQuery.map((row) => row.id));
  const baselineOnlyIds = baseline.perQuery
    .map((row) => row.id)
    .filter((id) => !tunedIds.has(id));
  const tunedOnlyIds = tuned.perQuery
    .map((row) => row.id)
    .filter((id) => !baselineById.has(id));
  const perQuery = tuned.perQuery.map((row) => {
    const previous = baselineById.get(row.id);
    if (!previous) {
      return {
        id: row.id,
        query: row.query,
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
  const rawSummary = summary.run?.rawSummary || {};
  const toolErrors = Number(rawSummary.toolErrors || 0);
  const missingColbertErrors = Number(rawSummary.missingColbertErrors || 0);
  const baselineHitAt10Count = Number(summary.comparison?.baseline?.hitAt10Count);
  const baselineMode = options.baselineMode || 'strict-improvement';

  if (Number.isFinite(acceptanceThreshold) &&
    !options.allowBelowAcceptanceThreshold &&
    summary.metrics.hitAt10Count < acceptanceThreshold) {
    throw new Error(
      `Hit@10 count ${summary.metrics.hitAt10Count} is below acceptance threshold ${acceptanceThreshold}.`,
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
  lines.push(`- Ranking profile: ${summary.run.rankingProfile || 'unspecified'}`);
  lines.push(`- Codebase: \`${summary.run.codebasePath || summary.fixture || 'unspecified'}\``);
  lines.push(`- Query count: ${summary.metrics.queryCount}`);
  lines.push(`- Hit@10: ${summary.metrics.hitAt10Count}/${summary.metrics.queryCount} (${(summary.metrics.hitAt10 * 100).toFixed(1)}%)`);
  lines.push(`- MRR@10: ${summary.metrics.mrrAt10}`);
  lines.push(`- Precision@10: ${summary.metrics.precisionAt10}`);
  lines.push(`- Failures: ${summary.metrics.failures}`);
  if (summary.run.acceptanceThreshold) {
    lines.push(`- Acceptance threshold: ${summary.run.acceptanceThreshold}/30`);
  }
  if (labelValidation) {
    lines.push(`- Label validation: ${labelValidation.unreachablePrefixCount === 0 ? 'all expected prefixes reachable' : `${labelValidation.unreachablePrefixCount} unreachable prefixes`}`);
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
  lines.push('| id | hit@10 | first relevant rank | latency ms | top paths |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const row of summary.perQuery) {
    lines.push(`| ${row.id} | ${row.firstRelevantRank ? 'yes' : 'no'} | ${row.firstRelevantRank ?? ''} | ${row.latencyMs ?? ''} | ${row.topResultPaths.slice(0, 5).map((item, index) => `#${index + 1} ${item}`).join('<br>')} |`);
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
    ? validateLabels(dataset, args.validateLabelsAgainst)
    : undefined;
  const summary = score(dataset, resultsById, {
    backendLabel: args.backendLabel || args.backend || rawResults.backend,
    rankingProfile: args.rankingProfile || rawResults.rankingProfile,
    codebasePath: args.codebasePath || rawResults.codebasePath || dataset.fixture,
    datasetPath,
    resultsPath: args.results,
    labelSource: args.useReportLabels ? 'live-report expectedPrefixes' : datasetPath,
    acceptanceThreshold: args.acceptanceThreshold ? Number(args.acceptanceThreshold) : undefined,
    startedAt: rawResults.startedAt,
    finishedAt: rawResults.finishedAt,
    rawSummary: rawResults.summary,
    residualQueryIds: parseCsvList(args.residualQueryIds),
    requiredResidualAssertions,
    baselineMode: args.baselineMode || undefined,
    labelValidation: labelValidation ? {
      codebasePath: labelValidation.codebasePath,
      unreachablePrefixCount: labelValidation.unreachablePrefixCount,
      ambiguousQueryIds: labelValidation.ambiguousQueryIds,
      thresholdRecommendation: labelValidation.unreachablePrefixCount === 0
        ? 'Hit@10 24/30 is valid for the current reachable label set.'
        : 'Do not use Hit@10 24/30 until unreachable labels are corrected or excluded.',
    } : undefined,
  });
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
      allowBelowAcceptanceThreshold: Boolean(args.allowBelowAcceptanceThreshold),
      allowToolErrors: Boolean(args.allowToolErrors),
      allowMissingColbertErrors: Boolean(args.allowMissingColbertErrors),
      allowNoBaselineImprovement: Boolean(args.allowNoBaselineImprovement),
      baselineMode: args.baselineMode,
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
  normalizeResults,
  score,
  validateLabels,
  buildComparison,
  writeMarkdownReport,
  evaluateResidualAssertions,
};
