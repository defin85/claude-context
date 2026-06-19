import {
    inferRetrievalProfile,
    isReducedOneCIndexScopeProfile,
    isRankingProfile,
} from '@zilliz/claude-context-core';
import type {
    CodebaseSessionConfig,
    OneCIndexScopeProfile,
    OneCIndexScopeSummary,
    RankingProfile,
    RetrievalMode,
    RetrievalProfile,
} from '@zilliz/claude-context-core';
import type { CodebaseInfo } from './config.js';

export type ProfileStateSource = 'environment' | 'request' | 'persisted-config' | 'collection-metadata' | 'default' | 'inferred' | 'runtime';
export type ProfileStateCompatibility = 'effective' | 'default-difference' | 'requires-force' | 'unknown' | 'inferred';
export type RetrievalShape = 'bge-m3-dense' | 'bge-m3-full' | 'hybrid-bm25' | 'dense' | 'unknown';

export interface RetrievalProfileState {
    configuredProfile?: RetrievalProfile;
    resolvedProfile?: RetrievalProfile;
    indexedProfile?: RetrievalProfile;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
    explicitProfile?: boolean;
    source: ProfileStateSource;
    compatibility?: ProfileStateCompatibility;
    shape: RetrievalShape;
    bgeM3?: {
        mode?: 'dense' | 'full';
        usesSparse?: boolean;
        usesColbert?: boolean;
    };
}

export interface OneCProfileState {
    profile?: OneCIndexScopeProfile;
    status: 'effective' | 'reduced-coverage' | 'unknown';
    source: ProfileStateSource;
    summary?: OneCIndexScopeSummary;
    warning?: string;
}

export interface RlmBslProfileState {
    mode: string;
    configured: boolean;
    commandConfigured: boolean;
    status: 'disabled' | 'enabled' | 'required' | 'partial' | 'unavailable' | 'failed' | 'unknown';
    provider?: string;
    providerSchemaVersion?: number;
    sourceRootMatchesCodebase?: boolean;
}

export interface DaemonProfileState {
    retrieval: RetrievalProfileState;
    accelerator?: {
        mode?: string;
        active?: boolean;
    };
    workers?: {
        managedAvailable: boolean;
        planned?: number;
        running?: number;
    };
}

export interface CodebaseProfileState {
    retrieval: RetrievalProfileState;
    oneCIndexScope: OneCProfileState;
    rlmBslEnrichment: RlmBslProfileState;
}

export interface SearchProfileState {
    ranking: {
        requestedProfile: RankingProfile;
        resolvedProfile: RankingProfile;
        source: 'request';
        oneCSignalsActive: boolean;
    };
}

export interface ProfileState {
    daemon?: DaemonProfileState;
    codebase?: CodebaseProfileState;
    search?: SearchProfileState;
}

interface DaemonRetrievalConfiguration {
    retrievalProfile?: RetrievalProfile;
    resolvedRetrievalProfile?: RetrievalProfile;
    explicitProfile?: boolean;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
    bgeM3Mode?: 'dense' | 'full';
    usesBgeM3Sparse?: boolean;
    usesColbert?: boolean;
}

interface OneCScopeStatus {
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
    oneCIndexScope?: OneCIndexScopeSummary;
    reducedCoverageWarning?: string;
}

interface RlmBslStatus {
    mode?: unknown;
    configured?: unknown;
    commandConfigured?: unknown;
    provider?: unknown;
    status?: unknown;
    rawStatus?: unknown;
    providerSchemaVersion?: unknown;
    sourceRootMatchesCodebase?: unknown;
}

export function createDaemonProfileState(
    retrievalConfiguration?: DaemonRetrievalConfiguration,
    accelerator?: { mode?: string; active?: boolean },
    managedBgeM3Workers?: { plannedEndpoints?: unknown[]; runningWorkers?: unknown[] } | null,
): ProfileState {
    return {
        daemon: {
            retrieval: createDaemonRetrievalState(retrievalConfiguration),
            ...(accelerator ? {
                accelerator: {
                    mode: accelerator.mode,
                    active: accelerator.active,
                },
            } : {}),
            ...(managedBgeM3Workers ? {
                workers: {
                    managedAvailable: true,
                    planned: Array.isArray(managedBgeM3Workers.plannedEndpoints) ? managedBgeM3Workers.plannedEndpoints.length : undefined,
                    running: Array.isArray(managedBgeM3Workers.runningWorkers) ? managedBgeM3Workers.runningWorkers.length : undefined,
                },
            } : {}),
        },
    };
}

