#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const defaultDatasetPath = path.join(repoRoot, 'evaluation', 'retrieval', 'one-c-runbook-scenario-matrix.json');
const defaultArtifactDir = path.join(repoRoot, '.artifacts', 'hybrid-code-symbol-retrieval');
const targetStatuses = new Set(['applicable', 'optional', 'not-applicable', 'needs-inspection']);
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

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
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
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  };
  walk(root);
  return results.map(normalizePath);
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
    rankingProfile: item.rankingProfile ?? metadata.rankingProfile,
  };
}

function matchesAnyPrefix(resultPath, prefixes) {
  const normalizedResultPath = normalizePath(resultPath);
  return (prefixes || []).some((prefix) => normalizedResultPath.startsWith(normalizePath(prefix)));
}

function inferFixtureKey(dataset, options = {}) {
  if (options.fixture) {
    return options.fixture;
  }
  const fixtureKeys = Object.keys(dataset.fixtures || {});
  if (fixtureKeys.length === 1) {
    return fixtureKeys[0];
  }
  throw new Error('Scenario evaluation requires --fixture when the dataset has multiple fixtures.');
}

function fixturePath(dataset, fixtureKey, options = {}) {
  return path.resolve(options.codebasePath || dataset.fixtures?.[fixtureKey]?.path || path.join(repoRoot, 'examples', fixtureKey));
}

function scenariosForFixture(dataset, fixtureKey, options = {}) {
  const includeOptional = Boolean(options.includeOptionalTargets);
  return (dataset.scenarios || [])
    .map((scenario) => {
      const target = scenario.targets?.[fixtureKey];
      if (!target) {
        return null;
      }
      if (!['applicable', ...(includeOptional ? ['optional'] : [])].includes(target.status)) {
        return null;
      }
      return {
        ...scenario,
        fixtureKey,
        targetStatus: target.status,
        requiredRoles: target.requiredRoles || [],
        optionalRoles: target.optionalRoles || [],
      };
    })
    .filter(Boolean);
}

