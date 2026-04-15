import * as vscode from 'vscode';
import { SearchQuery, SemanticSearchResult } from '@zilliz/claude-context-core';
import * as path from 'path';
import { CodebaseTargetManager } from '../codebaseTargetManager';
import { CodeSearchBackend } from '../backend/types';

export class SearchCommand {
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

    async execute(preSelectedText?: string): Promise<void> {
        let searchTerm: string | undefined;

        // Check if we have meaningful pre-selected text
        const trimmedPreSelectedText = preSelectedText?.trim();
        if (trimmedPreSelectedText && trimmedPreSelectedText.length > 0) {
            // Use the pre-selected text directly
            searchTerm = trimmedPreSelectedText;
        } else {
            // Show input box if no meaningful pre-selected text
            searchTerm = await vscode.window.showInputBox({
                placeHolder: 'Enter search term...',
                prompt: 'Search for functions, classes, variables, or any code using semantic search'
            });
        }

        if (!searchTerm) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Searching...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Performing semantic search...' });

                const codebasePath = await this.codebaseTargetManager.resolveIndexedCodebasePath({
                    promptIfMissing: true,
                    placeHolder: 'Select indexed folder to search'
                });
                if (!codebasePath) {
                    vscode.window.showErrorMessage('No indexed codebase selected.');
                    return;
                }

                // Check if index exists
                progress.report({ increment: 20, message: 'Checking index...' });
                const hasIndex = await this.backend.hasIndex(codebasePath);

                if (!hasIndex) {
                    vscode.window.showErrorMessage('Index not found. Please index the codebase first.');
                    return;
                }

                // Optionally prompt for file extension filters
                const extensionInput = await vscode.window.showInputBox({
                    placeHolder: 'Optional: filter by file extensions (e.g. .ts,.py,.java) – leave empty for all',
                    prompt: 'Enter a comma-separated list of file extensions to include',
                    value: ''
                });

                const fileExtensions = (extensionInput || '')
                    .split(',')
                    .map(e => e.trim())
                    .filter(Boolean);

                // Validate extensions strictly
                if (fileExtensions.length > 0) {
                    const invalid = fileExtensions.filter(e => !(e.startsWith('.') && e.length > 1 && !/\s/.test(e)));
                    if (invalid.length > 0) {
                        vscode.window.showErrorMessage(`Invalid extensions: ${invalid.join(', ')}. Use proper extensions like '.ts', '.py'.`);
                        return;
                    }
                }

                // Use semantic search
                const query: SearchQuery = {
                    term: searchTerm,
                    includeContent: true,
                    limit: 20
                };

                console.log('🔍 Using semantic search...');
                progress.report({ increment: 50, message: 'Executing semantic search...' });

                let results = await this.backend.search(
                    codebasePath,
                    query.term,
                    query.limit || 20,
                    fileExtensions
                );
                // No client-side filtering; filter pushed down via filter expression

                progress.report({ increment: 100, message: 'Search complete!' });

                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No results found for "${searchTerm}"`);
                    return;
                }

                // Generate quick pick items for VS Code
                const quickPickItems = this.generateQuickPickItems(results, searchTerm, codebasePath);

                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: `Found ${results.length} results for "${searchTerm}" using semantic search`,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected) {
                    await this.openResult(selected.result, selected.codebasePath);
                }
            });

        } catch (error) {
            console.error('Search failed:', error);
            vscode.window.showErrorMessage(`Search failed: ${error}. Please ensure the codebase is indexed.`);
        }
    }

    private async openResult(result: SemanticSearchResult, codebasePath: string): Promise<void> {
        try {
            let fullPath = result.relativePath;
            if (!result.relativePath.startsWith('/') && !result.relativePath.includes(':')) {
                fullPath = path.join(codebasePath, result.relativePath);
            }

            const document = await vscode.workspace.openTextDocument(fullPath);
            const editor = await vscode.window.showTextDocument(document);

            // Navigate to the location
            const line = Math.max(0, result.startLine - 1); // Convert to 0-based line numbers
            const column = 0;

            const position = new vscode.Position(line, column);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

        } catch (error) {
            console.error('Failed to open result:', error);
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    }

    /**
     * Execute search for webview (without UI prompts)
     */
    async executeForWebview(
        searchTerm: string,
        limit: number = 50,
        fileExtensions: string[] = []
    ): Promise<{ codebasePath: string; results: SemanticSearchResult[] }> {
        const codebasePath = await this.codebaseTargetManager.resolveIndexedCodebasePath({
            promptIfMissing: true,
            placeHolder: 'Select indexed folder to search'
        });
        if (!codebasePath) {
            throw new Error('No indexed codebase selected. Please index a folder first.');
        }

        // Check if index exists
        const hasIndex = await this.backend.hasIndex(codebasePath);
        if (!hasIndex) {
            throw new Error('Index not found. Please index the codebase first.');
        }

        console.log('🔍 Using semantic search for webview...');

        // Validate extensions strictly
        if (fileExtensions && fileExtensions.length > 0) {
            const invalid = fileExtensions.filter(e => !(typeof e === 'string' && e.startsWith('.') && e.length > 1 && !/\s/.test(e)));
            if (invalid.length > 0) {
                throw new Error(`Invalid extensions: ${invalid.join(', ')}. Use proper extensions like '.ts', '.py'.`);
            }
        }

        const results = await this.backend.search(
            codebasePath,
            searchTerm,
            limit,
            fileExtensions
        );
        return {
            codebasePath,
            results
        };
    }

    /**
     * Check if index exists for the given codebase path
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        try {
            return await this.backend.hasIndex(codebasePath);
        } catch (error) {
            console.error('Error checking index existence:', error);
            return false;
        }
    }

    async getIndexStatus(codebasePath: string) {
        try {
            return await this.backend.getIndexStatus(codebasePath);
        } catch (error) {
            console.error('Error checking index existence:', error);
            return {
                path: codebasePath,
                status: 'not_found' as const
            };
        }
    }

    /**
     * Generate quick pick items for VS Code
     */
    private generateQuickPickItems(results: SemanticSearchResult[], searchTerm: string, codebasePath: string) {
        return results.slice(0, 20).map((result, index) => {
            let displayPath = result.relativePath;
            // Truncate content for display
            const truncatedContent = result.content.length <= 150
                ? result.content
                : result.content.substring(0, 150) + '...';

            // Add rank info to description
            const rankText = ` (rank: ${index + 1})`;

            return {
                label: `$(file-code) ${displayPath}`,
                description: `$(search) semantic search${rankText}`,
                detail: truncatedContent,
                result: result,
                codebasePath
            };
        });
    }
}
