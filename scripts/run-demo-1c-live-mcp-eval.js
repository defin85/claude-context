#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  enforceAcceptance,
  parseCsvList,
  parseJsonOption,
  isUniversalMatrixDataset,
  inferMatrixFixtureKey,
  collectionDatasetForFixture,
  normalizeResults,
  score,
  validateLabels,
  buildComparison,
  writeMarkdownReport,
  evaluateResidualAssertions,
  buildThresholdRecommendation,
} = require('./run-demo-1c-relevance-eval.js');

const repoRoot = path.resolve(__dirname, '..');
const defaultDatasetPath = path.join(repoRoot, 'evaluation', 'retrieval', 'demo-1c-relevance.json');
const defaultCodebasePath = path.join(repoRoot, 'examples', 'demo-1c');
const defaultArtifactDir = path.join(repoRoot, '.artifacts', 'hybrid-code-symbol-retrieval');
const rankingProfiles = new Set(['auto', 'generic', 'one-c']);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
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
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readClientConfig(configPath) {
  const resolved = configPath || path.join(os.homedir(), '.context', 'mcp', 'daemon', 'client-config.json');
  return readJson(resolved);
}

function parseRankingProfile(value) {
  const rankingProfile = value || 'one-c';
  if (!rankingProfiles.has(rankingProfile)) {
    throw new Error(`Invalid --ranking-profile ${JSON.stringify(rankingProfile)}. Expected one of: ${[...rankingProfiles].join(', ')}.`);
  }
  return rankingProfile;
}

async function callTool(clientConfig, name, args) {
  const endpointUrl = clientConfig.endpointUrl || clientConfig.url;
  const token = clientConfig.bearerToken || clientConfig.token;
  if (!endpointUrl || !token) {
    throw new Error('Daemon client config is missing endpointUrl/url or bearerToken/token.');
  }
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }),
  });
  const body = await response.text();
  const dataLine = body.split('\n').find((line) => line.startsWith('data: '));
  const payload = JSON.parse(dataLine ? dataLine.slice(6) : body);
  if (payload.error) {
    throw new Error(JSON.stringify(payload.error));
  }
  return payload.result;
}

function textFromResult(result) {
  return (result.content || [])
    .map((item) => item.text || '')
    .join('\n');
}

async function ensureIndexed(clientConfig, options) {
  if (options.indexFirst) {
    return callTool(clientConfig, 'index_codebase', {
      path: options.codebasePath,
      force: Boolean(options.forceIndex),
      oneCIndexScopeProfile: options.oneCIndexScopeProfile,
    });
  }
  return callTool(clientConfig, 'get_indexing_status', {
    path: options.codebasePath,
  });
}

function summarizeTopResults(results) {
  return (results || []).slice(0, 10).map((result, index) => ({
    rank: index + 1,
    path: result.relativePath,
    relativePath: result.relativePath,
    lines: [result.startLine, result.endLine],
    startLine: result.startLine,
    endLine: result.endLine,
    score: result.score,
    metadata: result.metadata,
  }));
}

function summarizeRlmBslEnrichment(indexStatus) {
  const enrichment = indexStatus?.structuredContent?.rlmBslEnrichment;
  if (!enrichment || typeof enrichment !== 'object') {
    return undefined;
  }
  const diagnostics = enrichment.diagnostics && typeof enrichment.diagnostics === 'object'
    ? enrichment.diagnostics
    : {};
  return {
    mode: enrichment.mode,
    configured: enrichment.configured,
    commandConfigured: enrichment.commandConfigured,
    provider: enrichment.provider || diagnostics.provider || diagnostics.enrichmentProvider || 'rlm-tools-bsl',
    status: enrichment.status || diagnostics.status || diagnostics.enrichmentStatus,
    sourceFingerprint: enrichment.sourceFingerprint || diagnostics.sourceFingerprint || diagnostics.enrichmentSourceFingerprint,
  };
}