function validateScenarioMatrix(dataset, options = {}) {
  const selectedFixture = options.fixture;
  const fixtureEntries = Object.entries(dataset.fixtures || {})
    .filter(([fixtureKey]) => !selectedFixture || fixtureKey === selectedFixture);
  const scenarioIds = new Set();
  const perScenario = [];
  const unreachable = [];
  const optionalRoleReachability = [];
  const issues = [];

  if (dataset.dataset !== 'one-c-runbook-scenario-matrix') {
    issues.push(`unexpected dataset ${dataset.dataset || '<missing>'}`);
  }
  if (!Array.isArray(dataset.scenarios)) {
    issues.push('missing scenarios array');
  }

  for (const scenario of dataset.scenarios || []) {
    if (!scenario.id) {
      issues.push('scenario is missing id');
    } else if (scenarioIds.has(scenario.id)) {
      issues.push(`duplicate scenario id ${scenario.id}`);
    } else {
      scenarioIds.add(scenario.id);
    }
    if (!scenario.userTask) {
      issues.push(`scenario ${scenario.id || '<missing>'} is missing userTask`);
    }
    if (!scenario.domain) {
      issues.push(`scenario ${scenario.id || '<missing>'} is missing domain`);
    }
  }

  for (const [fixtureKey, fixture] of fixtureEntries) {
    const files = listFiles(path.resolve(options.codebasePath || fixture.path || path.join(repoRoot, 'examples', fixtureKey)));
    for (const scenario of dataset.scenarios || []) {
      const target = scenario.targets?.[fixtureKey];
      if (!target) {
        perScenario.push({
          id: scenario.id,
          fixtureKey,
          targetStatus: 'missing-target',
          allReachable: false,
          issues: [`missing target for fixture ${fixtureKey}`],
          roles: [],
        });
        continue;
      }
      const rowIssues = [];
      if (!targetStatuses.has(target.status)) {
        rowIssues.push(`invalid target status ${target.status}`);
      }
      if (target.status === 'needs-inspection') {
        rowIssues.push('target needs source inspection');
      }
      const shouldValidate = ['applicable', 'optional'].includes(target.status);
      const roles = shouldValidate
        ? [
          ...(target.requiredRoles || []).map((role) => ({ ...role, optional: Boolean(role.optional), required: !role.optional })),
          ...(target.optionalRoles || []).map((role) => ({ ...role, optional: true, required: false })),
        ].map((role) => {
          if (!role.id) {
            rowIssues.push('role is missing id');
          }
          if (!Array.isArray(role.pathPrefixes) || role.pathPrefixes.length === 0) {
            rowIssues.push(`role ${role.id || '<missing>'} is missing pathPrefixes`);
          }
          const prefixRows = (role.pathPrefixes || []).map((prefix) => {
            const normalizedPrefix = normalizePath(prefix);
            const matches = files.filter((file) => file.startsWith(normalizedPrefix));
            const result = {
              roleId: role.id,
              label: role.label,
              optional: Boolean(role.optional),
              prefix,
              reachable: matches.length > 0,
              matchingFileCount: matches.length,
              sampleMatches: matches.slice(0, 5),
            };
            if (!result.reachable) {
              const failure = {
                scenarioId: scenario.id,
                fixtureKey,
                roleId: role.id,
                optional: Boolean(role.optional),
                prefix,
              };
              if (role.optional) {
                optionalRoleReachability.push(failure);
              } else {
                unreachable.push(failure);
              }
            }
            return result;
          });
          return {
            id: role.id,
            label: role.label,
            optional: Boolean(role.optional),
            prefixes: prefixRows,
            reachable: prefixRows.every((prefix) => prefix.reachable),
          };
        })
        : [];
      if (target.status === 'applicable' && !roles.some((role) => !role.optional)) {
        rowIssues.push('applicable target must include required roles');
      }
      perScenario.push({
        id: scenario.id,
        userTask: scenario.userTask,
        fixtureKey,
        targetStatus: target.status,
        allReachable: roles.every((role) => role.optional || role.reachable) && rowIssues.length === 0,
        issues: rowIssues,
        roles,
        reason: target.reason || target.note,
      });
    }
  }

  const issueCount = issues.length + perScenario.reduce((sum, row) => sum + row.issues.length, 0);
  return {
    dataset: dataset.dataset,
    version: dataset.version,
    fixtureKeys: fixtureEntries.map(([fixtureKey]) => fixtureKey),
    scenarioCount: (dataset.scenarios || []).length,
    applicableTargetCount: perScenario.filter((row) => row.targetStatus === 'applicable').length,
    optionalTargetCount: perScenario.filter((row) => row.targetStatus === 'optional').length,
    notApplicableTargetCount: perScenario.filter((row) => row.targetStatus === 'not-applicable').length,
    needsInspectionCount: perScenario.filter((row) => row.targetStatus === 'needs-inspection').length,
    missingTargetCount: perScenario.filter((row) => row.targetStatus === 'missing-target').length,
    unreachableRequiredRolePrefixCount: unreachable.length,
    unreachableOptionalRolePrefixCount: optionalRoleReachability.length,
    issueCount,
    strictAcceptanceReady: issueCount === 0 &&
      unreachable.length === 0 &&
      perScenario.every((row) => row.targetStatus !== 'needs-inspection' && row.targetStatus !== 'missing-target'),
    issues,
    unreachable,
    optionalRoleReachability,
    perScenario,
  };
}

function normalizeSearch(search) {
  const results = Array.isArray(search.results)
    ? search.results.map(normalizeResultItem)
    : Array.isArray(search.top10)
      ? search.top10.map(normalizeResultItem)
      : [];
  return {
    ...search,
    requestedLimit: Number(search.requestedLimit ?? search.limit ?? 10),
    effectiveResultCount: Number(search.effectiveResultCount ?? search.resultCount ?? results.length),
    results,
  };
}

