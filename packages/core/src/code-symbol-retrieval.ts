import { spawn } from 'child_process';
import * as path from 'path';
import { SemanticSearchResult } from './types';
import { VectorDatabase, VectorDocument } from './vectordb';

export type CodeSymbolProviderStatus =
    | 'available'
    | 'missing'
    | 'stale'
    | 'busy'
    | 'error'
    | 'unsupported'
    | 'timeout'
    | 'disabled';

export interface CodeSymbolProviderAvailability {
    providerName: string;
    status: CodeSymbolProviderStatus;
    diagnostics?: Record<string, any>;
}

export interface CodeSymbolProviderCandidate {
    providerName: string;
    providerStatus: CodeSymbolProviderStatus;
    relativePath: string;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    declarationKind?: string;
    moduleName?: string;
    objectKind?: string;
    moduleType?: string;
    export?: boolean;
    providerRank?: number;
    lexicalScore?: number;
    diagnostics?: Record<string, any>;
}

export interface CodeSymbolProviderQuery {
    codebasePath: string;
    query: string;
    tokens: CodeSymbolQueryTokens;
    maxCandidates: number;
    timeoutMs: number;
}

export interface CodeSymbolProvider {
    readonly providerName: string;
    getAvailability(codebasePath: string): Promise<CodeSymbolProviderAvailability>;
    queryCandidates(query: CodeSymbolProviderQuery): Promise<CodeSymbolProviderCandidate[]>;
}

export interface CodeSymbolRetrievalOptions {
    maxLexicalCandidates: number;
    maxProviderCandidates: number;
    providerTimeoutMs: number;
}

export interface CodeSymbolQueryTokens {
    rawQuery: string;
    normalizedQuery: string;
    exactTerms: string[];
    identifierTerms: string[];
    pathTerms: string[];
    naturalTerms: string[];
    hasCodeLikeTerm: boolean;
}

export interface LexicalCandidate {
    document: VectorDocument;
    lexicalScore: number;
    sources: string[];
    diagnostics?: Record<string, any>;
    providerCandidate?: CodeSymbolProviderCandidate;
}

export interface CodeSymbolRetrievalDiagnostics {
    providerStatuses: CodeSymbolProviderAvailability[];
    providerUnmappedCandidates: CodeSymbolProviderCandidate[];
    lexicalFailure?: string;
}

export interface CodeSymbolRetrievalResult {
    lexicalCandidates: LexicalCandidate[];
    diagnostics: CodeSymbolRetrievalDiagnostics;
}

export const RANKING_PROFILES = ['auto', 'generic', 'one-c'] as const;

export type RankingProfile = typeof RANKING_PROFILES[number];

export interface RankingProfileResolutionOptions {
    searchTimeProfile?: RankingProfile;
    persistedCodebaseDefault?: RankingProfile;
}

export interface CodeSearchFusionOptions {
    rankingProfile?: RankingProfile;
}

export function isRankingProfile(value: unknown): value is RankingProfile {
    return typeof value === 'string' && RANKING_PROFILES.includes(value as RankingProfile);
}

export function parseRankingProfile(value: unknown, fieldName = 'rankingProfile'): RankingProfile | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (isRankingProfile(value)) {
        return value;
    }

    throw new Error(
        `Invalid ${fieldName}: ${JSON.stringify(value)}. Expected one of: ${RANKING_PROFILES.join(', ')}.`,
    );
}

export function resolveRankingProfile(options: RankingProfileResolutionOptions = {}): RankingProfile {
    return options.searchTimeProfile || options.persistedCodebaseDefault || 'auto';
}

