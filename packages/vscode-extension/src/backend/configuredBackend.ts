import { ConfigManager } from '../config/configManager';
import { DaemonCodeSearchBackend } from './daemonBackend';
import { EmbeddedCodeSearchBackend } from './embeddedBackend';
import {
    BackendIndexResult,
    BackendIndexStatus,
    BackendProgressInfo,
    BackendSyncResult,
    CodeSearchBackend,
    ConfiguredRuntimeMode
} from './types';
import { SemanticSearchResult } from '@zilliz/claude-context-core';

export class ConfiguredCodeSearchBackend implements CodeSearchBackend {
    private readonly embeddedBackend: EmbeddedCodeSearchBackend;
    private readonly daemonBackend: DaemonCodeSearchBackend;

    constructor(
        private readonly configuredMode: ConfiguredRuntimeMode,
        configManager: ConfigManager
    ) {
        this.embeddedBackend = new EmbeddedCodeSearchBackend(configManager);
        this.daemonBackend = new DaemonCodeSearchBackend(configManager);
    }

    public get mode() {
        return this.configuredMode === 'daemon' ? 'daemon' : 'embedded';
    }

    public async hasIndex(codebasePath: string): Promise<boolean> {
        return (await this.resolveBackend()).hasIndex(codebasePath);
    }

    public async getIndexStatus(codebasePath: string): Promise<BackendIndexStatus> {
        return (await this.resolveBackend()).getIndexStatus(codebasePath);
    }

    public async search(
        codebasePath: string,
        searchTerm: string,
        limit: number,
        fileExtensions: string[] = []
    ): Promise<SemanticSearchResult[]> {
        return (await this.resolveBackend()).search(codebasePath, searchTerm, limit, fileExtensions);
    }

    public async indexCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendIndexResult> {
        return (await this.resolveBackend()).indexCodebase(codebasePath, onProgress);
    }

    public async clearIndex(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<void> {
        return (await this.resolveBackend()).clearIndex(codebasePath, onProgress);
    }

    public async syncCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendSyncResult> {
        return (await this.resolveBackend()).syncCodebase(codebasePath, onProgress);
    }

    public async getResolvedMode(): Promise<'embedded' | 'daemon'> {
        return (await this.resolveBackend()).mode;
    }

    private async resolveBackend(): Promise<CodeSearchBackend> {
        if (this.configuredMode === 'embedded') {
            return this.embeddedBackend;
        }

        if (this.configuredMode === 'daemon') {
            return this.daemonBackend;
        }

        return (await this.daemonBackend.isAvailable())
            ? this.daemonBackend
            : this.embeddedBackend;
    }
}
