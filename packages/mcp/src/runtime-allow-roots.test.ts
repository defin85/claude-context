import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readRuntimeAllowRoots } from './runtime-allow-roots.js';

test('runtime allow roots loader accepts string array files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-allow-roots-'));
    const filePath = path.join(root, 'allow-roots.json');
    await fs.writeFile(filePath, JSON.stringify(['/repo/a', '/repo/b', '/repo/a']));

    const result = await readRuntimeAllowRoots(filePath);

    assert.deepEqual(result, { roots: ['/repo/a', '/repo/b'] });
});

test('runtime allow roots loader rejects invalid files without throwing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-allow-roots-invalid-'));
    const filePath = path.join(root, 'allow-roots.json');
    await fs.writeFile(filePath, JSON.stringify({ allowedRoots: ['relative/path'] }));

    const result = await readRuntimeAllowRoots(filePath);

    assert.deepEqual(result.roots, []);
    assert.match(result.error || '', /must be absolute/);
});
