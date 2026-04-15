import { SemanticSearchResult } from '@zilliz/claude-context-core';

export type ConfiguredRuntimeMode = 'auto' | 'embedded' | 'daemon';
export type ActiveRuntimeMode = 'embedded' | 'daemon';
export type BackendSplitterType = 'ast' | 'langchain';

export interface BackendProgressInfo {
    percentage: number;
    phase: string;
    current: number;
    total: number;
}

export interface BackendIndexStatus {
    path: string;
    status: 'indexed' | 'indexing' | 'indexfailed' | 'not_found';
    recoveredFromCloud?: boolean;
    hasPersistedSyncConfig?: boolean;
    progressPercentage?: number;
    indexedFiles?: number;
    totalChunks?: number;
    indexStatus?: 'completed' | 'limit_reached';
    errorMessage?: string;
    lastUpdated?: string;
    lastAttemptedPercentage?: number;
}

export interface BackendIndexResult {
    mode: ActiveRuntimeMode;
    indexedFiles?: number;
    totalChunks?: number;
    status?: 'completed' | 'limit_reached';
    startedImmediately?: boolean;
    queuePosition?: number;
}

export interface BackendSyncResult {
    mode: ActiveRuntimeMode;
    added: number;
    removed: number;
    modified: number;
    daemonManaged?: boolean;
    message?: string;
}

export interface CodeSearchBackend {
    readonly mode: ActiveRuntimeMode;
    hasIndex(codebasePath: string): Promise<boolean>;
    getIndexStatus(codebasePath: string): Promise<BackendIndexStatus>;
    search(
        codebasePath: string,
        searchTerm: string,
        limit: number,
        fileExtensions?: string[]
    ): Promise<SemanticSearchResult[]>;
    indexCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendIndexResult>;
    clearIndex(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<void>;
    syncCodebase(
        codebasePath: string,
        onProgress?: (progress: BackendProgressInfo) => void
    ): Promise<BackendSyncResult>;
}