export function createCodebaseProfileState(options: {
    config: CodebaseSessionConfig | null;
    info?: CodebaseInfo;
    oneCScopeStatus?: OneCScopeStatus;
    rlmBslEnrichmentStatus?: RlmBslStatus;
    daemonRetrievalConfiguration?: DaemonRetrievalConfiguration;
    retrievalCompatibility?: ProfileStateCompatibility;
}): ProfileState {
    return {
        codebase: {
            retrieval: createCodebaseRetrievalState(options.config, options.daemonRetrievalConfiguration, options.retrievalCompatibility),
            oneCIndexScope: createOneCProfileState(options.config, options.info, options.oneCScopeStatus),
            rlmBslEnrichment: createRlmBslProfileState(options.config, options.rlmBslEnrichmentStatus),
        },
    };
}

export function createSearchProfileState(options: {
    requestedRankingProfile: RankingProfile;
    resultMetadata?: unknown;
}): ProfileState {
    const metadata = options.resultMetadata && typeof options.resultMetadata === 'object'
        ? options.resultMetadata as Record<string, unknown>
        : {};
    const resolvedProfile = isRankingProfile(metadata.rankingProfile)
        ? metadata.rankingProfile
        : options.requestedRankingProfile;

    return {
        search: {
            ranking: {
                requestedProfile: options.requestedRankingProfile,
                resolvedProfile,
                source: 'request',
                oneCSignalsActive: resolvedProfile === 'one-c',
            },
        },
    };
}

export function mergeProfileState(...states: Array<ProfileState | undefined>): ProfileState {
    const merged: ProfileState = {};
    for (const state of states) {
        if (!state) {
            continue;
        }
        if (state.daemon) {
            merged.daemon = state.daemon;
        }
        if (state.codebase) {
            merged.codebase = state.codebase;
        }
        if (state.search) {
            merged.search = state.search;
        }
    }
    return merged;
}

function createDaemonRetrievalState(config?: DaemonRetrievalConfiguration): RetrievalProfileState {
    const retrievalMode = config?.retrievalMode;
    const resolvedProfile = config?.resolvedRetrievalProfile || config?.retrievalProfile || inferProfile(retrievalMode);

    return {
        configuredProfile: config?.retrievalProfile,
        resolvedProfile,
        retrievalMode,
        retrievalSchemaVersion: config?.retrievalSchemaVersion,
        explicitProfile: config?.explicitProfile,
        source: config?.explicitProfile ? 'environment' : 'default',
        compatibility: retrievalMode ? 'effective' : 'unknown',
        shape: inferShape(config),
        ...(retrievalMode?.startsWith('bge_m3') || config?.bgeM3Mode ? {
            bgeM3: {
                mode: config?.bgeM3Mode,
                usesSparse: Boolean(config?.usesBgeM3Sparse),
                usesColbert: Boolean(config?.usesColbert),
            },
        } : {}),
    };
}

function createCodebaseRetrievalState(
    config: CodebaseSessionConfig | null,
    daemonConfig?: DaemonRetrievalConfiguration,
    compatibilityOverride?: ProfileStateCompatibility,
): RetrievalProfileState {
    const retrievalMode = config?.retrievalMode;
    const indexedProfile = config?.retrievalProfile || inferProfile(retrievalMode);
    const source: ProfileStateSource = config?.retrievalProfile
        ? 'persisted-config'
        : retrievalMode ? 'inferred' : 'default';

    return {
        indexedProfile,
        retrievalMode,
        retrievalSchemaVersion: config?.retrievalSchemaVersion,
        source,
        compatibility: compatibilityOverride || classifyCompatibility(config, daemonConfig),
        shape: inferShape({
            retrievalMode,
        }),
    };
}