function roleCoverageFromSearches(roles, searches, options = {}) {
  const upToIndex = options.upToIndex ?? searches.length - 1;
  const selectedSearches = searches.slice(0, upToIndex + 1);
  return roles.map((role) => {
    const matchedPaths = [];
    for (const search of selectedSearches) {
      for (const result of search.results || []) {
        const resultPath = result.relativePath || result.path || '';
        if (matchesAnyPrefix(resultPath, role.pathPrefixes || [])) {
          matchedPaths.push({
            path: normalizePath(resultPath),
            phase: search.phase,
            roleIntent: search.roleIntent,
            searchIndex: search.searchIndex,
          });
        }
      }
    }
    return {
      id: role.id,
      label: role.label,
      description: role.description,
      optional: Boolean(role.optional),
      pathPrefixes: role.pathPrefixes || [],
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

function summarizeMissingRoles(perScenario) {
  const missingRequiredRolesById = {};
  for (const row of perScenario) {
    for (const role of row.missingRequiredRoles || []) {
      const roleId = role.id || 'unspecified';
      if (!missingRequiredRolesById[roleId]) {
        missingRequiredRolesById[roleId] = {
          roleId,
          label: role.label,
          count: 0,
          failures: [],
        };
      }
      missingRequiredRolesById[roleId].count += 1;
      missingRequiredRolesById[roleId].failures.push({
        scenarioId: row.id,
        fixtureKey: row.fixtureKey,
        domain: row.domain,
        pathPrefixes: role.pathPrefixes,
      });
    }
  }
  return missingRequiredRolesById;
}

function searchesToComplete(roles, searches) {
  for (let index = 0; index < searches.length; index += 1) {
    const coverage = summarizeRoleCoverage(roleCoverageFromSearches(roles, searches, { upToIndex: index }));
    if (coverage.complete) {
      return index + 1;
    }
  }
  return null;
}

function scoreScenarioMatrix(dataset, rawResults, options = {}) {
  const fixtureKey = inferFixtureKey(dataset, { fixture: options.fixture || rawResults.fixtureKey });
  const scenarioRows = scenariosForFixture(dataset, fixtureKey, { includeOptionalTargets: options.includeOptionalTargets });
  const searches = (rawResults.searches || []).map(normalizeSearch);
  const searchesByScenario = new Map();
  for (const search of searches) {
    const key = `${search.fixtureKey || fixtureKey}::${search.scenarioId}`;
    if (!searchesByScenario.has(key)) {
      searchesByScenario.set(key, []);
    }
    searchesByScenario.get(key).push(search);
  }
  for (const groupedSearches of searchesByScenario.values()) {
    groupedSearches.sort((left, right) => Number(left.searchIndex || 0) - Number(right.searchIndex || 0));
  }

  const perScenario = scenarioRows.map((scenario) => {
    const key = `${fixtureKey}::${scenario.id}`;
    const scenarioSearches = searchesByScenario.get(key) || [];
    const roles = scenario.requiredRoles || [];
    const firstQueryRoles = roleCoverageFromSearches(roles, scenarioSearches.filter((search) => search.phase === 'broad').slice(0, 1));
    const finalRoles = roleCoverageFromSearches(roles, scenarioSearches);
    const firstQueryCoverage = summarizeRoleCoverage(firstQueryRoles);
    const finalCoverage = summarizeRoleCoverage(finalRoles);
    const missingRequiredRoles = finalRoles.filter((role) => !role.optional && !role.found);
    const firstFound = firstQueryCoverage.foundRequiredRoleCount;
    const finalFound = finalCoverage.foundRequiredRoleCount;
    return {
      id: scenario.id,
      userTask: scenario.userTask,
      domain: scenario.domain,
      fixtureKey,
      targetStatus: scenario.targetStatus,
      firstQueryRoleCoverage: firstQueryCoverage,
      finalRoleCoverage: finalCoverage,
      workflowGain: Math.max(0, finalFound - firstFound),
      searchesAttempted: scenarioSearches.length,
      searchesToComplete: searchesToComplete(roles, scenarioSearches),
      requestedResultLimits: scenarioSearches.map((search) => search.requestedLimit),
      effectiveResultCounts: scenarioSearches.map((search) => search.effectiveResultCount),
      searches: scenarioSearches.map((search) => ({
        searchIndex: search.searchIndex,
        phase: search.phase,
        roleIntent: search.roleIntent,
        query: search.query,
        requestedLimit: search.requestedLimit,
        effectiveResultCount: search.effectiveResultCount,
        latencyMs: search.latencyMs ?? search.elapsedMs,
        error: search.error || null,
        topResultPaths: (search.results || []).slice(0, 10).map((result) => result.relativePath || result.path || ''),
      })),
      resultRoles: finalRoles,
      missingRequiredRoles,
      complete: finalCoverage.complete,
    };
  });

  const toolErrors = searches.filter((search) => search.error).length;
  const missingColbertErrors = searches.filter((search) => /missing colbert|colbert.*missing/i.test(String(search.error || ''))).length;
  const bundleCompleteness = {
    scenarioCount: perScenario.length,
    completeCount: perScenario.filter((row) => row.complete).length,
    incompleteCount: perScenario.filter((row) => !row.complete).length,
    missingRequiredRoleCount: perScenario.reduce((sum, row) => sum + row.finalRoleCoverage.missingRequiredRoleCount, 0),
    missingRequiredRolesById: summarizeMissingRoles(perScenario),
  };
  return {
    dataset: dataset.dataset,
    version: dataset.version,
    fixtureKey,
    labelsAreProductionRules: dataset.labelsAreProductionRules,
    run: {
      backendLabel: options.backendLabel || rawResults.backendLabel,
      retrievalMode: options.retrievalMode || rawResults.retrievalMode,
      rankingProfile: options.rankingProfile || rawResults.rankingProfile,
      codebasePath: options.codebasePath || rawResults.codebasePath,
      startedAt: rawResults.startedAt,
      finishedAt: rawResults.finishedAt,
      maxSearchesPerScenario: rawResults.maxSearchesPerScenario,
      requestedLimit: rawResults.requestedLimit,
      indexStatus: rawResults.indexStatus,
      rawSummary: {
        toolErrors,
        missingColbertErrors,
        searchCount: searches.length,
      },
    },
    metrics: {
      scenarioCount: perScenario.length,
      firstQueryCompleteCount: perScenario.filter((row) => row.firstQueryRoleCoverage.complete).length,
      finalCompleteCount: bundleCompleteness.completeCount,
      workflowGainTotal: perScenario.reduce((sum, row) => sum + row.workflowGain, 0),
      searchesAttempted: searches.length,
      toolErrors,
      missingColbertErrors,
    },
    bundleCompleteness,
    perScenario,
  };
}

function markdownForSummary(summary, validation) {
  const lines = [];
  lines.push('# 1C runbook scenario report');
  lines.push('');
  lines.push(`- Dataset: \`${summary.dataset}\` ${summary.version || ''}`.trim());
  lines.push(`- Fixture: ${summary.fixtureKey}`);
  lines.push(`- Backend: ${summary.run.backendLabel || 'unspecified'}`);
  lines.push(`- Retrieval mode: ${summary.run.retrievalMode || 'unspecified'}`);
  lines.push(`- Ranking profile: ${summary.run.rankingProfile || 'unspecified'}`);
  lines.push(`- Codebase: \`${summary.run.codebasePath || 'unspecified'}\``);
  lines.push(`- Tool errors: ${summary.metrics.toolErrors}`);
  lines.push(`- Missing ColBERT errors: ${summary.metrics.missingColbertErrors}`);
  lines.push(`- Bundle completion: ${summary.bundleCompleteness.completeCount}/${summary.bundleCompleteness.scenarioCount}`);
  lines.push(`- Workflow gain total: ${summary.metrics.workflowGainTotal}`);
  if (validation) {
    lines.push(`- Label validation: ${validation.strictAcceptanceReady ? 'ready' : 'not ready'}`);
    lines.push(`- Unreachable required role prefixes: ${validation.unreachableRequiredRolePrefixCount}`);
  }
  lines.push('');
  lines.push('| scenario | first complete | final complete | first roles | final roles | gain | searches | effective result counts | missing roles |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |');
  for (const row of summary.perScenario) {
    lines.push([
      row.id,
      row.firstQueryRoleCoverage.complete ? 'yes' : 'no',
      row.finalRoleCoverage.complete ? 'yes' : 'no',
      `${row.firstQueryRoleCoverage.foundRequiredRoleCount}/${row.firstQueryRoleCoverage.requiredRoleCount}`,
      `${row.finalRoleCoverage.foundRequiredRoleCount}/${row.finalRoleCoverage.requiredRoleCount}`,
      row.workflowGain,
      row.searchesAttempted,
      row.effectiveResultCounts.join(', '),
      row.missingRequiredRoles.map((role) => role.label || role.id).join('<br>'),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  if (summary.bundleCompleteness.missingRequiredRoleCount > 0) {
    lines.push('');
    lines.push('## Missing required roles');
    lines.push('| role | missing | failures |');
    lines.push('| --- | ---: | --- |');
    for (const group of Object.values(summary.bundleCompleteness.missingRequiredRolesById)
      .sort((left, right) => right.count - left.count || left.roleId.localeCompare(right.roleId))) {
      lines.push(`| ${group.label || group.roleId} | ${group.count} | ${group.failures.map((failure) => `${failure.fixtureKey}::${failure.scenarioId}`).join('<br>')} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function readClientConfig(configPath) {
  const resolved = configPath || path.join(os.homedir(), '.context', 'mcp', 'daemon', 'client-config.json');
  return readJson(resolved);
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

function summarizeTopResults(results) {
  return (results || []).map((result, index) => ({
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

function roleSearchQuery(scenario, role) {
  const hint = Array.isArray(role.searchHints) && role.searchHints.length > 0 ? role.searchHints[0] : '';
  return [hint, scenario.userTask, role.label, role.description]
    .filter(Boolean)
    .join(' ');
}

async function collectLiveResults(dataset, options) {
  const clientConfig = readClientConfig(options.clientConfig);
  const fixtureKey = inferFixtureKey(dataset, options);
  const codebasePath = fixturePath(dataset, fixtureKey, options);
  const scenarios = scenariosForFixture(dataset, fixtureKey, { includeOptionalTargets: options.includeOptionalTargets });
  const searches = [];
  let searchIndex = 0;
  const maxSearchesPerScenario = Number(options.maxSearchesPerScenario || 6);
  const requestedLimit = Number(options.limit || 10);

  let indexStatus;
  try {
    indexStatus = await callTool(clientConfig, 'get_indexing_status', { path: codebasePath });
  } catch (error) {
    indexStatus = { error: error instanceof Error ? error.message : String(error) };
  }

  for (const scenario of scenarios) {
    const plannedSearches = [{
      phase: 'broad',
      roleIntent: null,
      query: scenario.userTask,
    }];
    for (const role of scenario.requiredRoles || []) {
      if (plannedSearches.length >= maxSearchesPerScenario) {
        break;
      }
      plannedSearches.push({
        phase: 'focused',
        roleIntent: role.id,
        query: roleSearchQuery(scenario, role),
      });
    }
    for (const planned of plannedSearches) {
      const started = Date.now();
      let toolResult;
      let error = null;
      try {
        toolResult = await callTool(clientConfig, 'search_code', {
          path: codebasePath,
          query: planned.query,
          limit: requestedLimit,
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
      const results = summarizeTopResults(structured.results || []);
      searchIndex += 1;
      searches.push({
        scenarioId: scenario.id,
        fixtureKey,
        searchIndex,
        phase: planned.phase,
        roleIntent: planned.roleIntent,
        query: planned.query,
        requestedLimit,
        effectiveResultCount: results.length,
        latencyMs: elapsedMs,
        error,
        rankingProfile: structured.rankingProfile || options.rankingProfile,
        results,
      });
      console.error(`[runbook-scenario] ${scenario.id} ${planned.phase}${planned.roleIntent ? `:${planned.roleIntent}` : ''} ${error ? 'error' : 'ok'} ${elapsedMs}ms ${results.length} result(s)`);
    }
  }

  return {
    dataset: dataset.dataset,
    version: dataset.version,
    fixtureKey,
    codebasePath,
    backendLabel: options.backendLabel,
    retrievalMode: options.retrievalMode,
    rankingProfile: options.rankingProfile,
    requestedLimit,
    maxSearchesPerScenario,
    startedAt: options.startedAt,
    finishedAt: new Date().toISOString(),
    indexStatus: indexStatus?.structuredContent || indexStatus,
    searches,
  };
}

function parseRankingProfile(value) {
  const rankingProfile = value || 'one-c';
  if (!rankingProfiles.has(rankingProfile)) {
    throw new Error(`Invalid --ranking-profile ${JSON.stringify(rankingProfile)}. Expected one of: ${[...rankingProfiles].join(', ')}.`);
  }
  return rankingProfile;
}

async function main() {
  const args = parseArgs(process.argv);
  const datasetPath = path.resolve(args.dataset || defaultDatasetPath);
  const dataset = readJson(datasetPath);
  const fixtureKey = inferFixtureKey(dataset, { fixture: args.fixture });
  const codebasePath = fixturePath(dataset, fixtureKey, { codebasePath: args.codebasePath });
  const validation = args.validateLabelsAgainst || args.validateOnly
    ? validateScenarioMatrix(dataset, { fixture: fixtureKey, codebasePath })
    : undefined;

  if (args.validateOnly) {
    const output = JSON.stringify(validation, null, 2);
    if (args.out) {
      writeJson(args.out, validation);
    } else {
      process.stdout.write(`${output}\n`);
    }
    if (!validation.strictAcceptanceReady && !args.allowIncompleteLabels) {
      process.exit(1);
    }
    return;
  }

  const artifactDir = path.resolve(args.artifactDir || defaultArtifactDir);
  const runName = args.runName || `${new Date().toISOString().replace(/[:.]/g, '-')}-${fixtureKey}-runbook-scenario`;
  const runDir = path.join(artifactDir, runName);
  const rawPath = args.rawOut || path.join(runDir, 'raw-results.json');
  const summaryPath = args.out || path.join(runDir, 'summary.json');
  const markdownPath = args.markdownOut || path.join(runDir, 'summary.md');
  const labelValidationPath = args.labelValidationOut || path.join(runDir, 'label-validation.json');
  const options = {
    fixture: fixtureKey,
    codebasePath,
    backendLabel: args.backendLabel || 'local-mcp-live',
    retrievalMode: args.retrievalMode,
    rankingProfile: parseRankingProfile(args.rankingProfile),
    limit: Number(args.limit || 10),
    maxSearchesPerScenario: Number(args.maxSearchesPerScenario || 6),
    includeOptionalTargets: Boolean(args.includeOptionalTargets),
    clientConfig: args.clientConfig,
    startedAt: new Date().toISOString(),
  };

  const rawResults = args.results
    ? readJson(path.resolve(args.results))
    : await collectLiveResults(dataset, options);
  const summary = scoreScenarioMatrix(dataset, rawResults, {
    ...options,
    fixture: fixtureKey,
  });

  if (!args.results) {
    writeJson(rawPath, rawResults);
  }
  writeJson(summaryPath, summary);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, markdownForSummary(summary, validation), 'utf8');
  if (validation) {
    writeJson(labelValidationPath, validation);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  normalizePath,
  validateScenarioMatrix,
  scoreScenarioMatrix,
  markdownForSummary,
  scenariosForFixture,
};
