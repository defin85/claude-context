export type RankingProfile = 'auto' | 'generic' | 'one-c';

export interface RetrievalContext {
    retrievalProfile?: string;
    retrievalMode?: string;
    retrievalSchemaVersion?: number;
    oneCIndexScopeProfile?: string;
}

export interface DashboardProfileState {
    daemon?: {
        retrieval?: RetrievalProfileState;
    };
    codebase?: {
        retrieval?: RetrievalProfileState;
        oneCIndexScope?: {
            profile?: string;
            status?: string;
        };
        rlmBslEnrichment?: {
            mode?: string;
            status?: string;
        };
    };
    search?: {
        ranking?: {
            requestedProfile?: string;
            resolvedProfile?: string;
            oneCSignalsActive?: boolean;
        };
    };
}

interface RetrievalProfileState {
    configuredProfile?: string;
    resolvedProfile?: string;
    indexedProfile?: string;
    retrievalMode?: string;
    retrievalSchemaVersion?: number;
    compatibility?: string;
    shape?: string;
}

export interface ProfileStateSection {
    title: string;
    tone: 'neutral' | 'attention' | 'degraded';
    items: string[];
}

export interface SearchRequestInput {
    path: string;
    query: string;
    limit: number;
    extensionFilterText: string;
    rankingProfile: RankingProfile;
}

export interface SearchResultDiagnosticsSource {
    metadata?: Record<string, unknown>;
}

export function parseExtensionFilters(value: string): string[] {
    return value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

export function buildSearchRequestBody(input: SearchRequestInput): Record<string, unknown> {
    const extensionFilter = parseExtensionFilters(input.extensionFilterText);
    return {
        path: input.path,
        query: input.query,
        limit: input.limit,
        ...(extensionFilter.length > 0 ? { extensionFilter } : {}),
        rankingProfile: input.rankingProfile,
    };
}

export function formatRetrievalContext(context: RetrievalContext): string[] {
    const parts = [
        context.retrievalProfile ? `Профиль: ${context.retrievalProfile}` : '',
        context.retrievalMode ? `Режим: ${context.retrievalMode}` : '',
        typeof context.retrievalSchemaVersion === 'number' ? `Схема: ${context.retrievalSchemaVersion}` : '',
        context.oneCIndexScopeProfile ? `Охват 1C: ${context.oneCIndexScopeProfile}` : '',
    ].filter(Boolean);

    return parts.length > 0 ? parts : ['Поиск: профиль неизвестен'];
}

export function buildProfileStateSections(input: {
    profileState?: DashboardProfileState;
    fallbackRetrieval?: RetrievalContext;
    fallbackRankingProfile?: string;
}): ProfileStateSection[] {
    const profileState = input.profileState;
    const sections: ProfileStateSection[] = [];

    const daemonRetrieval = profileState?.daemon?.retrieval;
    sections.push({
        title: 'Демон',
        tone: toneForCompatibility(daemonRetrieval?.compatibility),
        items: daemonRetrieval
            ? retrievalItems(daemonRetrieval, 'default')
            : fallbackRetrievalItems(input.fallbackRetrieval, 'Настройки демона неизвестны.'),
    });

    const codebase = profileState?.codebase;
    const codebaseItems = codebase
        ? [
            ...retrievalItems(codebase.retrieval, 'indexed'),
            codebase.oneCIndexScope?.profile ? `Охват 1C: ${codebase.oneCIndexScope.profile}` : 'Охват 1C: неизвестно',
            codebase.oneCIndexScope?.status ? `Состояние охвата: ${codebase.oneCIndexScope.status}` : '',
            codebase.rlmBslEnrichment?.mode ? `RLM BSL: ${codebase.rlmBslEnrichment.mode}` : 'RLM BSL: disabled',
            codebase.rlmBslEnrichment?.status ? `Состояние RLM BSL: ${codebase.rlmBslEnrichment.status}` : '',
        ].filter(Boolean)
        : fallbackRetrievalItems(input.fallbackRetrieval, 'Профиль репозитория неизвестен.');
    sections.push({
        title: 'Репозиторий',
        tone: codebaseTone(codebase),
        items: codebaseItems,
    });

    const ranking = profileState?.search?.ranking;
    sections.push({
        title: 'Последний поиск',
        tone: 'neutral',
        items: ranking
            ? [
                `Запрошенное ранжирование: ${ranking.requestedProfile || 'unknown'}`,
                `Применённое ранжирование: ${ranking.resolvedProfile || 'unknown'}`,
                `Сигналы 1C: ${ranking.oneCSignalsActive ? 'активны' : 'не активны'}`,
            ]
            : [`Ранжирование: ${input.fallbackRankingProfile || 'неизвестно'}`],
    });

    return sections;
}

export function getResultDiagnostics(result: SearchResultDiagnosticsSource): Array<[string, string]> {
    const metadata = result.metadata || {};
    const keys = [
        'rankingProfile',
        'semanticScore',
        'lexicalScore',
        'retrievalSources',
        'scoreBreakdown',
        'boosts',
        'penalties',
        'providerDiagnostics',
    ];

    return keys
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, formatDiagnosticValue(metadata[key])]);
}

function formatDiagnosticValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map((item) => String(item)).join(', ');
    }
    if (value && typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

function retrievalItems(state: RetrievalProfileState | undefined, kind: 'default' | 'indexed'): string[] {
    if (!state) {
        return ['Профиль поиска: неизвестно'];
    }
    const profile = kind === 'default'
        ? state.resolvedProfile || state.configuredProfile
        : state.indexedProfile || state.resolvedProfile || state.configuredProfile;

    return [
        `Профиль поиска: ${profile || 'unknown'}`,
        state.retrievalMode ? `Режим: ${state.retrievalMode}` : 'Режим: unknown',
        typeof state.retrievalSchemaVersion === 'number' ? `Схема: ${state.retrievalSchemaVersion}` : '',
        state.shape ? `Форма хранения: ${state.shape}` : '',
        state.compatibility ? `Совместимость: ${state.compatibility}` : '',
    ].filter(Boolean);
}

function fallbackRetrievalItems(context: RetrievalContext | undefined, empty: string): string[] {
    if (!context) {
        return [empty];
    }
    return formatRetrievalContext(context);
}

function toneForCompatibility(value: string | undefined): ProfileStateSection['tone'] {
    if (value === 'requires-force') {
        return 'degraded';
    }
    if (value === 'default-difference' || value === 'unknown' || value === 'inferred') {
        return 'attention';
    }
    return 'neutral';
}

function codebaseTone(codebase: DashboardProfileState['codebase'] | undefined): ProfileStateSection['tone'] {
    if (codebase?.rlmBslEnrichment?.status === 'failed') {
        return 'degraded';
    }
    if (
        codebase?.retrieval?.compatibility === 'default-difference' ||
        codebase?.retrieval?.compatibility === 'unknown' ||
        codebase?.oneCIndexScope?.status === 'reduced-coverage' ||
        codebase?.rlmBslEnrichment?.status === 'partial' ||
        codebase?.rlmBslEnrichment?.status === 'unavailable'
    ) {
        return 'attention';
    }
    return toneForCompatibility(codebase?.retrieval?.compatibility);
}
