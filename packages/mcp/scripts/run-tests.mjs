import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const testFiles = args.length > 0
    ? args
    : readdirSync('src')
        .filter((entry) => entry.endsWith('.test.ts'))
        .sort()
        .map((entry) => join('src', entry));

const result = spawnSync('tsx', ['--test', ...testFiles], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
