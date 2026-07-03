import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addRuntimeAllowRoot, readRuntimeAllowRoots } from './runtime-allow-roots.js';

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

test('runtime allow roots writer adds local absolute paths and audits the change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-allow-roots-add-'));
    const filePath = path.join(root, 'allow-roots.json');
    const auditPath = path.join(root, 'allow-roots.audit.jsonl');
    const projectPath = path.join(root, 'repo');
    await fs.mkdir(projectPath);
    await fs.writeFile(filePath, JSON.stringify({ allowedRoots: [projectPath] }));

    const result = await addRuntimeAllowRoot({
        filePath,
        auditPath,
        path: projectPath,
        actor: 'test-agent',
        reason: 'test add',
        timestamp: '2026-07-03T00:00:00.000Z',
    });

    assert.equal(result.added, false);
    assert.equal(result.path, projectPath);
    assert.deepEqual((await readRuntimeAllowRoots(filePath)).roots, [projectPath]);

    const secondPath = path.join(root, 'repo-2');
    await fs.mkdir(secondPath);
    const second = await addRuntimeAllowRoot({
        filePath,
        auditPath,
        path: secondPath,
        actor: 'test-agent',
        reason: 'second add',
        timestamp: '2026-07-03T00:00:01.000Z',
    });

    assert.equal(second.added, true);
    assert.deepEqual((await readRuntimeAllowRoots(filePath)).roots, [projectPath, secondPath]);

    const auditLines = (await fs.readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(auditLines.length, 2);
    assert.deepEqual(auditLines.map((entry) => entry.action), ['add_allowed_root', 'add_allowed_root']);
    assert.deepEqual(auditLines.map((entry) => entry.added), [false, true]);
    assert.deepEqual(auditLines.map((entry) => entry.path), [projectPath, secondPath]);
    assert.deepEqual(auditLines.map((entry) => entry.actor), ['test-agent', 'test-agent']);
});

test('runtime allow roots writer rejects non-local and non-absolute paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-allow-roots-reject-'));
    const filePath = path.join(root, 'allow-roots.json');
    const auditPath = path.join(root, 'allow-roots.audit.jsonl');

    await assert.rejects(
        () => addRuntimeAllowRoot({ filePath, auditPath, path: 'relative/path' }),
        /must be absolute/
    );

    await assert.rejects(
        () => addRuntimeAllowRoot({ filePath, auditPath, path: '\\\\wsl.localhost\\Ubuntu\\home\\egor\\repo' }),
        /must be a local POSIX path/
    );
});
