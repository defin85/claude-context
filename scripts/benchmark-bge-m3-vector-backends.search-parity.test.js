#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const benchmarkScript = path.join(repoRoot, 'scripts', 'benchmark-bge-m3-vector-backends.js');

function findMatrixSummary(artifactDir) {
    const stack = [artifactDir];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(entryPath);
            } else if (entry.name === 'summary.json') {
                const parsed = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
                if (Array.isArray(parsed.runs)) {
                    return parsed;
                }
            }
        }
    }
    throw new Error(`No matrix summary found under ${artifactDir}`);
}

test('self-test records an intentional search parity failure as non-comparable', () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bge-m3-search-parity-'));
    const result = spawnSync(process.execPath, [
        benchmarkScript,
        '--self-test',
        '--artifact-dir',
        artifactDir,
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const matrixSummary = findMatrixSummary(artifactDir);
    const failedRun = matrixSummary.runs.find((run) => run.backend === 'parity-miss');
    assert.ok(failedRun, 'expected self-test to include parity-miss backend');
    assert.equal(failedRun.complete, true);
    assert.equal(failedRun.searchParity, 'failed');
    assert.equal(failedRun.comparable, false);
    assert.equal(matrixSummary.comparableRuns.includes('parity-miss'), false);

    const runSummary = JSON.parse(fs.readFileSync(failedRun.summaryPath, 'utf8'));
    assert.equal(runSummary.searchParity.status, 'failed');
    assert.ok(runSummary.searchParity.queries.some((query) => query.missingIds.length > 0));
});
