import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { CodebaseConfigManager } from './codebase-config.js';

test('codebase config persists safe RLM BSL enrichment settings', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-rlm-bsl-config-'));
    const codebasePath = path.join(workspacePath, 'Конфигурация с пробелом');
    await fs.mkdir(codebasePath);

    const manager = new CodebaseConfigManager({ workspacePath });
    await manager.saveConfig(codebasePath, {
        rlmBslEnrichment: {
            mode: 'optional',
            command: 'rlm-bsl-index',
            args: ['provider', 'export', '{codebasePath}', '--json'],
            timeoutMs: 7000,
            limits: {
                maxFiles: 10,
                maxSymbolsPerFile: 20,
                maxSynonymsPerFile: 5,
                maxStringLength: 128,
                maxDiagnosticsBytes: 512,
            },
        },
    });

    const loaded = await manager.getConfig(codebasePath);

    assert.deepEqual(loaded?.rlmBslEnrichment, {
        mode: 'optional',
        command: 'rlm-bsl-index',
        args: ['provider', 'export', '{codebasePath}', '--json'],
        timeoutMs: 7000,
        limits: {
            maxFiles: 10,
            maxSymbolsPerFile: 20,
            maxSynonymsPerFile: 5,
            maxStringLength: 128,
            maxDiagnosticsBytes: 512,
        },
    });
});

test('codebase config stores disabled RLM BSL enrichment without command details', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-rlm-bsl-disabled-'));
    const codebasePath = path.join(workspacePath, 'repo');
    await fs.mkdir(codebasePath);

    const manager = new CodebaseConfigManager({ workspacePath });
    await manager.saveConfig(codebasePath, {
        rlmBslEnrichment: {
            mode: 'disabled',
            command: 'rlm-bsl-index',
            args: ['provider', 'export', '{codebasePath}', '--json'],
        },
    });

    const loaded = await manager.getConfig(codebasePath);

    assert.deepEqual(loaded?.rlmBslEnrichment, { mode: 'disabled' });
});
