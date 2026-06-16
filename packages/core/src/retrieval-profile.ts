import type { RetrievalMode } from './vectordb';

export type RetrievalProfile = 'fast' | 'balanced' | 'quality';
export type BgeM3ProfileMode = 'dense' | 'full';

export interface RetrievalProfileInput {
    embeddingProvider: string;
    retrievalProfile?: RetrievalProfile;
    bgeM3Mode: BgeM3ProfileMode;
    bgeM3StoreColbert: boolean;
    hybridMode: boolean;
    explicitBgeM3Mode?: boolean;
    explicitBgeM3StoreColbert?: boolean;
    explicitHybridMode?: boolean;
}

export interface ResolvedRetrievalProfile {
    retrievalProfile: RetrievalProfile;
    explicitProfile: boolean;
    retrievalMode: RetrievalMode;
    retrievalSchemaVersion: number;
    bgeM3Mode: BgeM3ProfileMode;
    storeColbert: boolean;
    usesHybridSearch: boolean;
    usesBgeM3Sparse: boolean;
    usesColbert: boolean;
}

export const RETRIEVAL_SCHEMA_VERSION = 1;
export const RETRIEVAL_PROFILES: RetrievalProfile[] = ['fast', 'balanced', 'quality'];

export function parseRetrievalProfile(value: unknown, fieldName = 'retrievalProfile'): RetrievalProfile | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new Error(`Invalid ${fieldName}: expected one of ${RETRIEVAL_PROFILES.join(', ')}.`);
    }

    const normalized = value.trim().toLowerCase();
    if ((RETRIEVAL_PROFILES as string[]).includes(normalized)) {
        return normalized as RetrievalProfile;
    }

    throw new Error(`Invalid ${fieldName} '${value}'. Expected one of ${RETRIEVAL_PROFILES.join(', ')}.`);
}

export function inferRetrievalProfile(retrievalMode: RetrievalMode): RetrievalProfile {
    switch (retrievalMode) {
        case 'bge_m3_full':
            return 'quality';
        case 'bge_m3_dense':
        case 'hybrid_bm25':
            return 'balanced';
        case 'dense':
        default:
            return 'fast';
    }
}

export function isRetrievalProfileCompatible(
    current: {
        retrievalProfile?: RetrievalProfile;
        retrievalMode?: RetrievalMode;
        retrievalSchemaVersion?: number;
    },
    requested: ResolvedRetrievalProfile,
): boolean {
    const currentMode = current.retrievalMode;
    const currentSchema = current.retrievalSchemaVersion;
    if (!currentMode) {
        return true;
    }
    return currentMode === requested.retrievalMode
        && (currentSchema === undefined || currentSchema === requested.retrievalSchemaVersion);
}

export function resolveRetrievalProfile(input: RetrievalProfileInput): ResolvedRetrievalProfile {
    const isBgeM3 = input.embeddingProvider === 'BGE_M3';
    if (!input.retrievalProfile) {
        const retrievalMode: RetrievalMode = isBgeM3
            ? input.bgeM3Mode === 'dense' ? 'bge_m3_dense' : 'bge_m3_full'
            : input.hybridMode ? 'hybrid_bm25' : 'dense';
        return {
            retrievalProfile: inferRetrievalProfile(retrievalMode),
            explicitProfile: false,
            retrievalMode,
            retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
            bgeM3Mode: input.bgeM3Mode,
            storeColbert: input.bgeM3StoreColbert,
            usesHybridSearch: retrievalMode === 'hybrid_bm25' || retrievalMode === 'bge_m3_full',
            usesBgeM3Sparse: retrievalMode === 'bge_m3_full',
            usesColbert: retrievalMode === 'bge_m3_full',
        };
    }

    const profile = input.retrievalProfile;
    if (isBgeM3) {
        if (profile === 'quality') {
            if (input.explicitBgeM3Mode && input.bgeM3Mode !== 'full') {
                throw new Error(`RETRIEVAL_PROFILE=quality conflicts with BGE_M3_MODE=${input.bgeM3Mode}. Use BGE_M3_MODE=full or remove the low-level override.`);
            }
            if (input.explicitBgeM3StoreColbert && !input.bgeM3StoreColbert) {
                throw new Error('RETRIEVAL_PROFILE=quality conflicts with BGE_M3_STORE_COLBERT=false. Quality requires stored ColBERT vectors.');
            }
            return {
                retrievalProfile: profile,
                explicitProfile: true,
                retrievalMode: 'bge_m3_full',
                retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
                bgeM3Mode: 'full',
                storeColbert: true,
                usesHybridSearch: true,
                usesBgeM3Sparse: true,
                usesColbert: true,
            };
        }

        if (input.explicitBgeM3Mode && input.bgeM3Mode !== 'dense') {
            throw new Error(`RETRIEVAL_PROFILE=${profile} conflicts with BGE_M3_MODE=${input.bgeM3Mode}. Use BGE_M3_MODE=dense or remove the low-level override.`);
        }
        if (input.explicitBgeM3StoreColbert && input.bgeM3StoreColbert) {
            throw new Error(`RETRIEVAL_PROFILE=${profile} conflicts with BGE_M3_STORE_COLBERT=true. Dense-only BGE-M3 profiles do not store ColBERT vectors.`);
        }
        return {
            retrievalProfile: profile,
            explicitProfile: true,
            retrievalMode: 'bge_m3_dense',
            retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
            bgeM3Mode: 'dense',
            storeColbert: false,
            usesHybridSearch: false,
            usesBgeM3Sparse: false,
            usesColbert: false,
        };
    }

    const wantsHybrid = profile !== 'fast';
    if (input.explicitHybridMode && input.hybridMode !== wantsHybrid) {
        throw new Error(`RETRIEVAL_PROFILE=${profile} conflicts with HYBRID_MODE=${input.hybridMode}. Use HYBRID_MODE=${wantsHybrid} or remove the low-level override.`);
    }

    return {
        retrievalProfile: profile,
        explicitProfile: true,
        retrievalMode: wantsHybrid ? 'hybrid_bm25' : 'dense',
        retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
        bgeM3Mode: input.bgeM3Mode,
        storeColbert: input.bgeM3StoreColbert,
        usesHybridSearch: wantsHybrid,
        usesBgeM3Sparse: false,
        usesColbert: false,
    };
}
