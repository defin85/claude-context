import { promises as fs } from 'node:fs';
import path from 'node:path';

import { SnapshotManager } from '../packages/mcp/src/snapshot.ts';

async function waitForFile(filePath: string, timeoutMs: number = 10000): Promise<void> {
    const startedAt = Date.now();

    while (true) {
        try {
            await fs.access(filePath);
            return;
        } catch {
            if ((Date.now() - startedAt) >= timeoutMs) {
                throw new Error(`Timed out waiting for file: ${filePath}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    if (!command) {
        throw new Error('Missing worker command');
    }

    switch (command) {
        case 'acquire-hold': {
            const [workspacePath, codebasePath, readyFile, releaseFile, resultFile, runtimeId] = args;
            const manager = new SnapshotManager({ workspacePath, saveDebounceMs: 0, runtimeId });
            manager.loadCodebaseSnapshot();

            const claim = await manager.acquireIndexingOwnership(codebasePath, 1);
            await writeJson(resultFile, claim);
            await fs.writeFile(readyFile, 'ready');
            await waitForFile(releaseFile);
            return;
        }

        case 'acquire-once': {
            const [workspacePath, codebasePath, resultFile, runtimeId] = args;
            const manager = new SnapshotManager({ workspacePath, saveDebounceMs: 0, runtimeId });
            manager.loadCodebaseSnapshot();

            const claim = await manager.acquireIndexingOwnership(codebasePath, 1);
            await writeJson(resultFile, claim);
            return;
        }

        case 'load-and-touch-after-signal': {
            const [workspacePath, codebasePath, readyFile, releaseFile, resultFile] = args;
            const manager = new SnapshotManager({ workspacePath, saveDebounceMs: 0 });
            manager.loadCodebaseSnapshot();

            await fs.writeFile(readyFile, 'ready');
            await waitForFile(releaseFile);

            manager.touchCodebaseIndexed(codebasePath);
            await manager.saveCodebaseSnapshot('worker-touch');
            await writeJson(resultFile, {
                status: manager.getCodebaseStatus(codebasePath)
            });
            return;
        }

        case 'remove-and-save': {
            const [workspacePath, codebasePath, resultFile] = args;
            const manager = new SnapshotManager({ workspacePath, saveDebounceMs: 0 });
            manager.loadCodebaseSnapshot();

            manager.removeCodebaseCompletely(codebasePath);
            await manager.saveCodebaseSnapshot('worker-remove');
            await writeJson(resultFile, {
                status: manager.getCodebaseStatus(codebasePath)
            });
            return;
        }

        default:
            throw new Error(`Unknown worker command: ${command}`);
    }
}

void main().catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
});
