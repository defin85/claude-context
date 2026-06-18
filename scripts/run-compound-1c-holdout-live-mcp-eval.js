#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const forwarded = process.argv.slice(2);
const hasOption = (name) => forwarded.includes(name);
const runName = `${new Date().toISOString().replace(/[:.]/g, '-')}-compound-1c-holdout-live`;
const defaults = [
  '--dataset', path.join(repoRoot, 'evaluation', 'retrieval', 'compound-1c-name-holdout.json'),
  '--codebase-path', path.join(repoRoot, 'examples', 'demo-do30-1c'),
  '--matrix-fixture', 'demo-do30-1c',
  '--artifact-dir', path.join(repoRoot, '.artifacts', 'hybrid-code-symbol-retrieval'),
  '--run-name', runName,
  '--ranking-profile', 'one-c',
  '--limit', '50',
  '--strict-positive-hit-at10-threshold', '4',
  '--negative-control-pass-threshold', '5',
];

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
