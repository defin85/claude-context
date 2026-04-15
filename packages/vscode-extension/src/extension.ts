import * as vscode from 'vscode';
import { ConfiguredCodeSearchBackend } from './backend/configuredBackend';
import { SearchCommand } from './commands/searchCommand';
import { IndexCommand } from './commands/indexCommand';
import { SyncCommand } from './commands/syncCommand';
import { CodebaseTargetManager } from './codebaseTargetManager';
import { ConfigManager } from './config/configManager';
import { SemanticSearchViewProvider } from './webview/semanticSearchProvider';

let semanticSearchProvider: SemanticSearchViewProvider;
let searchCommand: SearchCommand;
let indexCommand: IndexCommand;
let syncCommand: SyncCommand;
let configManager: ConfigManager;
let codebaseTargetManager: CodebaseTargetManager;
let codeSearchBackend: ConfiguredCodeSearchBackend;
let autoSyncDisposable: vscode.Disposable | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Context extension is now active!');

    configManager = new ConfigManager(context);
    codebaseTargetManager = new CodebaseTargetManager(context);
    codeSearchBackend = createCodeSearchBackend();

    searchCommand = new SearchCommand(codeSearchBackend, codebaseTargetManager);
    indexCommand = new IndexCommand(codeSearchBackend, codebaseTargetManager);
    syncCommand = new SyncCommand(codeSearchBackend, codebaseTargetManager);
    semanticSearchProvider = new SemanticSearchViewProvider(
        context.extensionUri,
        searchCommand,
        indexCommand,
        syncCommand,
        configManager,
        codebaseTargetManager
    );

    const disposables = [
        vscode.window.registerWebviewViewProvider(SemanticSearchViewProvider.viewType, semanticSearchProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }),

        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('semanticCodeSearch.embeddingProvider')
                || event.affectsConfiguration('semanticCodeSearch.milvus')
                || event.affectsConfiguration('semanticCodeSearch.splitter')
                || event.affectsConfiguration('semanticCodeSearch.runtime')
                || event.affectsConfiguration('semanticCodeSearch.autoSync')) {
                console.log('Context configuration changed, reloading...');
                reloadContextConfiguration();
            }
        }),

        vscode.commands.registerCommand('semanticCodeSearch.semanticSearch', () => {
            const editor = vscode.window.activeTextEditor;
            const selectedText = editor?.document.getText(editor.selection);
            return searchCommand.execute(selectedText);
        }),
        vscode.commands.registerCommand('semanticCodeSearch.indexCodebase', () => indexCommand.execute()),
        vscode.commands.registerCommand('semanticCodeSearch.clearIndex', () => indexCommand.clearIndex()),
        vscode.commands.registerCommand('semanticCodeSearch.reloadConfiguration', () => reloadContextConfiguration())
    ];

    context.subscriptions.push(...disposables);

    void setupAutoSync();
    void runInitialSync();
    void logResolvedRuntimeMode();

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(search) Context';
    statusBarItem.tooltip = 'Click to open semantic search';
    statusBarItem.command = 'semanticCodeSearch.semanticSearch';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
}

async function runInitialSync() {
    try {
        const resolvedMode = await codeSearchBackend.getResolvedMode();
        if (resolvedMode === 'daemon') {
            console.log('[STARTUP] Skipping extension-local startup sync because daemon manages background sync.');
            return;
        }

        console.log('[STARTUP] Running initial sync...');
        await syncCommand.executeSilent();
        console.log('[STARTUP] Initial sync completed');
    } catch (error) {
        console.error('[STARTUP] Initial sync failed:', error);
    }
}

async function setupAutoSync() {
    const config = vscode.workspace.getConfiguration('semanticCodeSearch');
    const autoSyncEnabled = config.get<boolean>('autoSync.enabled', true);
    const autoSyncInterval = config.get<number>('autoSync.intervalMinutes', 5);

    if (autoSyncDisposable) {
        autoSyncDisposable.dispose();
        autoSyncDisposable = null;
    }

    if (!autoSyncEnabled) {
        console.log('Auto-sync disabled');
        return;
    }

    const resolvedMode = await codeSearchBackend.getResolvedMode();
    if (resolvedMode === 'daemon') {
        console.log('Auto-sync timer disabled because daemon mode manages background sync.');
        return;
    }

    console.log(`Setting up auto-sync with ${autoSyncInterval} minute interval`);
    try {
        autoSyncDisposable = await syncCommand.startAutoSync(autoSyncInterval);
    } catch (error) {
        console.error('Failed to start auto-sync:', error);
        vscode.window.showErrorMessage(`Failed to start auto-sync: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

function createCodeSearchBackend(): ConfiguredCodeSearchBackend {
    return new ConfiguredCodeSearchBackend(configManager.getRuntimeMode(), configManager);
}

async function logResolvedRuntimeMode(): Promise<void> {
    try {
        const resolvedMode = await codeSearchBackend.getResolvedMode();
        console.log(`[RUNTIME] Semantic Code Search backend resolved to '${resolvedMode}' mode`);
    } catch (error) {
        console.warn('[RUNTIME] Failed to resolve active backend mode:', error);
    }
}

function reloadContextConfiguration() {
    console.log('Reloading Context configuration...');

    try {
        codeSearchBackend = createCodeSearchBackend();
        searchCommand.updateBackend(codeSearchBackend);
        indexCommand.updateBackend(codeSearchBackend);
        syncCommand.updateBackend(codeSearchBackend);
        semanticSearchProvider.updateCommands(searchCommand, indexCommand, syncCommand);

        void setupAutoSync();

        console.log('Context configuration reloaded successfully');
        vscode.window.showInformationMessage('Configuration reloaded successfully!');
        void logResolvedRuntimeMode();
    } catch (error) {
        console.error('Failed to reload Context configuration:', error);
        vscode.window.showErrorMessage(`Failed to reload configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function deactivate() {
    console.log('Context extension is now deactivated');

    if (autoSyncDisposable) {
        autoSyncDisposable.dispose();
        autoSyncDisposable = null;
    }
}