async function collectResults(clientConfig, dataset, options) {
  const results = [];
  let toolErrors = 0;
  let missingColbertErrors = 0;
  for (const query of dataset.queries) {
    const started = Date.now();
    let toolResult;
    let error = null;
    try {
      toolResult = await callTool(clientConfig, 'search_code', {
        path: options.codebasePath,
        query: query.query,
        limit: options.limit,
        rankingProfile: options.rankingProfile,
      });
    } catch (toolError) {
      error = toolError instanceof Error ? toolError.message : String(toolError);
    }
    const elapsedMs = Date.now() - started;
    const text = toolResult ? textFromResult(toolResult) : '';
    if (!error && toolResult?.isError) {
      error = text || 'MCP tool returned isError=true.';
    }
    const structured = toolResult?.structuredContent || {};
    const top10 = summarizeTopResults(structured.results || []);
    if (error) {
      toolErrors += 1;
    }
    if (/missing colbert|colbert.*missing/i.test(`${error || ''}\n${text}`)) {
      missingColbertErrors += 1;
    }
    results.push({
      id: query.id,
      query: query.query,
      kind: query.kind,
      expectedPrefixes: query.expectedPathPrefixes,
      acceptablePrefixes: query.acceptablePathPrefixes || [],
      failureClass: query.failureClass,
      note: query.note,
      rankingProfile: structured.rankingProfile || options.rankingProfile,
      elapsedMs,
      error,
      resultCount: top10.length,
      top10,
    });
    console.error(`[live-eval] ${query.id} ${error ? 'error' : 'ok'} ${elapsedMs}ms ${top10.length} result(s)`);
  }
  return {
    results,
    errors: {
      toolErrors,
      missingColbertErrors,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const datasetPath = args.dataset || defaultDatasetPath;
  const dataset = readJson(datasetPath);
  const codebasePath = path.resolve(args.codebasePath || defaultCodebasePath);
  const matrixFixture = isUniversalMatrixDataset(dataset)
    ? inferMatrixFixtureKey(dataset, { matrixFixture: args.matrixFixture, codebasePath })
    : undefined;
  const collectionDataset = isUniversalMatrixDataset(dataset)
    ? collectionDatasetForFixture(dataset, matrixFixture, {
      includeOptionalTargets: Boolean(args.includeOptionalTargets),
      includeNegativeControls: Boolean(args.includeNegativeControls),
    })
    : dataset;
  const backendLabel = args.backendLabel || 'qdrant-default-live';
  const artifactDir = path.resolve(args.artifactDir || defaultArtifactDir);
  const runName = args.runName || `${new Date().toISOString().replace(/[:.]/g, '-')}-demo-1c-live`;
  const runDir = path.join(artifactDir, runName);
  const rawPath = args.rawOut || path.join(runDir, 'raw-results.json');
  const summaryPath = args.out || path.join(runDir, 'summary.json');
  const markdownPath = args.markdownOut || path.join(runDir, 'summary.md');
  const labelValidationPath = args.labelValidationOut || path.join(runDir, 'label-validation.json');
  const comparePath = args.compareOut || (args.baseline ? path.join(runDir, 'comparison.json') : undefined);
  const clientConfig = readClientConfig(args.clientConfig);

  const options = {
    codebasePath,
    backendLabel,
    limit: Number(args.limit || 10),
    rankingProfile: parseRankingProfile(args.rankingProfile),
    oneCIndexScopeProfile: args.oneCIndexScopeProfile || 'developer',
    indexFirst: Boolean(args.indexFirst),
    forceIndex: Boolean(args.forceIndex),
  };
  const requiredResidualAssertions = parseJsonOption(args.requiredResidualAssertionsJson, 'required-residual-assertions-json');

  const startedAt = new Date().toISOString();
  const indexStatus = await ensureIndexed(clientConfig, options);
  const collected = await collectResults(clientConfig, collectionDataset, options);
  const finishedAt = new Date().toISOString();
  const rawReport = {
    dataset: dataset.dataset,
    version: dataset.version,
    codebasePath,
    matrixFixture,
    backend: backendLabel,
    retrievalMode: args.retrievalMode || 'mcp-search_code',
    rankingProfile: options.rankingProfile,
    bgeM3Mode: {
      retrievalMode: args.retrievalMode || 'mcp-search_code',
      rankingProfile: options.rankingProfile,
      indexStatusRetrievalMode: indexStatus.structuredContent?.retrievalMode,
      indexStatusRetrievalProfile: indexStatus.structuredContent?.retrievalProfile,
      indexStatusRetrievalSchemaVersion: indexStatus.structuredContent?.retrievalSchemaVersion,
    },
    startedAt,
    finishedAt,
    indexStatus: {
      text: textFromResult(indexStatus),
      structuredContent: indexStatus.structuredContent,
    },
    rlmBslEnrichment: summarizeRlmBslEnrichment(indexStatus),
    caseCount: collectionDataset.queries.length,
    summary: {
      toolErrors: collected.errors.toolErrors,
      missingColbertErrors: collected.errors.missingColbertErrors,
    },
    results: collected.results,
  };
  writeJson(rawPath, rawReport);

  const resultsById = normalizeResults(rawReport.results, collectionDataset, undefined);
  const labelValidation = validateLabels(dataset, codebasePath, { matrixFixture });
  const summary = score(dataset, resultsById, {
    backendLabel,
    retrievalMode: rawReport.retrievalMode,
    rankingProfile: options.rankingProfile,
    codebasePath,
    datasetPath,
    resultsPath: rawPath,
    acceptanceThreshold: args.acceptanceThreshold ? Number(args.acceptanceThreshold) : undefined,
    strictHitAt1Threshold: args.strictHitAt1Threshold ? Number(args.strictHitAt1Threshold) : undefined,
    strictHitAt5Threshold: args.strictHitAt5Threshold ? Number(args.strictHitAt5Threshold) : undefined,
    strictPositiveHitAt10Threshold: args.strictPositiveHitAt10Threshold ? Number(args.strictPositiveHitAt10Threshold) : undefined,
    negativeControlPassThreshold: args.negativeControlPassThreshold ? Number(args.negativeControlPassThreshold) : undefined,
    residualQueryIds: parseCsvList(args.residualQueryIds),
    requiredResidualAssertions,
    baselineMode: args.baselineMode || undefined,
    startedAt,
    finishedAt,
    bgeM3Mode: rawReport.bgeM3Mode,
    rawSummary: rawReport.summary,
    indexStatus: rawReport.indexStatus,
    rlmBslEnrichment: rawReport.rlmBslEnrichment,
    matrixFixture,
    includeOptionalTargets: Boolean(args.includeOptionalTargets),
    labelValidation: {
      codebasePath: labelValidation.codebasePath,
      fixtureKey: labelValidation.fixtureKey,
      unreachablePrefixCount: labelValidation.unreachablePrefixCount,
      needsInspectionCount: labelValidation.needsInspectionCount,
      notApplicableTargetCount: labelValidation.notApplicableTargetCount,
      issueCount: labelValidation.issueCount,
      strictAcceptanceReady: labelValidation.strictAcceptanceReady,
      ambiguousQueryIds: labelValidation.ambiguousQueryIds,
      queryPurposeCoverage: labelValidation.queryPurposeCoverage,
      notApplicable: labelValidation.notApplicable,
    },
  });
  if (summary.run?.labelValidation) {
    summary.run.labelValidation.thresholdRecommendation = buildThresholdRecommendation(summary, labelValidation);
  }
  const comparison = args.baseline ? buildComparison(readJson(args.baseline), summary) : undefined;
  if (comparison) {
    summary.comparison = comparison;
  }
  if (Array.isArray(requiredResidualAssertions) && requiredResidualAssertions.length > 0) {
    summary.residualAssertions = evaluateResidualAssertions(summary, requiredResidualAssertions);
  }
  writeJson(summaryPath, summary);
  writeJson(labelValidationPath, labelValidation);
  if (comparePath && comparison) {
    writeJson(comparePath, comparison);
  }
  writeMarkdownReport(markdownPath, summary, labelValidation, comparison);

  if (args.expectHitAt10Count !== undefined) {
    const expected = Number(args.expectHitAt10Count);
    if (summary.metrics.hitAt10Count !== expected) {
      throw new Error(`Expected Hit@10 count ${expected}, got ${summary.metrics.hitAt10Count}.`);
    }
  }
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
  console.log(JSON.stringify({
    rawPath,
    summaryPath,
    markdownPath,
    labelValidationPath,
    comparePath,
    rankingProfile: options.rankingProfile,
    hitAt10Count: summary.metrics.hitAt10Count,
    queryCount: summary.metrics.queryCount,
    toolErrors: collected.errors.toolErrors,
    missingColbertErrors: collected.errors.missingColbertErrors,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