function classifyCompatibility(
    config: CodebaseSessionConfig | null,
    daemonConfig?: DaemonRetrievalConfiguration,
): ProfileStateCompatibility {
    if (!config?.retrievalMode) {
        return config ? 'inferred' : 'unknown';
    }
    if (!daemonConfig?.retrievalMode) {
        return 'unknown';
    }
    const daemonProfile = daemonConfig.resolvedRetrievalProfile
        || daemonConfig.retrievalProfile
        || inferProfile(daemonConfig.retrievalMode);
    if (config.retrievalProfile && daemonProfile && config.retrievalProfile !== daemonProfile) {
        return 'default-difference';
    }
    if (
        config.retrievalMode !== daemonConfig.retrievalMode ||
        (
            typeof config.retrievalSchemaVersion === 'number' &&
            typeof daemonConfig.retrievalSchemaVersion === 'number' &&
            config.retrievalSchemaVersion !== daemonConfig.retrievalSchemaVersion
        )
    ) {
        return 'default-difference';
    }
    return 'effective';
}

function createOneCProfileState(
    config: CodebaseSessionConfig | null,
    info?: CodebaseInfo,
    oneCScopeStatus?: OneCScopeStatus,
): OneCProfileState {
    const profile = oneCScopeStatus?.oneCIndexScopeProfile
        || (info && 'oneCIndexScopeProfile' in info ? info.oneCIndexScopeProfile : undefined)
        || config?.oneCIndexScopeProfile;
    const source: ProfileStateSource = oneCScopeStatus?.oneCIndexScopeProfile || config?.oneCIndexScopeProfile
        ? 'persisted-config'
        : profile ? 'inferred' : 'default';

    return {
        profile,
        status: profile ? (isReducedOneCIndexScopeProfile(profile) ? 'reduced-coverage' : 'effective') : 'unknown',
        source,
        summary: oneCScopeStatus?.oneCIndexScope || (info && 'oneCIndexScope' in info ? info.oneCIndexScope : undefined),
        warning: oneCScopeStatus?.reducedCoverageWarning || (info && 'reducedCoverageWarning' in info ? info.reducedCoverageWarning : undefined),
    };
}

function createRlmBslProfileState(
    config: CodebaseSessionConfig | null,
    status?: RlmBslStatus,
): RlmBslProfileState {
    const mode = stringify(status?.mode) || config?.rlmBslEnrichment?.mode || 'disabled';
    const configured = typeof status?.configured === 'boolean'
        ? status.configured
        : mode !== 'disabled';
    const rawStatus = stringify(status?.status) || stringify(status?.rawStatus);

    return {
        mode,
        configured,
        commandConfigured: typeof status?.commandConfigured === 'boolean'
            ? status.commandConfigured
            : Boolean(config?.rlmBslEnrichment?.command),
        status: normalizeRlmStatus(mode, rawStatus, configured),
        provider: stringify(status?.provider),
        providerSchemaVersion: typeof status?.providerSchemaVersion === 'number' ? status.providerSchemaVersion : undefined,
        sourceRootMatchesCodebase: typeof status?.sourceRootMatchesCodebase === 'boolean' ? status.sourceRootMatchesCodebase : undefined,
    };
}

function normalizeRlmStatus(mode: string, status: string | undefined, configured: boolean): RlmBslProfileState['status'] {
    if (!configured || mode === 'disabled') {
        return 'disabled';
    }
    if (status === 'required' || status === 'partial' || status === 'unavailable' || status === 'failed') {
        return status;
    }
    if (status === 'enabled' || status === 'complete' || status === 'ready') {
        return 'enabled';
    }
    return configured ? 'unknown' : 'disabled';
}

function inferProfile(retrievalMode: RetrievalMode | undefined): RetrievalProfile | undefined {
    return retrievalMode ? inferRetrievalProfile(retrievalMode) : undefined;
}

function inferShape(config?: { retrievalMode?: RetrievalMode; bgeM3Mode?: 'dense' | 'full'; usesBgeM3Sparse?: boolean; usesColbert?: boolean }): RetrievalShape {
    if (config?.retrievalMode === 'bge_m3_dense' || config?.bgeM3Mode === 'dense') {
        return 'bge-m3-dense';
    }
    if (config?.retrievalMode === 'bge_m3_full' || config?.bgeM3Mode === 'full' || config?.usesBgeM3Sparse || config?.usesColbert) {
        return 'bge-m3-full';
    }
    if (config?.retrievalMode === 'hybrid_bm25') {
        return 'hybrid-bm25';
    }
    if (config?.retrievalMode === 'dense') {
        return 'dense';
    }
    return 'unknown';
}

function stringify(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
