#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultDatasetPath = path.join(repoRoot, 'evaluation', 'retrieval', 'universal-1c-search-matrix.json');
const liveRunnerPath = path.join(__dirname, 'run-demo-1c-live-mcp-eval.js');

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

function stripArgs(argv, keysToStrip) {
  const stripped = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      stripped.push(arg);
      continue;
    }
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const hasValue = argv[index + 1] && !argv[index + 1].startsWith('--');
    if (keysToStrip.has(key)) {
      if (hasValue) {
        index += 1;
      }
      continue;
    }
    stripped.push(arg);
    if (hasValue) {
      stripped.push(argv[index + 1]);
      index += 1;
    }
  }
  return stripped;
}

function main() {
  const args = parseArgs(process.argv);
  const fixture = args.fixture || args.matrixFixture || (args.codebasePath ? path.basename(path.resolve(args.codebasePath)) : undefined);
  if (!fixture) {
    console.error('Usage: run-universal-1c-live-mcp-eval.js --fixture <demo-do30-1c|demo-bp30-1c|demo-ut-1c|demo-unf-1c> [runner options]');
    process.exit(2);
  }
  const codebasePath = path.resolve(args.codebasePath || path.join(repoRoot, 'examples', fixture));
  const datasetPath = path.resolve(args.dataset || defaultDatasetPath);
  const runName = args.runName || `${new Date().toISOString().replace(/[:.]/g, '-')}-${fixture}-universal-1c-live`;
  const forwarded = stripArgs(process.argv, new Set(['fixture', 'dataset', 'codebasePath', 'matrixFixture', 'runName']));
  const child = spawnSync(process.execPath, [
    liveRunnerPath,
    '--dataset', datasetPath,
    '--codebase-path', codebasePath,
    '--matrix-fixture', fixture,
    '--run-name', runName,
    ...forwarded,
  ], {
    stdio: 'inherit',
  });
  process.exit(child.status ?? 1);
}

if (require.main === module) {
  main();
}
