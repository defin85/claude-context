import {
    inferRetrievalProfile,
    parseRetrievalProfile,
    resolveRetrievalProfile,
} from './retrieval-profile';

describe('retrieval performance profiles', () => {
    it('maps BGE-M3 profiles to dense-only or full multivector retrieval', () => {
        expect(resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'fast',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: true,
        })).toMatchObject({
            retrievalProfile: 'fast',
            retrievalMode: 'bge_m3_dense',
            bgeM3Mode: 'dense',
            storeColbert: false,
            usesHybridSearch: false,
            usesBgeM3Sparse: false,
            usesColbert: false,
        });

        expect(resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'balanced',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: true,
        })).toMatchObject({
            retrievalProfile: 'balanced',
            retrievalMode: 'bge_m3_dense',
            bgeM3Mode: 'dense',
            storeColbert: false,
            usesHybridSearch: false,
            usesBgeM3Sparse: false,
            usesColbert: false,
        });

        expect(resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'quality',
            bgeM3Mode: 'dense',
            bgeM3StoreColbert: true,
            hybridMode: false,
        })).toMatchObject({
            retrievalProfile: 'quality',
            retrievalMode: 'bge_m3_full',
            bgeM3Mode: 'full',
            storeColbert: true,
            usesHybridSearch: true,
            usesBgeM3Sparse: true,
            usesColbert: true,
        });
    });

    it('maps non-BGE profiles without changing chunking or batching controls', () => {
        const fast = resolveRetrievalProfile({
            embeddingProvider: 'OpenAI',
            retrievalProfile: 'fast',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: true,
        });
        expect(fast).toMatchObject({
            retrievalProfile: 'fast',
            retrievalMode: 'dense',
            usesHybridSearch: false,
        });
        expect(fast).not.toHaveProperty('splitterType');
        expect(fast).not.toHaveProperty('chunkLimit');
        expect(fast).not.toHaveProperty('chunkOverlap');
        expect(fast).not.toHaveProperty('embeddingBatchSize');

        expect(resolveRetrievalProfile({
            embeddingProvider: 'OpenAI',
            retrievalProfile: 'balanced',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: false,
        })).toMatchObject({
            retrievalProfile: 'balanced',
            retrievalMode: 'hybrid_bm25',
            usesHybridSearch: true,
        });

        expect(resolveRetrievalProfile({
            embeddingProvider: 'OpenAI',
            retrievalProfile: 'quality',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: false,
        })).toMatchObject({
            retrievalProfile: 'quality',
            retrievalMode: 'hybrid_bm25',
            usesHybridSearch: true,
        });
    });

    it('preserves low-level behavior when no retrieval profile is configured', () => {
        expect(resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: false,
        })).toMatchObject({
            retrievalProfile: 'quality',
            explicitProfile: false,
            retrievalMode: 'bge_m3_full',
        });

        expect(resolveRetrievalProfile({
            embeddingProvider: 'OpenAI',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: false,
        })).toMatchObject({
            retrievalProfile: 'fast',
            explicitProfile: false,
            retrievalMode: 'dense',
        });
    });

    it('rejects explicit low-level settings that conflict with a configured profile', () => {
        expect(() => resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'quality',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: false,
            explicitBgeM3StoreColbert: true,
            hybridMode: true,
        })).toThrow(/RETRIEVAL_PROFILE=quality conflicts with BGE_M3_STORE_COLBERT=false/);

        expect(() => resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'fast',
            bgeM3Mode: 'full',
            explicitBgeM3Mode: true,
            bgeM3StoreColbert: true,
            hybridMode: true,
        })).toThrow(/RETRIEVAL_PROFILE=fast conflicts with BGE_M3_MODE=full/);

        expect(() => resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'fast',
            bgeM3Mode: 'dense',
            bgeM3StoreColbert: true,
            explicitBgeM3StoreColbert: true,
            hybridMode: true,
        })).toThrow(/RETRIEVAL_PROFILE=fast conflicts with BGE_M3_STORE_COLBERT=true/);

        expect(() => resolveRetrievalProfile({
            embeddingProvider: 'BGE_M3',
            retrievalProfile: 'balanced',
            bgeM3Mode: 'dense',
            bgeM3StoreColbert: true,
            explicitBgeM3StoreColbert: true,
            hybridMode: true,
        })).toThrow(/RETRIEVAL_PROFILE=balanced conflicts with BGE_M3_STORE_COLBERT=true/);

        expect(() => resolveRetrievalProfile({
            embeddingProvider: 'OpenAI',
            retrievalProfile: 'fast',
            bgeM3Mode: 'full',
            bgeM3StoreColbert: true,
            hybridMode: true,
            explicitHybridMode: true,
        })).toThrow(/RETRIEVAL_PROFILE=fast conflicts with HYBRID_MODE=true/);
    });

    it('parses and infers profiles deterministically', () => {
        expect(parseRetrievalProfile('fast')).toBe('fast');
        expect(parseRetrievalProfile(undefined)).toBeUndefined();
        expect(() => parseRetrievalProfile('slow')).toThrow(/Invalid retrievalProfile/);
        expect(inferRetrievalProfile('bge_m3_full')).toBe('quality');
        expect(inferRetrievalProfile('bge_m3_dense')).toBe('balanced');
        expect(inferRetrievalProfile('hybrid_bm25')).toBe('balanced');
        expect(inferRetrievalProfile('dense')).toBe('fast');
    });
});
