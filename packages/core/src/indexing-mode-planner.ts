import type { InitialIndexingIdentity, InitialIndexingManifest } from './indexing-manifest';

export type IndexingMode =
    | 'initial_full'
    | 'initial_resume'
    | 'incremental_changes'
    | 'incompatible_requires_reindex';

export interface IndexingModeDecision {
    mode: IndexingMode;
    resumeEligible: boolean;
    manifestCompatibility: 'compatible' | 'missing' | 'incompatible' | 'ignored_force';
    reason?: string;
    supersedeManifest?: boolean;
}

export interface IndexingModePlannerInput {
    currentIdentity: InitialIndexingIdentity;
    manifest?: InitialIndexingManifest;
    completedIndex?: {
        compatible: boolean;
        hasSynchronizerSnapshot: boolean;
        reason?: string;
    };
    force?: boolean;
    writeSafety?: {
        regular: boolean;
        hybrid: boolean;
        bge_m3: boolean;
    };
}

export function planIndexingMode(input: IndexingModePlannerInput): IndexingModeDecision {
    if (input.force) {
        return {
            mode: 'initial_full',
            resumeEligible: false,
            manifestCompatibility: input.manifest ? 'ignored_force' : 'missing',
            supersedeManifest: Boolean(input.manifest),
            reason: input.manifest ? 'force=true ignores existing initial-indexing manifest' : undefined,
        };
    }

    if (input.completedIndex) {
        if (input.completedIndex.compatible && input.completedIndex.hasSynchronizerSnapshot) {
            return {
                mode: 'incremental_changes',
                resumeEligible: false,
                manifestCompatibility: 'missing',
            };
        }
        return {
            mode: 'incompatible_requires_reindex',
            resumeEligible: false,
            manifestCompatibility: 'incompatible',
            reason: input.completedIndex.reason || 'completed index is incompatible or missing synchronizer snapshot',
        };
    }

    if (!input.manifest) {
        return {
            mode: 'initial_full',
            resumeEligible: false,
            manifestCompatibility: 'missing',
        };
    }

    const incompatibility = findIdentityIncompatibility(input.currentIdentity, input.manifest.identity);
    if (incompatibility) {
        return {
            mode: 'incompatible_requires_reindex',
            resumeEligible: false,
            manifestCompatibility: 'incompatible',
            reason: incompatibility,
        };
    }

    if (!['interrupted', 'failed', 'cancelled', 'indexing', 'limit_reached'].includes(input.manifest.runState)) {
        return {
            mode: 'initial_full',
            resumeEligible: false,
            manifestCompatibility: 'compatible',
            reason: `manifest state '${input.manifest.runState}' is not resumable`,
        };
    }

    if (!isWriteSafeForIdentity(input.currentIdentity, input.writeSafety)) {
        return {
            mode: 'incompatible_requires_reindex',
            resumeEligible: false,
            manifestCompatibility: 'compatible',
            reason: `No safe retry path for ${insertModeForIdentity(input.currentIdentity)} writes`,
        };
    }

    return {
        mode: 'initial_resume',
        resumeEligible: true,
        manifestCompatibility: 'compatible',
    };
}

function findIdentityIncompatibility(
    current: InitialIndexingIdentity,
    previous: InitialIndexingIdentity,
): string | undefined {
    const fields: Array<keyof InitialIndexingIdentity> = [
        'codebasePath',
        'collectionName',
        'vectorBackend',
        'retrievalMode',
        'vectorSchemaFingerprint',
        'embeddingProfileFingerprint',
        'splitterFingerprint',
        'fileSelectionFingerprint',
        'oneCIndexScopeProfile',
    ];

    for (const field of fields) {
        if (current[field] !== previous[field]) {
            return `${field} changed`;
        }
    }

    if (current.supportedExtensions.join('\0') !== previous.supportedExtensions.join('\0')) {
        return 'supportedExtensions changed';
    }
    if (current.ignorePatterns.join('\0') !== previous.ignorePatterns.join('\0')) {
        return 'ignorePatterns changed';
    }
    return undefined;
}

function insertModeForIdentity(identity: InitialIndexingIdentity): 'regular' | 'hybrid' | 'bge_m3' {
    if (identity.retrievalMode === 'bge_m3_full') {
        return 'bge_m3';
    }
    if (identity.retrievalMode === 'hybrid_bm25') {
        return 'hybrid';
    }
    return 'regular';
}

function isWriteSafeForIdentity(
    identity: InitialIndexingIdentity,
    writeSafety: IndexingModePlannerInput['writeSafety'],
): boolean {
    if (!writeSafety) {
        return true;
    }
    return writeSafety[insertModeForIdentity(identity)];
}
