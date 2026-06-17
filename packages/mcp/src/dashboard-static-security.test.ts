import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '../../..');
const dashboardDirs = [
    path.join(repoRoot, 'packages/web-dashboard/src'),
    path.join(repoRoot, 'packages/web-dashboard/dist'),
];
const forbiddenValues = [
    'dashboard-test-token-value',
    'provider-secret-value',
    'milvus-secret-value',
    'OPENAI_API_KEY=',
    'VOYAGEAI_API_KEY=',
    'GEMINI_API_KEY=',
    'MILVUS_TOKEN=',
    'MCP_DAEMON_TOKEN=',
    'bearerToken:',
];

function listFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return listFiles(entryPath);
        }
        return [entryPath];
    });
}

test('dashboard static source and built assets do not contain configured secret values', () => {
    const files = dashboardDirs.flatMap((dir) => listFiles(dir));
    assert.ok(files.length > 0, 'expected dashboard source or built asset files to exist');

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const forbiddenValue of forbiddenValues) {
            assert.equal(
                content.includes(forbiddenValue),
                false,
                `dashboard asset ${path.relative(repoRoot, file)} contains forbidden value ${forbiddenValue}`,
            );
        }
    }
});