const IDENTIFIER_PATTERN = /[\p{L}_][\p{L}\p{N}_]{2,}/gu;
const PATH_SPLIT_PATTERN = /[\\/.:#()"'\s-]+/u;

export function tokenizeCodeSymbolQuery(query: string): CodeSymbolQueryTokens {
    const normalizedQuery = normalizeText(query);
    const quotedTerms = [...query.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`/g)]
        .map((match) => match[1] || match[2] || match[3])
        .map((term) => term.trim())
        .filter(Boolean);
    const identifierTerms = unique([
        ...quotedTerms,
        ...[...query.matchAll(IDENTIFIER_PATTERN)].map((match) => match[0]),
    ]);
    const pathTerms = unique(
        query
            .split(PATH_SPLIT_PATTERN)
            .map((term) => term.trim())
            .filter((term) => term.length >= 3 && /[./\\]|Modules|Forms|Commands|Catalogs|Documents|Common|Reports|Ext|src|cf/i.test(query + term)),
    );
    const naturalTerms = unique(
        normalizedQuery
            .split(/[^\p{L}\p{N}_]+/u)
            .map((term) => term.trim())
            .filter((term) => term.length >= 3),
    );
    const hasCodeLikeTerm =
        quotedTerms.length > 0 ||
        identifierTerms.some((term) => /[_A-ZА-ЯЁ][\p{L}\p{N}_]{3,}/u.test(term)) ||
        /[\\/.:#]/.test(query);

    return {
        rawQuery: query,
        normalizedQuery,
        exactTerms: unique([...quotedTerms, ...identifierTerms.filter((term) => term.length >= 8)]),
        identifierTerms,
        pathTerms,
        naturalTerms,
        hasCodeLikeTerm,
    };
}

export async function collectCodeSymbolCandidates(
    vectorDatabase: VectorDatabase,
    collectionName: string,
    codebasePath: string,
    query: string,
    options: CodeSymbolRetrievalOptions,
    providers: CodeSymbolProvider[] = [],
    filterExpr?: string,
): Promise<CodeSymbolRetrievalResult> {
    const tokens = tokenizeCodeSymbolQuery(query);
    const diagnostics: CodeSymbolRetrievalDiagnostics = {
        providerStatuses: [],
        providerUnmappedCandidates: [],
    };

    const lexicalPromise = fetchNoReindexLexicalCandidates(
        vectorDatabase,
        collectionName,
        tokens,
        options.maxLexicalCandidates,
        filterExpr,
    ).catch((error) => {
        diagnostics.lexicalFailure = error instanceof Error ? error.message : String(error);
        return [] as LexicalCandidate[];
    });

    const providerPromises = providers.map(async (provider) => {
        const availability = await provider.getAvailability(codebasePath).catch((error) => ({
            providerName: provider.providerName,
            status: 'error' as CodeSymbolProviderStatus,
            diagnostics: { error: error instanceof Error ? error.message : String(error) },
        }));
        diagnostics.providerStatuses.push(availability);
        if (availability.status !== 'available') {
            return [] as LexicalCandidate[];
        }

        const candidates = await withTimeout(
            provider.queryCandidates({
                codebasePath,
                query,
                tokens,
                maxCandidates: options.maxProviderCandidates,
                timeoutMs: options.providerTimeoutMs,
            }),
            options.providerTimeoutMs,
        ).catch((error) => {
            diagnostics.providerStatuses.push({
                providerName: provider.providerName,
                status: error instanceof ProviderTimeoutError ? 'timeout' : 'error',
                diagnostics: { error: error instanceof Error ? error.message : String(error) },
            });
            return [] as CodeSymbolProviderCandidate[];
        });

        return mapProviderCandidatesToChunks(
            vectorDatabase,
            collectionName,
            codebasePath,
            candidates.slice(0, options.maxProviderCandidates),
            diagnostics,
            filterExpr,
        );
    });

    const [lexicalCandidates, ...providerCandidateGroups] = await Promise.all([
        lexicalPromise,
        ...providerPromises,
    ]);

    return {
        lexicalCandidates: mergeLexicalCandidates([
            ...lexicalCandidates,
            ...providerCandidateGroups.flat(),
        ]),
        diagnostics,
    };
}

export function fuseCodeSearchResults(
    semanticResults: SemanticSearchResult[],
    lexicalCandidates: LexicalCandidate[],
    query: string,
    topK: number,
    diagnostics: CodeSymbolRetrievalDiagnostics,
    options: CodeSearchFusionOptions = {},
): SemanticSearchResult[] {
    const rankingProfile = resolveRankingProfile({
        searchTimeProfile: options.rankingProfile,
    });
    const hasDiagnostics =
        diagnostics.providerStatuses.length > 0 ||
        diagnostics.providerUnmappedCandidates.length > 0 ||
        Boolean(diagnostics.lexicalFailure);
    if (lexicalCandidates.length === 0 && !hasDiagnostics) {
        return semanticResults.map((result) => ({
            ...result,
            metadata: {
                ...sanitizeResultMetadata(result.metadata || {}),
                rankingProfile,
            },
        }));
    }

    const tokens = tokenizeCodeSymbolQuery(query);
    const byKey = new Map<string, SemanticSearchResult & {
        metadata: Record<string, any>;
        _semanticScore: number;
        _lexicalScore: number;
        _exactSymbolBoost: number;
        _pathBoost: number;
        _oneCObjectKindBoost: number;
        _oneCObjectNameBoost: number;
        _oneCIntentBoost: number;
        _providerRank: number;
    }>();

    const addResult = (
        result: SemanticSearchResult,
        semanticScore: number,
        lexicalScore: number,
        source: string,
        extraMetadata: Record<string, any> = {},
        providerRank = Number.MAX_SAFE_INTEGER,
    ) => {
        const key = resultKey(result);
        const existing = byKey.get(key);
        const exactSymbolBoost = scoreExactSymbol(tokens, result.content);
        const pathBoost = scorePath(tokens, result.relativePath, result.metadata);
        const oneCSignals = scoreOneCPathSignals(tokens, result.relativePath, result.content, result.metadata, rankingProfile);
        const mergedMetadata = {
            ...sanitizeResultMetadata(existing?.metadata || {}),
            ...sanitizeResultMetadata(result.metadata || {}),
            ...sanitizeResultMetadata(extraMetadata),
        };
        const retrievalSources = unique([
            ...toStringArray(existing?.metadata?.retrievalSources),
            ...toStringArray(result.metadata?.retrievalSources),
            source,
        ]);

        byKey.set(key, {
            ...(existing || result),
            score: 0,
            metadata: {
                ...mergedMetadata,
                retrievalSources,
            },
            _semanticScore: Math.max(existing?._semanticScore ?? 0, semanticScore),
            _lexicalScore: Math.max(existing?._lexicalScore ?? 0, lexicalScore),
            _exactSymbolBoost: Math.max(existing?._exactSymbolBoost ?? 0, exactSymbolBoost),
            _pathBoost: Math.max(existing?._pathBoost ?? 0, pathBoost),
            _oneCObjectKindBoost: Math.max(existing?._oneCObjectKindBoost ?? 0, oneCSignals.objectKindBoost),
            _oneCObjectNameBoost: Math.max(existing?._oneCObjectNameBoost ?? 0, oneCSignals.objectNameBoost),
            _oneCIntentBoost: Math.max(existing?._oneCIntentBoost ?? 0, oneCSignals.intentBoost),
            _providerRank: Math.min(existing?._providerRank ?? Number.MAX_SAFE_INTEGER, providerRank),
        });
    };

    semanticResults.forEach((result) => addResult(result, result.score, 0, 'semantic'));
    lexicalCandidates.forEach((candidate) => {
        addResult(
            vectorDocumentToSearchResult(candidate.document, candidate.lexicalScore),
            0,
            candidate.lexicalScore,
            candidate.providerCandidate ? 'symbol_provider' : 'lexical',
            {
                ...(candidate.diagnostics ? { lexicalDiagnostics: candidate.diagnostics } : {}),
                ...(candidate.providerCandidate ? {
                    symbolProvider: candidate.providerCandidate.providerName,
                    providerStatus: candidate.providerCandidate.providerStatus,
                    symbolName: candidate.providerCandidate.symbolName,
                    declarationKind: candidate.providerCandidate.declarationKind,
                    moduleName: candidate.providerCandidate.moduleName,
                    objectKind: candidate.providerCandidate.objectKind,
                    export: candidate.providerCandidate.export,
                } : {}),
            },
            candidate.providerCandidate?.providerRank,
        );
    });

    const fused = [...byKey.values()].map((result) => {
        const providerRankBoost = result._providerRank < Number.MAX_SAFE_INTEGER
            ? Math.max(0, 1.5 - result._providerRank * 0.05)
            : 0;
        const baseFusionScore =
            result._semanticScore +
            result._lexicalScore +
            result._exactSymbolBoost +
            result._pathBoost +
            result._oneCObjectKindBoost +
            result._oneCObjectNameBoost +
            result._oneCIntentBoost +
            providerRankBoost;

        return {
            content: result.content,
            relativePath: result.relativePath,
            startLine: result.startLine,
            endLine: result.endLine,
            language: result.language,
            score: baseFusionScore,
            metadata: {
                ...result.metadata,
                semanticScore: result._semanticScore,
                lexicalScore: result._lexicalScore,
                exactSymbolBoost: result._exactSymbolBoost,
                pathBoost: result._pathBoost,
                oneCObjectKindBoost: result._oneCObjectKindBoost,
                oneCObjectNameBoost: result._oneCObjectNameBoost,
                oneCIntentBoost: result._oneCIntentBoost,
                rankingProfile,
                providerRankBoost,
                duplicatePenalty: 0,
                diversityReason: 'first_file_result',
                baseFusionScore,
                fusionScore: baseFusionScore,
                providerDiagnostics: diagnostics.providerStatuses,
                providerUnmappedCandidates: diagnostics.providerUnmappedCandidates,
                ...(diagnostics.lexicalFailure ? { lexicalFailure: diagnostics.lexicalFailure } : {}),
            },
        };
    });

    return applyDuplicateDiversity(fused
        .sort((left, right) =>
            right.score - left.score ||
            compareExactness(right, left, tokens) ||
            left.relativePath.localeCompare(right.relativePath) ||
            left.startLine - right.startLine,
        ))
        .sort((left, right) =>
            right.score - left.score ||
            compareExactness(right, left, tokens) ||
            left.relativePath.localeCompare(right.relativePath) ||
            left.startLine - right.startLine,
        )
        .slice(0, topK);
}

export class DisabledCodeSymbolProvider implements CodeSymbolProvider {
    readonly providerName: string;
    private readonly reason: string;

    constructor(providerName: string, reason = 'disabled') {
        this.providerName = providerName;
        this.reason = reason;
    }

    async getAvailability(): Promise<CodeSymbolProviderAvailability> {
        return {
            providerName: this.providerName,
            status: 'disabled',
            diagnostics: { reason: this.reason },
        };
    }

    async queryCandidates(): Promise<CodeSymbolProviderCandidate[]> {
        return [];
    }
}

export interface RlmToolsBslSubprocessProviderConfig {
    command?: string;
    args?: string[];
    availabilityArgs?: string[];
    providerRoot?: string;
    timeoutMs?: number;
}

export class RlmToolsBslSubprocessProvider implements CodeSymbolProvider {
    readonly providerName = 'rlm-tools-bsl';
    private readonly command?: string;
    private readonly args: string[];
    private readonly availabilityArgs?: string[];
    private readonly providerRoot?: string;
    private readonly timeoutMs: number;

    constructor(config: RlmToolsBslSubprocessProviderConfig = {}) {
        this.command = config.command;
        this.args = config.args || ['symbol-search', '--json', '--path', '{codebasePath}', '--query', '{query}', '--limit', '{limit}'];
        this.availabilityArgs = config.availabilityArgs;
        this.providerRoot = config.providerRoot;
        this.timeoutMs = config.timeoutMs || 750;
    }

    async getAvailability(codebasePath: string): Promise<CodeSymbolProviderAvailability> {
        if (!this.command) {
            return {
                providerName: this.providerName,
                status: 'disabled',
                diagnostics: { reason: 'RLM_TOOLS_BSL_COMMAND is not configured' },
            };
        }

        if (this.availabilityArgs) {
            const args = this.availabilityArgs.map((arg) => arg
                .split('{codebasePath}').join(codebasePath));
            try {
                const output = await runJsonCommand(this.command, args, this.timeoutMs);
                const status = normalizeProviderStatus(output?.status);
                return {
                    providerName: this.providerName,
                    status,
                    diagnostics: {
                        ...(output?.diagnostics || {}),
                        codebasePath,
                        providerRoot: this.providerRoot,
                        transport: 'subprocess-json',
                        autoIndexLifecycle: 'disabled',
                    },
                };
            } catch (error) {
                return {
                    providerName: this.providerName,
                    status: 'error',
                    diagnostics: {
                        error: error instanceof Error ? error.message : String(error),
                        transport: 'subprocess-json',
                        autoIndexLifecycle: 'disabled',
                    },
                };
            }
        }

        return {
            providerName: this.providerName,
            status: 'unsupported',
            diagnostics: {
                reason: 'RLM_TOOLS_BSL_AVAILABILITY_ARGS_JSON is required for freshness checks',
                codebasePath,
                providerRoot: this.providerRoot,
                transport: 'subprocess-json',
                autoIndexLifecycle: 'disabled',
            },
        };
    }

    async queryCandidates(query: CodeSymbolProviderQuery): Promise<CodeSymbolProviderCandidate[]> {
        if (!this.command) {
            return [];
        }

        const args = this.args.map((arg) => arg
            .split('{codebasePath}').join(query.codebasePath)
            .split('{query}').join(query.query)
            .split('{limit}').join(String(query.maxCandidates)));
        const output = await runJsonCommand(this.command, args, Math.min(query.timeoutMs, this.timeoutMs));
        const rows = Array.isArray(output) ? output : output?.candidates;
        if (!Array.isArray(rows)) {
            throw new Error('rlm-tools-bsl provider did not return a JSON candidate array.');
        }

        return rows.slice(0, query.maxCandidates).map((row: any, index: number) => ({
            providerName: this.providerName,
            providerStatus: 'available' as CodeSymbolProviderStatus,
            relativePath: translateProviderPath(
                String(row.relativePath || row.path || ''),
                query.codebasePath,
                this.providerRoot,
            ),
            startLine: numberOrUndefined(row.startLine ?? row.line),
            endLine: numberOrUndefined(row.endLine ?? row.lineEnd ?? row.line),
            symbolName: stringOrUndefined(row.symbolName ?? row.name ?? row.methodName),
            declarationKind: stringOrUndefined(row.declarationKind ?? row.kind),
            moduleName: stringOrUndefined(row.moduleName),
            objectKind: stringOrUndefined(row.objectKind),
            moduleType: stringOrUndefined(row.moduleType),
            export: typeof row.export === 'boolean' ? row.export : undefined,
            providerRank: numberOrUndefined(row.providerRank ?? row.rank) ?? index,
            lexicalScore: numberOrUndefined(row.lexicalScore ?? row.score) ?? 4,
            diagnostics: { transport: 'subprocess-json' },
        })).filter((candidate) => candidate.relativePath.length > 0);
    }
}

export function translateProviderPath(providerPath: string, codebasePath: string, providerRoot?: string): string {
    const normalizedProviderPath = normalizePath(providerPath);
    if (!path.isAbsolute(providerPath)) {
        return normalizedProviderPath;
    }

    const relativeToCodebase = path.relative(codebasePath, providerPath);
    if (relativeToCodebase && !relativeToCodebase.startsWith('..') && !path.isAbsolute(relativeToCodebase)) {
        return normalizePath(relativeToCodebase);
    }

    if (providerRoot) {
        const relativeToProvider = path.relative(providerRoot, providerPath);
        if (relativeToProvider && !relativeToProvider.startsWith('..') && !path.isAbsolute(relativeToProvider)) {
            const nestedRoot = path.relative(codebasePath, providerRoot);
            return normalizePath(path.join(nestedRoot, relativeToProvider));
        }
    }

    return normalizedProviderPath;
}

async function fetchNoReindexLexicalCandidates(
    vectorDatabase: VectorDatabase,
    collectionName: string,
    tokens: CodeSymbolQueryTokens,
    maxCandidates: number,
    filterExpr?: string,
): Promise<LexicalCandidate[]> {
    const outputFields = ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata', 'metadata_json'];
    const filters = buildLexicalFilters(tokens);
    const rowsByKey = new Map<string, Record<string, any>>();

    for (const filter of filters) {
        const rows = await vectorDatabase.query(collectionName, filter, outputFields, maxCandidates);
        for (const row of rows) {
            if (!rowMatchesFilterExpr(row, filterExpr)) {
                continue;
            }
            rowsByKey.set(rowKey(row), row);
        }
        if (rowsByKey.size >= maxCandidates) {
            break;
        }
    }

    if (rowsByKey.size === 0) {
        const rows = await vectorDatabase.query(collectionName, undefined, outputFields, maxCandidates);
        for (const row of rows) {
            if (!rowMatchesFilterExpr(row, filterExpr)) {
                continue;
            }
            rowsByKey.set(rowKey(row), row);
        }
    }

    return [...rowsByKey.values()]
        .map((row) => {
            const document = rowToVectorDocument(row);
            return {
                document,
                lexicalScore: scoreLexicalDocument(tokens, document),
                sources: ['lexical'],
            };
        })
        .filter((candidate) => candidate.lexicalScore > 0)
        .sort((left, right) => right.lexicalScore - left.lexicalScore)
        .slice(0, maxCandidates);
}

function buildLexicalFilters(tokens: CodeSymbolQueryTokens): Array<string | undefined> {
    const terms = unique([...tokens.exactTerms, ...tokens.identifierTerms, ...tokens.pathTerms])
        .slice(0, 6)
        .map(escapeFilterString);
    const filters: string[] = [];
    for (const term of terms) {
        filters.push(`relativePath like "%${term}%"`);
        filters.push(`content like "%${term}%"`);
    }
    return filters.length > 0 ? filters : [undefined];
}

async function mapProviderCandidatesToChunks(
    vectorDatabase: VectorDatabase,
    collectionName: string,
    codebasePath: string,
    candidates: CodeSymbolProviderCandidate[],
    diagnostics: CodeSymbolRetrievalDiagnostics,
    filterExpr?: string,
): Promise<LexicalCandidate[]> {
    const mapped: LexicalCandidate[] = [];
    const outputFields = ['id', 'content', 'relativePath', 'startLine', 'endLine', 'fileExtension', 'metadata', 'metadata_json'];

    for (const candidate of candidates) {
        const relativePath = translateProviderPath(candidate.relativePath, codebasePath);
        const rows = await vectorDatabase.query(
            collectionName,
            `relativePath == "${escapeFilterString(relativePath)}"`,
            outputFields,
            20,
        ).catch(() => [] as Record<string, any>[]);

        const filteredRows = rows.filter((row) => rowMatchesFilterExpr(row, filterExpr));

        if (filteredRows.length === 0) {
            diagnostics.providerUnmappedCandidates.push({ ...candidate, relativePath });
            continue;
        }

        const rankedRows = filteredRows
            .map((row) => ({
                row,
                overlap: scoreLineOverlap(candidate, row),
            }))
            .sort((left, right) => right.overlap - left.overlap);
        const bestRow = rankedRows[0].row;
        const document = rowToVectorDocument(bestRow);
        mapped.push({
            document,
            lexicalScore: candidate.lexicalScore ?? 4,
            sources: ['symbol_provider'],
            providerCandidate: { ...candidate, relativePath },
            diagnostics: {
                mappedBy: rankedRows[0].overlap > 0 ? 'relativePath+lineRange' : 'relativePath',
            },
        });
    }

    return mapped;
}

function mergeLexicalCandidates(candidates: LexicalCandidate[]): LexicalCandidate[] {
    const merged = new Map<string, LexicalCandidate>();
    for (const candidate of candidates) {
        const key = resultKey(vectorDocumentToSearchResult(candidate.document, candidate.lexicalScore));
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, candidate);
            continue;
        }

        merged.set(key, {
            ...existing,
            lexicalScore: Math.max(existing.lexicalScore, candidate.lexicalScore),
            sources: unique([...existing.sources, ...candidate.sources]),
            diagnostics: {
                ...(existing.diagnostics || {}),
                ...(candidate.diagnostics || {}),
            },
            providerCandidate: candidate.providerCandidate || existing.providerCandidate,
        });
    }
    return [...merged.values()];
}

function scoreLexicalDocument(tokens: CodeSymbolQueryTokens, document: VectorDocument): number {
    const content = normalizeText(document.content);
    const relativePath = normalizeText(document.relativePath);
    let score = 0;

    for (const term of tokens.exactTerms) {
        const normalized = normalizeText(term);
        if (normalized && content.includes(normalized)) {
            score += 5;
        }
        if (normalized && relativePath.includes(normalized)) {
            score += 4;
        }
    }
    for (const term of tokens.identifierTerms) {
        const normalized = normalizeText(term);
        if (normalized && content.includes(normalized)) {
            score += 2;
        }
        if (normalized && relativePath.includes(normalized)) {
            score += 2;
        }
    }
    for (const term of tokens.pathTerms) {
        const normalized = normalizeText(term);
        if (normalized && relativePath.includes(normalized)) {
            score += 2;
        }
    }

    if (!tokens.hasCodeLikeTerm) {
        score = Math.min(score, 1);
    }

    return score;
}

function scoreExactSymbol(tokens: CodeSymbolQueryTokens, content: string): number {
    if (!tokens.hasCodeLikeTerm) {
        return 0;
    }
    const normalizedContent = normalizeText(content);
    return tokens.exactTerms.some((term) => normalizedContent.includes(normalizeText(term))) ? 6 : 0;
}

function scorePath(tokens: CodeSymbolQueryTokens, relativePath: string, metadata?: Record<string, any>): number {
    const normalizedPath = normalizeText(relativePath);
    const metadataText = normalizeText(JSON.stringify(metadata || {}));
    let score = 0;
    for (const term of unique([...tokens.pathTerms, ...tokens.identifierTerms])) {
        const normalized = normalizeText(term);
        if (!normalized) {
            continue;
        }
        if (normalizedPath.includes(normalized)) {
            score += tokens.hasCodeLikeTerm ? 3 : 1;
        }
        if (metadataText.includes(normalized)) {
            score += 1;
        }
    }
    return score;
}

interface OneCPathInfo {
    objectKind?: string;
    objectName?: string;
    area?: string;
    areaName?: string;
    moduleKind?: string;
    recognized: boolean;
}

interface OneCSignalScores {
    objectKindBoost: number;
    objectNameBoost: number;
    intentBoost: number;
}

const ONE_C_OBJECT_KIND_BY_SEGMENT: Record<string, string> = {
    Catalogs: 'catalog',
    Documents: 'document',
    AccumulationRegisters: 'register',
    InformationRegisters: 'register',
    AccountingRegisters: 'register',
    CalculationRegisters: 'register',
    Reports: 'report',
    DataProcessors: 'dataProcessor',
    CommonCommands: 'command',
    CommonForms: 'form',
    CommonModules: 'commonModule',
};

const ONE_C_KIND_TERMS: Record<string, string[]> = {
    catalog: ['справочник', 'справочники', 'каталог'],
    document: ['документ', 'документы', 'накладная', 'заказ'],
    register: ['регистр', 'регистры', 'остатки', 'взаиморасчеты'],
    report: ['отчет', 'отчеты', 'ведомость'],
    command: ['команда', 'команды'],
    form: ['форма', 'форму', 'формы'],
    commonModule: ['общий модуль', 'общем модуле', 'common module'],
    dataProcessor: ['обработка', 'обработки'],
};

const PRINT_TERMS = ['печать', 'печатная', 'печатный', 'прайс', 'макет', 'табличный документ', 'накладная'];
const STOCK_REPORT_TERMS = ['остат', 'склад', 'отчет'];
const PRODUCT_CARD_TERMS = ['карточк', 'реквизит', 'цена', 'артикул', 'штрихкод'];

function scoreOneCPathSignals(
    tokens: CodeSymbolQueryTokens,
    relativePath: string,
    content: string,
    metadata?: Record<string, any>,
    rankingProfile: RankingProfile = 'auto',
): OneCSignalScores {
    if (rankingProfile === 'generic') {
        return { objectKindBoost: 0, objectNameBoost: 0, intentBoost: 0 };
    }

    const pathInfo = parseOneCPath(relativePath);
    if (!pathInfo.recognized) {
        return { objectKindBoost: 0, objectNameBoost: 0, intentBoost: 0 };
    }

    const normalizedQuery = tokens.normalizedQuery;
    const normalizedContent = normalizeText(content);
    const metadataText = normalizeText(JSON.stringify(metadata || {}));

    const objectKindBoost = Math.min(1.2, scoreOneCObjectKindIntent(normalizedQuery, pathInfo));
    const objectNameBoost = Math.min(1.3, scoreOneCObjectName(tokens, pathInfo, metadataText));
    const intentBoost = Math.min(1.1, scoreOneCFormAndCommandIntent(normalizedQuery, normalizedContent, pathInfo));

    return {
        objectKindBoost,
        objectNameBoost,
        intentBoost,
    };
}

function parseOneCPath(relativePath: string): OneCPathInfo {
    const segments = normalizePath(relativePath).split('/').filter(Boolean);
    const rootIndex = segments.findIndex((segment) => Object.prototype.hasOwnProperty.call(ONE_C_OBJECT_KIND_BY_SEGMENT, segment));
    if (rootIndex < 0) {
        return { recognized: false };
    }

    const root = segments[rootIndex];
    const objectKind = ONE_C_OBJECT_KIND_BY_SEGMENT[root];
    const objectName = objectKind === 'commonModule' || objectKind === 'command' || objectKind === 'form'
        ? segments[rootIndex + 1]
        : segments[rootIndex + 1];
    const tail = segments.slice(rootIndex + 2);
    const areaIndex = tail.findIndex((segment) => ['Forms', 'Commands', 'Ext', 'Templates', 'Layouts'].includes(segment));
    const area = areaIndex >= 0 ? tail[areaIndex] : undefined;
    const areaName = areaIndex >= 0 ? tail[areaIndex + 1] : undefined;
    const fileName = segments[segments.length - 1] || '';
    const moduleKind = fileName === 'ObjectModule.bsl'
        ? 'objectModule'
        : fileName === 'ManagerModule.bsl'
            ? 'managerModule'
            : fileName === 'Module.bsl'
                ? 'module'
                : undefined;

    return {
        objectKind,
        objectName,
        area,
        areaName,
        moduleKind,
        recognized: true,
    };
}

function scoreOneCObjectKindIntent(normalizedQuery: string, pathInfo: OneCPathInfo): number {
    let score = 0;
    for (const term of ONE_C_KIND_TERMS[pathInfo.objectKind || ''] || []) {
        if (normalizedQuery.includes(normalizeText(term))) {
            score += 0.8;
            break;
        }
    }

    if (normalizedQuery.includes('форма списка') && pathInfo.area === 'Forms' && normalizeText(pathInfo.areaName || '').includes('формасписка')) {
        score += 0.9;
    }
    if ((normalizedQuery.includes('форма элемента') || normalizedQuery.includes('карточк')) &&
        pathInfo.area === 'Forms' &&
        normalizeText(pathInfo.areaName || '').includes('формаэлемента')) {
        score += 0.9;
    }
    if (normalizedQuery.includes('форма документа') && pathInfo.area === 'Forms' && normalizeText(pathInfo.areaName || '').includes('формадокумента')) {
        score += 0.9;
    }
    if (normalizedQuery.includes('команд') && pathInfo.area === 'Commands') {
        score += 0.7;
    }

    return score;
}

function scoreOneCObjectName(tokens: CodeSymbolQueryTokens, pathInfo: OneCPathInfo, metadataText: string): number {
    const objectName = pathInfo.objectName || '';
    if (!objectName) {
        return 0;
    }

    const nameTerms = splitOneCNameTerms(objectName);
    if (nameTerms.length === 0) {
        return 0;
    }

    const queryTerms = new Set(tokens.naturalTerms);
    const queryTermStems = new Set(tokens.naturalTerms.map(stemOneCTerm));
    const fullName = normalizeText(objectName);
    if (tokens.normalizedQuery.includes(fullName) || metadataText.includes(fullName)) {
        return 1.2;
    }

    const matchedTerms = nameTerms.filter((term) => {
        const stem = stemOneCTerm(term);
        return queryTerms.has(term) ||
            tokens.normalizedQuery.includes(term) ||
            (stem.length >= 4 && queryTermStems.has(stem));
    });
    if (matchedTerms.length === nameTerms.length) {
        return 1.0;
    }
    if (matchedTerms.length > 0 && nameTerms.some((term) => term.length >= 5)) {
        return 0.45;
    }
    return 0;
}

function scoreOneCFormAndCommandIntent(normalizedQuery: string, normalizedContent: string, pathInfo: OneCPathInfo): number {
    let score = 0;
    const hasPrintIntent = PRINT_TERMS.some((term) => normalizedQuery.includes(normalizeText(term)));
    const normalizedObjectName = normalizeText(pathInfo.objectName || '');
    const normalizedAreaName = normalizeText(pathInfo.areaName || '');
    const hasStockReportIntent =
        normalizedQuery.includes(STOCK_REPORT_TERMS[0]) &&
        (normalizedQuery.includes(STOCK_REPORT_TERMS[1]) || normalizedQuery.includes(STOCK_REPORT_TERMS[2]));
    const hasProductCardIntent =
        (normalizedQuery.includes('карточк') && normalizedQuery.includes('товар')) ||
        (normalizedQuery.includes('товар') && PRODUCT_CARD_TERMS.some((term) => normalizedQuery.includes(term)));

    if (hasStockReportIntent) {
        if (pathInfo.objectKind === 'report') {
            score += 0.9;
        } else if (pathInfo.area === 'Commands' && normalizedAreaName.includes('остат')) {
            score += 0.75;
        } else if (pathInfo.objectKind === 'catalog' &&
            stemOneCTerm(normalizedObjectName) === 'товар' &&
            pathInfo.area === 'Forms' &&
            (normalizedAreaName.includes('остат') || normalizedAreaName.includes('спис'))) {
            score += 0.75;
        }
        if (normalizedContent.includes('остат') && normalizedContent.includes('склад')) {
            score += 0.3;
        }
    }

    if (hasProductCardIntent && pathInfo.objectKind === 'catalog' && stemOneCTerm(normalizedObjectName) === 'товар') {
        if (pathInfo.area === 'Forms' && normalizedAreaName.includes('формаэлемента')) {
            score += 0.95;
        } else if (pathInfo.moduleKind === 'objectModule') {
            score += 0.7;
        } else if (pathInfo.area === 'Commands') {
            score += 0.15;
        }
        if (PRODUCT_CARD_TERMS.some((term) => normalizedContent.includes(term))) {
            score += 0.3;
        }
    }

    if (hasPrintIntent) {
        if (pathInfo.area === 'Commands') {
            score += 0.9;
        } else if (pathInfo.objectKind === 'report') {
            score += 0.65;
        } else if (pathInfo.area === 'Forms') {
            score += 0.45;
        } else if (pathInfo.moduleKind === 'objectModule' || pathInfo.moduleKind === 'managerModule' || pathInfo.objectKind === 'commonModule') {
            score += 0.35;
        } else if (pathInfo.area === 'Templates' || pathInfo.area === 'Layouts') {
            score += 0.45;
        }
        if (PRINT_TERMS.some((term) => normalizedContent.includes(normalizeText(term)))) {
            score += 0.35;
        }
    }

    if ((normalizedQuery.includes('список') || normalizedQuery.includes('списка')) &&
        pathInfo.area === 'Forms' &&
        normalizeText(pathInfo.areaName || '').includes('спис')) {
        score += 0.45;
    }
    if ((normalizedQuery.includes('карточк') || normalizedQuery.includes('элемент')) &&
        pathInfo.area === 'Forms' &&
        normalizeText(pathInfo.areaName || '').includes('элемент')) {
        score += 0.45;
    }

    return score;
}

function splitOneCNameTerms(value: string): string[] {
    return unique(value
        .replace(/([а-яёa-z])([А-ЯЁA-Z])/gu, '$1 $2')
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => normalizeText(term))
        .filter((term) => term.length >= 3));
}

function stemOneCTerm(value: string): string {
    const normalized = normalizeText(value);
    if (normalized.length <= 4) {
        return normalized;
    }
    return normalized
        .replace(/(ого|его|ами|ями|ах|ях|ов|ев|ом|ем|ам|ям|ой|ый|ий|ая|яя|ое|ые|ие|а|я|ы|и)$/u, '');
}

function applyDuplicateDiversity(results: SemanticSearchResult[]): SemanticSearchResult[] {
    const seenByFile = new Map<string, number>();
    return results.map((result) => {
        const fileKey = normalizePath(result.relativePath);
        const duplicateIndex = seenByFile.get(fileKey) || 0;
        seenByFile.set(fileKey, duplicateIndex + 1);

        const exactSymbolBoost = Number(result.metadata?.exactSymbolBoost || 0);
        const providerRankBoost = Number(result.metadata?.providerRankBoost || 0);
        const protectedByEvidence = exactSymbolBoost > 0 || providerRankBoost > 0;
        const duplicatePenalty = duplicateIndex === 0
            ? 0
            : protectedByEvidence
                ? Math.min(0.4, duplicateIndex * 0.1)
                : duplicateIndex === 1
                    ? 0.6
                    : Math.min(4, 1.8 + (duplicateIndex - 2) * 1.2);
        const adjustedScore = result.score - duplicatePenalty;
        const diversityReason = duplicateIndex === 0
            ? 'first_file_result'
            : protectedByEvidence
                ? 'duplicate_soft_penalty_preserved_by_exact_or_provider_evidence'
                : 'duplicate_soft_penalty';

        return {
            ...result,
            score: adjustedScore,
            metadata: {
                ...result.metadata,
                duplicatePenalty,
                diversityReason,
                fusionScore: adjustedScore,
            },
        };
    });
}

function compareExactness(left: SemanticSearchResult, right: SemanticSearchResult, tokens: CodeSymbolQueryTokens): number {
    const leftExact = scoreExactSymbol(tokens, left.content) + scorePath(tokens, left.relativePath, left.metadata);
    const rightExact = scoreExactSymbol(tokens, right.content) + scorePath(tokens, right.relativePath, right.metadata);
    return leftExact - rightExact;
}

function vectorDocumentToSearchResult(document: VectorDocument, score: number): SemanticSearchResult {
    return {
        content: document.content,
        relativePath: document.relativePath,
        startLine: document.startLine,
        endLine: document.endLine,
        language: document.metadata?.language || 'unknown',
        score,
        metadata: document.metadata || {},
    };
}

function rowToVectorDocument(row: Record<string, any>): VectorDocument {
    const metadata = parseMetadata(row.metadata ?? row.metadata_json);
    return {
        id: String(row.id || `${row.relativePath}:${row.startLine}:${row.endLine}`),
        vector: [],
        content: String(row.content || ''),
        relativePath: String(row.relativePath || ''),
        startLine: Number(row.startLine || 0),
        endLine: Number(row.endLine || 0),
        fileExtension: String(row.fileExtension || ''),
        metadata,
    };
}

function scoreLineOverlap(candidate: CodeSymbolProviderCandidate, row: Record<string, any>): number {
    if (!candidate.startLine && !candidate.endLine) {
        return 0;
    }
    const candidateStart = candidate.startLine || candidate.endLine || 0;
    const candidateEnd = candidate.endLine || candidate.startLine || candidateStart;
    const rowStart = Number(row.startLine || 0);
    const rowEnd = Number(row.endLine || rowStart);
    const overlapStart = Math.max(candidateStart, rowStart);
    const overlapEnd = Math.min(candidateEnd, rowEnd);
    return Math.max(0, overlapEnd - overlapStart + 1);
}

function runJsonCommand(command: string, args: string[], timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new ProviderTimeoutError(`Provider command timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`Provider command exited with ${code}: ${stderr.trim()}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (error) {
                reject(new Error(`Provider command did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`));
            }
        });
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new ProviderTimeoutError(`Provider timed out after ${timeoutMs}ms.`)), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

class ProviderTimeoutError extends Error {}

function normalizeText(value: string): string {
    return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function escapeFilterString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resultKey(result: SemanticSearchResult): string {
    return `${result.relativePath}:${result.startLine}:${result.endLine}`;
}

function rowKey(row: Record<string, any>): string {
    return `${row.relativePath}:${row.startLine}:${row.endLine}:${row.id || ''}`;
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sanitizeResultMetadata(metadata: Record<string, any>): Record<string, any> {
    const forbiddenKeys = new Set([
        'vector',
        'vectors',
        'dense',
        'denseVector',
        'sparse',
        'sparseVector',
        'colbert',
        'colbertVector',
        'colbertVectors',
    ]);
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (forbiddenKeys.has(key)) {
            continue;
        }
        sanitized[key] = value;
    }
    return sanitized;
}

function parseMetadata(value: unknown): Record<string, any> {
    if (!value) {
        return {};
    }
    if (typeof value === 'object') {
        return value as Record<string, any>;
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return {};
        }
    }
    return {};
}

function rowMatchesFilterExpr(row: Record<string, any>, filterExpr?: string): boolean {
    if (!filterExpr || filterExpr.trim() === '') {
        return true;
    }

    const extensionMatch = filterExpr.match(/^fileExtension\s+in\s+\[(.*)\]$/);
    if (extensionMatch) {
        const extensions = parseQuotedList(extensionMatch[1]);
        return extensions.length === 0 || extensions.includes(String(row.fileExtension || ''));
    }

    const relativePathMatch = filterExpr.match(/^relativePath\s*==\s*"((?:\\"|[^"])*)"$/);
    if (relativePathMatch) {
        return String(row.relativePath || '') === relativePathMatch[1].replace(/\\"/g, '"');
    }

    return true;
}

function parseQuotedList(value: string): string[] {
    return [...value.matchAll(/['"]((?:\\.|[^'"\\])*)['"]/g)]
        .map((match) => match[1].replace(/\\(["'])/g, '$1'));
}

function numberOrUndefined(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeProviderStatus(value: unknown): CodeSymbolProviderStatus {
    if (
        value === 'available' ||
        value === 'missing' ||
        value === 'stale' ||
        value === 'busy' ||
        value === 'error' ||
        value === 'unsupported' ||
        value === 'timeout' ||
        value === 'disabled'
    ) {
        return value;
    }
    return 'error';
}
