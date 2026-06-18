export type RankingProfile = 'auto' | 'generic' | 'one-c';

export interface RetrievalContext {
    retrievalProfile?: string;
    retrievalMode?: string;
    retrievalSchemaVersion?: number;
    oneCIndexScopeProfile?: string;
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
        context.oneCIndexScopeProfile ? `1C scope: ${context.oneCIndexScopeProfile}` : '',
    ].filter(Boolean);

    return parts.length > 0 ? parts : ['Retrieval: неизвестно'];
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
