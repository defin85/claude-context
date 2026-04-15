import * as path from 'path';
import * as vscode from 'vscode';

const INDEXED_CODEBASE_PATH_KEY = 'semanticCodeSearch.indexedCodebasePath';

interface ResolveIndexedCodebaseOptions {
    promptIfMissing?: boolean;
    placeHolder?: string;
}

export class CodebaseTargetManager {
    constructor(private readonly extensionContext: vscode.ExtensionContext) {}

    private normalizeCodebasePath(codebasePath: string): string {
        return path.resolve(codebasePath);
    }

    getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
        return vscode.workspace.workspaceFolders || [];
    }

    getWorkspaceFolderForPath(codebasePath: string): vscode.WorkspaceFolder | undefined {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);
        return this.getWorkspaceFolders().find((folder) => this.normalizeCodebasePath(folder.uri.fsPath) === normalizedPath);
    }

    getIndexedCodebasePath(): string | undefined {
        const storedPath = this.extensionContext.workspaceState.get<string>(INDEXED_CODEBASE_PATH_KEY);
        if (!storedPath) {
            return undefined;
        }

        const normalizedPath = this.normalizeCodebasePath(storedPath);
        if (!this.getWorkspaceFolderForPath(normalizedPath)) {
            void this.clearIndexedCodebasePath();
            return undefined;
        }

        return normalizedPath;
    }

    async setIndexedCodebasePath(codebasePath: string): Promise<void> {
        const normalizedPath = this.normalizeCodebasePath(codebasePath);
        await this.extensionContext.workspaceState.update(INDEXED_CODEBASE_PATH_KEY, normalizedPath);
    }

    async clearIndexedCodebasePath(): Promise<void> {
        await this.extensionContext.workspaceState.update(INDEXED_CODEBASE_PATH_KEY, undefined);
    }

    async pickWorkspaceFolder(placeHolder: string, preferredCodebasePath?: string): Promise<vscode.WorkspaceFolder | undefined> {
        const workspaceFolders = this.getWorkspaceFolders();
        if (workspaceFolders.length === 0) {
            return undefined;
        }

        if (workspaceFolders.length === 1) {
            return workspaceFolders[0];
        }

        const normalizedPreferredPath = preferredCodebasePath
            ? this.normalizeCodebasePath(preferredCodebasePath)
            : undefined;

        const sortedFolders = [...workspaceFolders].sort((left, right) => {
            const leftPath = this.normalizeCodebasePath(left.uri.fsPath);
            const rightPath = this.normalizeCodebasePath(right.uri.fsPath);

            if (normalizedPreferredPath) {
                if (leftPath === normalizedPreferredPath) {
                    return -1;
                }
                if (rightPath === normalizedPreferredPath) {
                    return 1;
                }
            }

            return left.name.localeCompare(right.name);
        });

        const selected = await vscode.window.showQuickPick(
            sortedFolders.map((folder) => ({
                label: folder.name,
                description: folder.uri.fsPath,
                folder
            })),
            { placeHolder }
        );

        return selected?.folder;
    }

    async resolveIndexedCodebasePath(options: ResolveIndexedCodebaseOptions = {}): Promise<string | undefined> {
        const workspaceFolders = this.getWorkspaceFolders();
        if (workspaceFolders.length === 0) {
            return undefined;
        }

        const storedCodebasePath = this.getIndexedCodebasePath();
        if (storedCodebasePath) {
            return storedCodebasePath;
        }

        if (workspaceFolders.length === 1) {
            return workspaceFolders[0].uri.fsPath;
        }

        if (!options.promptIfMissing) {
            return undefined;
        }

        const pickedFolder = await this.pickWorkspaceFolder(
            options.placeHolder || 'Select indexed codebase'
        );
        return pickedFolder?.uri.fsPath;
    }
}
