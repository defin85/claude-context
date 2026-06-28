import { planIndexingMode } from './indexing-mode-planner';
import { InitialIndexingManifest } from './indexing-manifest';

const identity = {
    codebasePath: '/repo',
    collectionName: 'chunks_repo',
    vectorBackend: 'qdrant',
    retrievalMode: 'bge_m3_full' as const,
    vectorSchemaFingerprint: 'schema-v1',
    embeddingProfileFingerprint: 'bge-m3-full',
    splitterFingerprint: 'ast-default',
    fileSelectionFingerprint: 'files-v1',
    supportedExtensions: ['.bsl', '.json'],
    ignorePatterns: ['.git/**'],
    oneCIndexScopeProfile: 'v8unpack' as const,
};

function manifest(runState: InitialIndexingManifest['runState']): InitialIndexingManifest {
    return {
        manifestVersion: 1,
        identity,
        runState,
        traversal: {
            selectedFileCount: 1,
            hashedFileCount: 1,
            selectedFileFingerprint: 'files-v1',
        },
        batches: [],
        confirmedDocumentIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

describe('planIndexingMode', () => {
    it('selects initial_full for an empty target', () => {
        expect(planIndexingMode({ currentIdentity: identity }).mode).toBe('initial_full');
    });

    it('selects initial_resume only for compatible interrupted manifests', () => {
        const decision = planIndexingMode({
            currentIdentity: identity,
            manifest: manifest('interrupted'),
            writeSafety: { regular: true, hybrid: true, bge_m3: true },
        });

        expect(decision.mode).toBe('initial_resume');
        expect(decision.resumeEligible).toBe(true);
    });

    it('fails closed when persisted identity is incompatible', () => {
        const decision = planIndexingMode({
            currentIdentity: { ...identity, retrievalMode: 'bge_m3_dense' },
            manifest: manifest('interrupted'),
            writeSafety: { regular: true, hybrid: true, bge_m3: true },
        });

        expect(decision.mode).toBe('incompatible_requires_reindex');
        expect(decision.reason).toMatch(/retrievalMode/);
    });

    it('keeps force mode as a full rebuild and supersedes old manifests', () => {
        const decision = planIndexingMode({
            currentIdentity: identity,
            manifest: manifest('interrupted'),
            force: true,
        });

        expect(decision.mode).toBe('initial_full');
        expect(decision.supersedeManifest).toBe(true);
    });

    it('uses incremental changes only when completed index state is compatible', () => {
        const decision = planIndexingMode({
            currentIdentity: identity,
            completedIndex: {
                compatible: true,
                hasSynchronizerSnapshot: true,
            },
        });

        expect(decision.mode).toBe('incremental_changes');
    });
});
