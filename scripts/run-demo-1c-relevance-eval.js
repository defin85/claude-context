#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      args[arg.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeResults(resultsInput, backend) {
  if (Array.isArray(resultsInput)) {
    const byId = {};
    for (const item of resultsInput) {
      if (item.id && Array.isArray(item.results)) {
        byId[item.id] = item.results;
      } else if (backend && item.id && item.backends && Array.isArray(item.backends[backend])) {
        byId[item.id] = {
          results: item.backends[backend],
          latencyMs: item.timingsMs ? item.timingsMs[backend] : undefined,
        };
      }
    }
    return byId;
  }
  if (resultsInput && typeof resultsInput === 'object') {
    return resultsInput.resultsById || resultsInput.results || resultsInput;
  }
  return {};
}

function isRelevant(result, expectedPathPrefixes) {
  const relativePath = String(result.relativePath || result.path || '');
  return expectedPathPrefixes.some((prefix) => relativePath.startsWith(prefix));
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

function score(dataset, resultsById) {
  const perQuery = [];
  const metrics = {
    queryCount: dataset.queries.length,
    failures: 0,
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
      missing: rank === null,
      latencyMs,
    };
    perQuery.push(row);

    if (rank === null) {
      metrics.failures += 1;
    }
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

  return {
    dataset: dataset.dataset,
    version: dataset.version,
    fixture: dataset.fixture,
    labelsAreProductionRules: dataset.labelsAreProductionRules,
    metrics,
    perQuery,
    knownMisses: perQuery.filter((row) => [
      'r01',
      'r05',
      'r06',
      'r28',
    ].includes(row.id)),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const datasetPath = args.dataset || path.join(__dirname, '..', 'evaluation', 'retrieval', 'demo-1c-relevance.json');
  if (!args.results) {
    console.error('Usage: run-demo-1c-relevance-eval.js --results <results.json> [--dataset <dataset.json>] [--out <summary.json>]');
    process.exit(2);
  }
  const dataset = readJson(datasetPath);
  const rawResults = readJson(args.results);
  const resultsById = normalizeResults(rawResults.results || rawResults, args.backend);
  const summary = score(dataset, resultsById);
  const output = JSON.stringify(summary, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  score,
};
