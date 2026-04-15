import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodebaseConfigManager } from './codebase-config.js';
import { CodebaseAccessPolicy } from './access-policy.js';
import { SnapshotManager } from './snapshot.js';
import type {
    CodebaseInfo,
    CodebaseInfoIndexed,
    CodebaseInfoIndexFailed,
    CodebaseSnapshotV2
} from './config.js';

export interface WorkspaceToDaemonMigrationResult {
    importedCodebases: string[];
    importedConfigs: string[];
    skippedCodebases: string[];
}

interface ImportedCodebaseCandidate {
    codebasePath: string;
    info: CodebaseInfo;
}

interface ImportedConfigCandidate {
    codebasePath: string;
    customExtensions: string[];
    customIgnorePatterns: string[];
}

function getWorkspaceScopedMcpRoot(): string {
    return path.join(os.homedir(), '.context', 'mcp');
}

function isExistingCodebasePath(candidatePath: string): boolean {
    try {
        return fs.existsSync(candidatePath);
    } catch {
        return false;
    }
}

function isNewerCandidate(existing: ImportedCodebaseCandidate | undefined, nextInfo: CodebaseInfo): boolean {
    if (!existing) {
        return true;
    }

    return Date.parse(nextInfo.lastUpdated || '') >= Date.parse(existing.info.lastUpdated || '');
}

function sanitizeImportedInfo(codebasePath: string, info: CodebaseInfo): CodebaseInfo {
    if (info.status === 'indexing') {
        return {
            status: 'indexfailed',
            errorMessage:
                `Workspace-scoped indexing state for '${codebasePath}' was interrupted during daemon migration. ` +
                `Re-run index_codebase to resume with daemon-owned state.`,
            lastAttemptedPercentage: info.indexingPercentage,
            lastUpdated: info.lastUpdated
        };
    }

    return info;
}

export async function migrateWorkspaceStateToDaemon(
    snapshotManager: SnapshotManager,
    codebaseConfigManager: CodebaseConfigManager,
    accessPolicy: CodebaseAccessPolicy
): Promise<WorkspaceToDaemonMigrationResult> {
    const result: WorkspaceToDaemonMigrationResult = {
        importedCodebases: [],
        importedConfigs: [],
        skippedCodebases: []
    };

    if (accessPolicy.getMode() !== 'daemon') {
        return result;
    }

    const existingConfigs = await codebaseConfigManager.listConfiguredCodebases();
    if (snapshotManager.hasTrackedCodebases() || existingConfigs.length > 0) {
        return result;
    }

    const workspaceMcpRoot = getWorkspaceScopedMcpRoot();
    let entries: fs.Dirent[] = [];
    try {
        entries = await fs.promises.readdir(workspaceMcpRoot, { withFileTypes: true });
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return result;
        }
        throw error;
    }

    const importedCodebases = new Map<string, ImportedCodebaseCandidate>();
    const importedConfigs = new Map<string, ImportedConfigCandidate>();

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'daemon' || entry.name === 'runtime') {
            continue;
        }

        const snapshotPath = path.join(workspaceMcpRoot, entry.name, 'mcp-codebase-snapshot.json');
        try {
            const snapshot = JSON.parse(await fs.promises.readFile(snapshotPath, 'utf8')) as CodebaseSnapshotV2;
            if (snapshot?.formatVersion !== 'v2' || typeof snapshot.codebases !== 'object' || snapshot.codebases === null) {
                continue;
            }

            for (const [rawCodebasePath, rawInfo] of Object.entries(snapshot.codebases)) {
                const accessDecision = accessPolicy.evaluateCodebasePath(rawCodebasePath);
                if (!accessDecision.allowed || !isExistingCodebasePath(accessDecision.absolutePath)) {
                    result.skippedCodebases.push(accessDecision.absolutePath);
                    continue;
                }

                const sanitizedInfo = sanitizeImportedInfo(accessDecision.absolutePath, rawInfo as CodebaseInfo);
                const existingCandidate = importedCodebases.get(accessDecision.absolutePath);
                if (isNewerCandidate(existingCandidate, sanitizedInfo)) {
                    importedCodebases.set(accessDecision.absolutePath, {
                        codebasePath: accessDecision.absolutePath,
                        info: sanitizedInfo
                    });
                }
            }
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.warn(`[DAEMON-MIGRATION] Failed to inspect workspace snapshot '${snapshotPath}':`, error?.message || error);
            }
        }

        const configDir = path.join(workspaceMcpRoot, entry.name, 'codebase-session-config');
        let configEntries: fs.Dirent[] = [];
        try {
            configEntries = await fs.promises.readdir(configDir, { withFileTypes: true });
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.warn(`[DAEMON-MIGRATION] Failed to inspect workspace config dir '${configDir}':`, error?.message || error);
            }
        }

        for (const configEntry of configEntries) {
            if (!configEntry.isFile() || !configEntry.name.endsWith('.json')) {
                continue;
            }

            const configPath = path.join(configDir, configEntry.name);
            try {
                const payload = JSON.parse(await fs.promises.readFile(configPath, 'utf8')) as {
                    codebasePath?: string;
                    customExtensions?: string[];
                    customIgnorePatterns?: string[];
                };

                if (typeof payload.codebasePath !== 'string') {
                    continue;
                }

                const accessDecision = accessPolicy.evaluateCodebasePath(payload.codebasePath);
                if (!accessDecision.allowed || !isExistingCodebasePath(accessDecision.absolutePath)) {
                    result.skippedCodebases.push(accessDecision.absolutePath);
                    continue;
                }

                importedConfigs.set(accessDecision.absolutePath, {
                    codebasePath: accessDecision.absolutePath,
                    customExtensions: payload.customExtensions || [],
                    customIgnorePatterns: payload.customIgnorePatterns || []
                });
            } catch (error: any) {
                console.warn(`[DAEMON-MIGRATION] Failed to inspect workspace config '${configPath}':`, error?.message || error);
            }
        }
    }

    for (const configCandidate of importedConfigs.values()) {
        await codebaseConfigManager.saveConfig(configCandidate.codebasePath, {
            customExtensions: configCandidate.customExtensions,
            customIgnorePatterns: configCandidate.customIgnorePatterns
        });
        result.importedConfigs.push(configCandidate.codebasePath);
    }

    for (const candidate of importedCodebases.values()) {
        const info = candidate.info;
        if (info.status === 'indexed') {
            const indexedInfo = info as CodebaseInfoIndexed;
            if (
                indexedInfo.statsState !== 'unknown'
                && typeof indexedInfo.indexedFiles === 'number'
                && typeof indexedInfo.totalChunks === 'number'
            ) {
                snapshotManager.setCodebaseIndexed(candidate.codebasePath, {
                    indexedFiles: indexedInfo.indexedFiles,
                    totalChunks: indexedInfo.totalChunks,
                    status: indexedInfo.indexStatus
                });
            } else {
                snapshotManager.setCodebaseIndexedWithoutStats(candidate.codebasePath, indexedInfo.indexStatus);
            }
        } else if (info.status === 'indexfailed') {
            const failedInfo = info as CodebaseInfoIndexFailed;
            snapshotManager.setCodebaseIndexFailed(
                candidate.codebasePath,
                failedInfo.errorMessage,
                failedInfo.lastAttemptedPercentage
            );
        }

        result.importedCodebases.push(candidate.codebasePath);
    }

    if (result.importedCodebases.length > 0) {
        await snapshotManager.saveCodebaseSnapshot('daemon-workspace-migration');
    }

    return result;
}
