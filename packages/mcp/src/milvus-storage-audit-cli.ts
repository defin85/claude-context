#!/usr/bin/env node

import { MilvusVectorDatabase } from '@zilliz/claude-context-core';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodebaseConfigManager } from './codebase-config.js';
import { createMcpConfig } from './config.js';
import type { CodebaseInfo, CodebaseSnapshotV2 } from './config.js';
import {
    createDryRunReclaimPlan,
    createLocalMilvusStorageAuditReport,
    executeConfirmedReclaimPlan,
} from './milvus-storage-audit.js';
import { SnapshotManager } from './snapshot.js';

interface CliOptions {
    json: boolean;
    includeRowCounts: boolean;
    includeLocalVolume: boolean;
    localVolumePath?: string;
    dryRunReclaimPath?: string;
    reclaimPath?: string;
    confirmReclaim: boolean;
    scope: 'daemon' | 'workspace';
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
console.log = (...args: unknown[]) => {
    process.stderr.write(`[LOG] ${args.join(' ')}\n`);
};
console.warn = (...args: unknown[]) => {
    process.stderr.write(`[WARN] ${args.join(' ')}\n`);
};

function usage(): string {
    return `Usage:
  pnpm --filter @zilliz/claude-context-mcp exec tsx src/milvus-storage-audit-cli.ts [options]

Options:
  --json                       Print structured JSON. This is the default output.
  --no-row-counts              Skip collection row count queries.
  --no-local-volume            Skip local filesystem volume size summary.
  --local-volume-path <path>   Override local Milvus volume path.
  --dry-run-reclaim <path>     Include a dry-run reclaim plan for a codebase path.
  --reclaim <path>             Reclaim a codebase index after --confirm-reclaim.
  --confirm-reclaim            Required with --reclaim; drops Milvus collections and updates snapshot/config.
  --scope <daemon|workspace>   Snapshot/config scope to inspect (default: daemon).
  --help                       Show this help.
`;
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        json: true,
        includeRowCounts: true,
        includeLocalVolume: true,
        confirmReclaim: false,
        scope: 'daemon',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        const next = () => {
            const value = argv[index + 1];
            if (!value) {
                throw new Error(`Missing value for ${current}`);
            }
            index += 1;
            return value;
        };

        if (current === '--json') {
            options.json = true;
        } else if (current === '--no-row-counts') {
            options.includeRowCounts = false;
        } else if (current === '--no-local-volume') {
            options.includeLocalVolume = false;
        } else if (current === '--local-volume-path') {
            options.localVolumePath = next();
        } else if (current === '--dry-run-reclaim') {
            options.dryRunReclaimPath = next();
        } else if (current === '--reclaim') {
            options.reclaimPath = next();
        } else if (current === '--confirm-reclaim') {
            options.confirmReclaim = true;
        } else if (current === '--scope') {
            const scope = next();
            if (scope !== 'daemon' && scope !== 'workspace') {
                throw new Error('--scope must be daemon or workspace.');
            }
            options.scope = scope;
        } else if (current === '--help' || current === '-h') {
            originalStdoutWrite(usage());
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${current}`);
        }
    }

    if (options.reclaimPath && !options.confirmReclaim) {
        throw new Error('--reclaim requires --confirm-reclaim. Use --dry-run-reclaim first to inspect the plan.');
    }

    return options;
}

function getSnapshotFilePath(scope: 'daemon' | 'workspace', workspacePath: string): string {
    if (scope === 'daemon') {
        return path.join(os.homedir(), '.context', 'mcp', 'daemon', 'mcp-codebase-snapshot.json');
    }

    const workspaceHash = crypto
        .createHash('sha256')
        .update(workspacePath)
        .digest('hex')
        .slice(0, 16);
    return path.join(os.homedir(), '.context', 'mcp', workspaceHash, 'mcp-codebase-snapshot.json');
}

function readSnapshotInfoReadOnly(snapshotPath: string): Record<string, CodebaseInfo> {
    try {
        const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as CodebaseSnapshotV2;
        if (parsed?.formatVersion === 'v2' && parsed.codebases && typeof parsed.codebases === 'object') {
            return parsed.codebases;
        }
    } catch (error) {
        console.warn(`[MILVUS-STORAGE-AUDIT] Failed to read snapshot '${snapshotPath}': ${error instanceof Error ? error.message : String(error)}`);
    }
    return {};
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const config = createMcpConfig();
    const runtimeWorkspacePath = options.scope === 'daemon'
        ? path.join(os.homedir(), '.context', 'mcp', 'daemon')
        : process.cwd();

    const vectorDatabase = new MilvusVectorDatabase({
        address: config.milvusAddress,
        ...(config.milvusToken && { token: config.milvusToken }),
    });
    const snapshotPath = getSnapshotFilePath(options.scope, runtimeWorkspacePath);
    const snapshotInfo = readSnapshotInfoReadOnly(snapshotPath);
    const codebaseConfigManager = new CodebaseConfigManager({
        workspacePath: runtimeWorkspacePath,
        scope: options.scope,
    });

    const report = await createLocalMilvusStorageAuditReport({
        vectorDatabase,
        snapshotManager: {
            getAllCodebaseInfo: () => snapshotInfo,
        },
        codebaseConfigManager,
    }, {
        includeRowCounts: options.includeRowCounts,
        includeLocalVolume: options.includeLocalVolume,
        localVolumePath: options.localVolumePath,
    });

    const dryRunPath = options.reclaimPath || options.dryRunReclaimPath;
    const dryRunReclaim = dryRunPath ? createDryRunReclaimPlan(report, dryRunPath) : undefined;
    let reclaimResult = undefined;

    if (options.reclaimPath && dryRunReclaim) {
        const mutatingSnapshotManager = new SnapshotManager({
            workspacePath: runtimeWorkspacePath,
            scope: options.scope,
        });
        mutatingSnapshotManager.loadCodebaseSnapshot();
        reclaimResult = await executeConfirmedReclaimPlan(dryRunReclaim, {
            vectorDatabase,
            snapshotManager: mutatingSnapshotManager,
            codebaseConfigManager,
        }, {
            confirm: options.confirmReclaim,
        });
    }

    const payload = {
        report,
        ...(dryRunReclaim ? {
            dryRunReclaim,
        } : {}),
        ...(reclaimResult ? { reclaimResult } : {}),
    };

    if (options.json) {
        originalStdoutWrite(`${JSON.stringify(payload, null, 2)}\n`);
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
});
