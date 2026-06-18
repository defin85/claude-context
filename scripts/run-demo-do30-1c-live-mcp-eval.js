#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const forwarded = process.argv.slice(2);
const hasOption = (name) => forwarded.includes(name);
const runName = `${new Date().toISOString().replace(/[:.]/g, '-')}-demo-do30-1c-live`;
const finalTunedBaseline = path.join(
  repoRoot,
  '.artifacts',
  'hybrid-code-symbol-retrieval',
  '2026-06-16T-improve-1c-scenario-ranking-demo-do30-final',
  'summary.json',
);
const defaults = [
  '--dataset', path.join(repoRoot, 'evaluation', 'retrieval', 'demo-do30-1c-scenarios.json'),
  '--codebase-path', path.join(repoRoot, 'examples', 'demo-do30-1c'),
  '--artifact-dir', path.join(repoRoot, '.artifacts', 'hybrid-code-symbol-retrieval'),
  '--run-name', runName,
  '--ranking-profile', 'one-c',
  '--limit', '50',
  '--strict-hit-at1-threshold', '21',
  '--strict-hit-at5-threshold', '24',
  '--baseline-mode', 'non-regression',
];
if (fs.existsSync(finalTunedBaseline)) {
  defaults.push('--baseline', finalTunedBaseline);
}

const args = [];
for (let index = 0; index < defaults.length; index += 2) {
  if (!hasOption(defaults[index])) {
    args.push(defaults[index], defaults[index + 1]);
  }
}
args.push(...forwarded);

const child = spawnSync(process.execPath, [
  path.join(__dirname, 'run-demo-1c-live-mcp-eval.js'),
  ...args,
], {
  stdio: 'inherit',
});

process.exit(child.status ?? 1);
