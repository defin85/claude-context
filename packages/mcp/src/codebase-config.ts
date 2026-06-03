import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodebaseSessionConfig } from '@zilliz/claude-context-core';
import { normalizeCodebasePath } from './utils.js';

interface PersistedCodebaseSessionConfig extends CodebaseSessionConfig {
    formatVersion: 'v1';
    codebasePath: string;
    lastUpdated: string;
}

interface CodebaseConfigManagerOptions {
    workspacePath?: string;
    scope?: 'workspace' | 'daemon';
}

export class CodebaseConfigManager {
    private readonly workspacePath: string;
    private readonly configDirectoryPath: string;
    private readonly scope: 'workspace' | 'daemon';

    constructor(options: CodebaseConfigManagerOptions = {}) {
        this.workspacePath = path.resolve(options.workspacePath || process.cwd());
        this.scope = options.scope || 'workspace';

        if (this.scope === 'daemon') {
            this.configDirectoryPath = path.join(
                os.homedir(),
                '.context',
                'mcp',
                'daemon',
                'codebase-session-config'
            );
            return;
        }

        const workspaceHash = crypto
            .createHash('sha256')
            .update(this.workspacePath)
            .digest('hex')
            .slice(0, 16);

        this.configDirectoryPath = path.join(
            os.homedir(),
            '.context',
            'mcp',
            workspaceHash,
            'codebase-session-config'
        );
    }

    private getConfigPath(codebasePath: string): string {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        return path.join(this.configDirectoryPath, `${hash}.json`);
    }

    private normalizeSessionConfig(config: CodebaseSessionConfig): CodebaseSessionConfig {
        return {
            customExtensions: [...new Set((config.customExtensions || []).map((ext: string) => {
                const trimmed = ext.trim();
                return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
            }).filter((ext: string) => ext.length > 1))],
            customIgnorePatterns: [...new Set((config.customIgnorePatterns || []).map((pattern: string) => pattern.trim()).filter(Boolean))],
            ...(config.retrievalMode && { retrievalMode: config.retrievalMode }),
            ...(typeof config.retrievalSchemaVersion === 'number' && { retrievalSchemaVersion: config.retrievalSchemaVersion })
        };
    }

    public async hasConfig(codebasePath: string): Promise<boolean> {
        try {
            await fs.promises.access(this.getConfigPath(codebasePath));
            return true;
        } catch {
            return false;
        }
    }

    public async getConfig(codebasePath: string): Promise<CodebaseSessionConfig | null> {
        const configPath = this.getConfigPath(codebasePath);

        try {
            const raw = await fs.promises.readFile(configPath, 'utf8');
            const parsed = JSON.parse(raw) as PersistedCodebaseSessionConfig;
            const normalizedPath = normalizeCodebasePath(codebasePath);

            if (parsed?.formatVersion !== 'v1' || normalizeCodebasePath(parsed.codebasePath) !== normalizedPath) {
                console.warn(`[CODEBASE-CONFIG] Ignoring incompatible persisted config at ${configPath}`);
                return null;
            }

            return this.normalizeSessionConfig(parsed);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.warn(`[CODEBASE-CONFIG] Failed to read persisted config for '${codebasePath}':`, error.message || error);
            }
            return null;
        }
    }

    public async saveConfig(codebasePath: string, config: CodebaseSessionConfig): Promise<void> {
        const normalizedPath = normalizeCodebasePath(codebasePath);
        const normalizedConfig = this.normalizeSessionConfig(config);
        const configPath = this.getConfigPath(normalizedPath);
        const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;

        await fs.promises.mkdir(this.configDirectoryPath, { recursive: true });

        const payload: PersistedCodebaseSessionConfig = {
            formatVersion: 'v1',
            codebasePath: normalizedPath,
            lastUpdated: new Date().toISOString(),
            customExtensions: normalizedConfig.customExtensions || [],
            customIgnorePatterns: normalizedConfig.customIgnorePatterns || [],
            ...(normalizedConfig.retrievalMode && { retrievalMode: normalizedConfig.retrievalMode }),
            ...(typeof normalizedConfig.retrievalSchemaVersion === 'number' && { retrievalSchemaVersion: normalizedConfig.retrievalSchemaVersion })
        };

        await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2));
        await fs.promises.rename(tempPath, configPath);
    }

    public async removeConfig(codebasePath: string): Promise<void> {
        try {
            await fs.promises.unlink(this.getConfigPath(codebasePath));
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    public async listConfiguredCodebases(): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(this.configDirectoryPath, { withFileTypes: true });
            const configuredCodebases: string[] = [];

            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith('.json')) {
                    continue;
                }

                try {
                    const raw = await fs.promises.readFile(path.join(this.configDirectoryPath, entry.name), 'utf8');
                    const parsed = JSON.parse(raw) as PersistedCodebaseSessionConfig;
                    if (parsed?.formatVersion === 'v1' && typeof parsed.codebasePath === 'string') {
                        configuredCodebases.push(normalizeCodebasePath(parsed.codebasePath));
                    }
                } catch (error: any) {
                    console.warn(`[CODEBASE-CONFIG] Failed to inspect persisted config '${entry.name}':`, error.message || error);
                }
            }

            return [...new Set(configuredCodebases)];
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.warn('[CODEBASE-CONFIG] Failed to list persisted codebase configs:', error.message || error);
            }
            return [];
        }
    }
}
