import * as path from 'node:path';
import { normalizeCodebasePath } from './utils.js';

export type McpRuntimeMode = 'stdio' | 'daemon';

export interface CodebaseAccessDecision {
    allowed: boolean;
    absolutePath: string;
    matchedRoot?: string;
    reason?: string;
}

interface CodebaseAccessPolicyOptions {
    mode: McpRuntimeMode;
    allowedRoots?: string[];
}

export class CodebaseAccessPolicy {
    private readonly mode: McpRuntimeMode;
    private readonly allowedRoots: string[];

    constructor(options: CodebaseAccessPolicyOptions) {
        this.mode = options.mode;
        this.allowedRoots = [...new Set((options.allowedRoots || []).map((root) => normalizeCodebasePath(root)))];
    }

    public getMode(): McpRuntimeMode {
        return this.mode;
    }

    public getAllowedRoots(): string[] {
        return [...this.allowedRoots];
    }

    public evaluateCodebasePath(inputPath: string): CodebaseAccessDecision {
        const absolutePath = normalizeCodebasePath(inputPath);

        if (this.mode !== 'daemon') {
            return {
                allowed: true,
                absolutePath
            };
        }

        const matchedRoot = this.allowedRoots.find((root) => this.isWithinRoot(absolutePath, root));
        if (matchedRoot) {
            return {
                allowed: true,
                absolutePath,
                matchedRoot
            };
        }

        return {
            allowed: false,
            absolutePath,
            reason: this.allowedRoots.length === 0
                ? 'daemon allowlist is empty'
                : `path is outside daemon allowlist: ${this.allowedRoots.join(', ')}`
        };
    }

    private isWithinRoot(targetPath: string, rootPath: string): boolean {
        const relativePath = path.relative(rootPath, targetPath);
        return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    }
}
