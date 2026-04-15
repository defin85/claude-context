import * as vscode from 'vscode';
import { CodebaseTargetManager } from '../codebaseTargetManager';
import { CodeSearchBackend } from '../backend/types';

export class IndexCommand {
    private backend: CodeSearchBackend;
    private codebaseTargetManager: CodebaseTargetManager;

    constructor(backend: CodeSearchBackend, codebaseTargetManager: CodebaseTargetManager) {
        this.backend = backend;
        this.codebaseTargetManager = codebaseTargetManager;
    }

    /**
     * Update the backend instance (used when configuration changes)
     */
    updateBackend(backend: CodeSearchBackend): void {
        this.backend = backend;
    }

    async execute(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
            return;
        }

        const selectedFolder = await this.codebaseTargetManager.pickWorkspaceFolder(
            'Select folder to index',
            this.codebaseTargetManager.getIndexedCodebasePath()
        );
        if (!selectedFolder) {
            return;
        }

        const confirm = await vscode.window.showInformationMessage(
            `Index codebase at: ${selectedFolder.uri.fsPath}?\n\nThis will create embeddings for all supported code files.`,
            'Yes',
            'Cancel'
        );

        if (confirm !== 'Yes') {
            return;
        }

        try {
            let indexStats:
                | {
                    indexedFiles?: number;
                    totalChunks?: number;
                    status?: 'completed' | 'limit_reached';
                }
                | undefined;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing Codebase',
                cancellable: false
            }, async (progress) => {
                let lastPercentage = 0;
                indexStats = await this.backend.indexCodebase(
                    selectedFolder.uri.fsPath,
                    (progressInfo) => {
                        const boundedPercentage = Math.max(0, Math.min(100, progressInfo.percentage));
                        const increment = Math.max(0, boundedPercentage - lastPercentage);
                        lastPercentage = boundedPercentage;
                        progress.report({
                            increment: increment,
                            message: progressInfo.phase
                        });
                    }
                );
            });

            if (indexStats) {
                await this.codebaseTargetManager.setIndexedCodebasePath(selectedFolder.uri.fsPath);
                const { indexedFiles, totalChunks, status } = indexStats;
                if (status === 'limit_reached') {
                    vscode.window.showWarningMessage(
                        `⚠️ Indexing paused. Reached chunk limit of 450,000.\n\nIndexed ${indexedFiles} files with ${totalChunks} code chunks.`
                    );
                } else if (typeof indexedFiles === 'number' && typeof totalChunks === 'number') {
                    vscode.window.showInformationMessage(
                        `✅ Indexing complete!\n\nIndexed ${indexedFiles} files with ${totalChunks} code chunks.\n\nYou can now use semantic search.`
                    );
                } else {
                    vscode.window.showInformationMessage(
                        `✅ Indexing complete!\n\nThe daemon reported that indexing finished successfully.`
                    );
                }
            }

        } catch (error: any) {
            console.error('Indexing failed:', error);
            const errorString = typeof error === 'string' ? error : (error.message || error.toString() || '');

            // Check for collection limit message from the core library
            if (errorString.includes('collection limit') || errorString.includes('zilliz.com/pricing')) {
                const message = 'Your Zilliz Cloud account has hit its collection limit. To continue creating collections, you\'ll need to expand your capacity. We recommend visiting https://zilliz.com/pricing to explore options for dedicated or serverless clusters.';
                const openButton = 'Explore Pricing Options';

                vscode.window.showErrorMessage(message, { modal: true }, openButton).then(selection => {
                    if (selection === openButton) {
                        vscode.env.openExternal(vscode.Uri.parse('https://zilliz.com/pricing'));
                    }
                });
            } else {
                vscode.window.showErrorMessage(`❌ Indexing failed: ${errorString}`);
            }
        }
    }

    async clearIndex(): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
                return;
            }

            const codebasePath = await this.codebaseTargetManager.resolveIndexedCodebasePath({
                promptIfMissing: true,
                placeHolder: 'Select indexed folder to clear'
            });
            if (!codebasePath) {
                vscode.window.showErrorMessage('No indexed codebase selected.');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Clear indexed data for '${codebasePath}'?`,
                'Yes',
                'Cancel'
            );

            if (confirm !== 'Yes') {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Clearing Index',
                cancellable: false
            }, async (progress) => {
                await this.backend.clearIndex(
                    codebasePath,
                    (progressInfo) => {
                        progress.report({
                            increment: progressInfo.percentage,
                            message: progressInfo.phase
                        });
                    }
                );
            });

            if (this.codebaseTargetManager.getIndexedCodebasePath() === codebasePath) {
                await this.codebaseTargetManager.clearIndexedCodebasePath();
            }
            vscode.window.showInformationMessage('✅ Index cleared successfully');
        } catch (error) {
            console.error('Failed to clear index:', error);
            vscode.window.showErrorMessage(`❌ Failed to clear index: ${error}`);
        }
    }


} 
