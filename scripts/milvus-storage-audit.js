#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const result = spawnSync(
    'pnpm',
    [
        '--filter',
        '@zilliz/claude-context-mcp',
        'exec',
        'tsx',
        'src/milvus-storage-audit-cli.ts',
        ...process.argv.slice(2),
    ],
    {
        cwd: repoRoot,
        stdio: 'inherit',
    },
);

process.exit(result.status ?? 1);
