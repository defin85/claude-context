import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { RetrievalMode, VectorDatabase } from '@zilliz/claude-context-core';
import type { CodebaseInfo } from './config.js';
import type { CodebaseConfigManager } from './codebase-config.js';
import type { SnapshotManager } from './snapshot.js';
import { getErrorMessage, normalizeCodebasePath } from './utils.js';

export type StorageAuditSnapshotStatus = CodebaseInfo['status'] | 'not_found';
export type StorageAuditOwnershipSource = 'description' | 'known-codebase-name' | 'unknown';
export type StorageAuditCollectionKind = 'code' | 'non_code';
export type StorageAuditRisk = 'normal' | 'stale_snapshot' | 'orphan_candidate' | 'snapshot_only_missing_collection';

export interface LocalMilvusVolumeCategory {
    name: string;
    path: string;
    sizeBytes: number;
    approximate: true;
}

export interface LocalMilvusVolumeSummary {
    path: string;
    exists: boolean;
    sizeBytes?: number;
    approximate: true;
    categories: LocalMilvusVolumeCategory[];
    warnings: string[];
}

export interface StorageAuditCollection {
    collectionName: string;
    kind: StorageAuditCollectionKind;
    codebasePath?: string;
    ownershipSource: StorageAuditOwnershipSource;
    description: string;
    rowCount?: number;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
    snapshotStatus: StorageAuditSnapshotStatus;
    codebaseConfig?: Record<string, unknown>;
    storageCost: {
        highStorageCost: boolean;
        reasons: string[];
    };
    risks: StorageAuditRisk[];
    errors: string[];
}

export interface SnapshotOnlyStorageAuditEntry {
    codebasePath: string;
    snapshotStatus: StorageAuditSnapshotStatus;
    expectedCollections: string[];
    risk: 'snapshot_only_missing_collection';
}

export interface StorageAuditReport {
    generatedAt: string;
    localVolume?: LocalMilvusVolumeSummary;
    collections: StorageAuditCollection[];
    snapshotOnly: SnapshotOnlyStorageAuditEntry[];
    summary: {
        collectionCount: number;
        codeCollectionCount: number;
        knownCodebaseCount: number;
        orphanCandidateCount: number;
        staleSnapshotCount: number;
        snapshotOnlyMissingCollectionCount: number;
    };
    warnings: string[];
}

export interface ReclaimPlanAction {
    type: 'drop_collection' | 'remove_snapshot' | 'remove_codebase_config';
    target: string;
    required: boolean;
}

export interface ReclaimPlan {
    generatedAt: string;
    dryRun: true;
    codebasePath: string;
    snapshotStatus: StorageAuditSnapshotStatus;
    collections: StorageAuditCollection[];
    actions: ReclaimPlanAction[];
    willLoseIndex: boolean;
    reindexRequired: boolean;
    warnings: string[];
}

export interface ReclaimExecutionResult {
    generatedAt: string;
    codebasePath: string;
    confirmed: true;
    actions: Array<ReclaimPlanAction & { status: 'completed' | 'skipped' }>;
    warnings: string[];
}

export interface StorageAuditOptions {
    includeLocalVolume?: boolean;
    localVolumePath?: string;
    includeRowCounts?: boolean;
    now?: Date;
}

export interface StorageAuditDependencies {
    vectorDatabase: Pick<VectorDatabase, 'listCollections' | 'getCollectionDescription' | 'getCollectionRowCount'>;
    snapshotManager: Pick<SnapshotManager, 'getAllCodebaseInfo'>;
    codebaseConfigManager: Pick<CodebaseConfigManager, 'listConfiguredCodebases' | 'getConfig'>;
    sizeReader?: LocalSizeReader;
}

export interface ReclaimExecutionDependencies {
    vectorDatabase: Pick<VectorDatabase, 'dropCollection'>;
    snapshotManager: Pick<SnapshotManager, 'removeCodebaseCompletely' | 'saveCodebaseSnapshot'>;
    codebaseConfigManager: Pick<CodebaseConfigManager, 'removeConfig'>;
}

type LocalSizeReader = (targetPath: string) => number | undefined;

const CODE_COLLECTION_PREFIXES = [
    'code_chunks',
    'hybrid_code_chunks',
    'bge_m3_code_chunks',
    'bge_m3_dense_code_chunks',
] as const;

const DEFAULT_LOCAL_MILVUS_VOLUME_PATH = path.join(
    os.homedir(),
    '.local',
    'share',
    'claude-context',
    'milvus',
    'volumes',
);

function pathHash(codebasePath: string): string {
    return crypto
        .createHash('md5')
        .update(normalizeCodebasePath(codebasePath))
        .digest('hex')
        .substring(0, 8);
}

export function getKnownCollectionNamesForCodebase(codebasePath: string): string[] {
    const hash = pathHash(codebasePath);
    return CODE_COLLECTION_PREFIXES.map((prefix) => `${prefix}_${hash}`);
}

export function parseCollectionDescription(description: string): {
    codebasePath?: string;
    retrievalMode?: RetrievalMode;
    retrievalSchemaVersion?: number;
} {
    const parsed: {
        codebasePath?: string;
        retrievalMode?: RetrievalMode;
        retrievalSchemaVersion?: number;
    } = {};

    for (const line of description.split(/\r?\n/)) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex < 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (key === 'codebasePath' && value.length > 0) {
            parsed.codebasePath = normalizeCodebasePath(value);
        } else if (key === 'retrievalMode' && value.length > 0) {
            parsed.retrievalMode = value as RetrievalMode;
        } else if (key === 'retrievalSchemaVersion') {
            const version = Number.parseInt(value, 10);
            if (Number.isInteger(version)) {
                parsed.retrievalSchemaVersion = version;
            }
        }
    }

    return parsed;
}

function isCodeCollection(collectionName: string): boolean {
    return CODE_COLLECTION_PREFIXES.some((prefix) => collectionName.startsWith(`${prefix}_`));
}

function defaultSizeReader(targetPath: string): number | undefined {
    try {
        const output = execFileSync('du', ['-sk', targetPath], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const sizeKiB = Number.parseInt(output.split(/\s+/, 1)[0], 10);
        return Number.isFinite(sizeKiB) ? sizeKiB * 1024 : undefined;
    } catch {
        return undefined;
    }
}

function buildCollectionToCodebaseMap(codebasePaths: string[]): Map<string, string> {
    const collectionToCodebase = new Map<string, string>();
    for (const codebasePath of codebasePaths) {
        for (const collectionName of getKnownCollectionNamesForCodebase(codebasePath)) {
            collectionToCodebase.set(collectionName, codebasePath);
        }
    }
    return collectionToCodebase;
}

function inferStorageCost(collectionName: string, retrievalMode?: RetrievalMode): StorageAuditCollection['storageCost'] {
    const reasons: string[] = [];
    if (retrievalMode === 'bge_m3_full' || collectionName.startsWith('bge_m3_code_chunks_')) {
        reasons.push('BGE-M3 full retrieval stores dense vectors, sparse weights, and ColBERT token-vector payloads.');
    }

    return {
        highStorageCost: reasons.length > 0,
        reasons,
    };
}

async function readLocalVolumeSummary(
    volumePath: string,
    sizeReader: LocalSizeReader,
): Promise<LocalMilvusVolumeSummary> {
    const exists = fs.existsSync(volumePath);
    const summary: LocalMilvusVolumeSummary = {
        path: volumePath,
        exists,
        approximate: true,
        categories: [],
        warnings: [],
    };

    if (!exists) {
        summary.warnings.push(`Local Milvus volume path does not exist: ${volumePath}`);
        return summary;
    }

    summary.sizeBytes = sizeReader(volumePath);
    const filesRoot = path.join(volumePath, 'minio', 'a-bucket', 'files');
    for (const name of ['wp', 'insert_log', 'index_files']) {
        const categoryPath = path.join(filesRoot, name);
        if (fs.existsSync(categoryPath)) {
            const sizeBytes = sizeReader(categoryPath);
            if (typeof sizeBytes === 'number') {
                summary.categories.push({
                    name,
                    path: categoryPath,
                    sizeBytes,
                    approximate: true,
                });
            }
        }
    }

    if (typeof summary.sizeBytes !== 'number' && summary.categories.length > 0) {
        summary.sizeBytes = summary.categories.reduce((total, category) => total + category.sizeBytes, 0);
        summary.warnings.push('Whole-volume size could not be read; sizeBytes is a lower-bound sum of known object-store categories.');
    }

    summary.warnings.push('Local volume sizes are aggregate filesystem estimates and are not exact per-collection ownership.');
    return summary;
}

export async function createLocalMilvusStorageAuditReport(
    dependencies: StorageAuditDependencies,
    options: StorageAuditOptions = {},
): Promise<StorageAuditReport> {
    const now = options.now || new Date();
    const snapshotInfo = dependencies.snapshotManager.getAllCodebaseInfo();
    const snapshotPaths = Object.keys(snapshotInfo).map(normalizeCodebasePath);
    const configuredPaths = (await dependencies.codebaseConfigManager.listConfiguredCodebases()).map(normalizeCodebasePath);
    const knownCodebasePaths = [...new Set([...snapshotPaths, ...configuredPaths])];
    const collectionToKnownCodebase = buildCollectionToCodebaseMap(knownCodebasePaths);
    const collectionNames = await dependencies.vectorDatabase.listCollections();
    const collections: StorageAuditCollection[] = [];
    const warnings: string[] = [];

    for (const collectionName of collectionNames.sort()) {
        const errors: string[] = [];
        let description = '';
        try {
            description = await dependencies.vectorDatabase.getCollectionDescription(collectionName);
        } catch (error) {
            errors.push(`description: ${getErrorMessage(error)}`);
        }

        const parsedDescription = parseCollectionDescription(description);
        const knownPath = collectionToKnownCodebase.get(collectionName);
        const codebasePath = parsedDescription.codebasePath || knownPath;
        const ownershipSource: StorageAuditOwnershipSource = parsedDescription.codebasePath
            ? 'description'
            : knownPath
                ? 'known-codebase-name'
                : 'unknown';

        let rowCount: number | undefined;
        if (options.includeRowCounts !== false) {
            try {
                const count = await dependencies.vectorDatabase.getCollectionRowCount(collectionName);
                if (count >= 0) {
                    rowCount = count;
                }
            } catch (error) {
                errors.push(`rowCount: ${getErrorMessage(error)}`);
            }
        }

        let codebaseConfig: Record<string, unknown> | undefined;
        if (codebasePath) {
            const config = await dependencies.codebaseConfigManager.getConfig(codebasePath);
            if (config) {
                codebaseConfig = config as Record<string, unknown>;
            }
        }

        const snapshotStatus: StorageAuditSnapshotStatus = codebasePath
            ? snapshotInfo[codebasePath]?.status || 'not_found'
            : 'not_found';
        const retrievalMode = parsedDescription.retrievalMode || codebaseConfig?.retrievalMode as RetrievalMode | undefined;
        const retrievalSchemaVersion = parsedDescription.retrievalSchemaVersion
            ?? (typeof codebaseConfig?.retrievalSchemaVersion === 'number' ? codebaseConfig.retrievalSchemaVersion : undefined);
        const kind: StorageAuditCollectionKind = isCodeCollection(collectionName) ? 'code' : 'non_code';
        const risks: StorageAuditRisk[] = [];

        if (kind === 'code' && !codebasePath) {
            risks.push('orphan_candidate');
        }
        if (codebasePath && snapshotStatus === 'not_found') {
            risks.push('stale_snapshot');
        }

        collections.push({
            collectionName,
            kind,
            codebasePath,
            ownershipSource,
            description,
            rowCount,
            retrievalMode,
            retrievalSchemaVersion,
            snapshotStatus,
            codebaseConfig,
            storageCost: inferStorageCost(collectionName, retrievalMode),
            risks,
            errors,
        });
    }

    const presentCollections = new Set(collectionNames);
    const snapshotOnly: SnapshotOnlyStorageAuditEntry[] = [];
    for (const codebasePath of knownCodebasePaths) {
        const expectedCollections = getKnownCollectionNamesForCodebase(codebasePath);
        const hasCollection = expectedCollections.some((collectionName) => presentCollections.has(collectionName));
        if (!hasCollection) {
            snapshotOnly.push({
                codebasePath,
                snapshotStatus: snapshotInfo[codebasePath]?.status || 'not_found',
                expectedCollections,
                risk: 'snapshot_only_missing_collection',
            });
        }
    }

    const localVolume = options.includeLocalVolume === false
        ? undefined
        : await readLocalVolumeSummary(
            options.localVolumePath || process.env.MILVUS_LOCAL_VOLUME_PATH || DEFAULT_LOCAL_MILVUS_VOLUME_PATH,
            dependencies.sizeReader || defaultSizeReader,
        );

    if (collections.some((collection) => collection.errors.length > 0)) {
        warnings.push('Some collection metadata could not be read; see collection errors.');
    }

    return {
        generatedAt: now.toISOString(),
        localVolume,
        collections,
        snapshotOnly,
        summary: {
            collectionCount: collections.length,
            codeCollectionCount: collections.filter((collection) => collection.kind === 'code').length,
            knownCodebaseCount: new Set(collections.map((collection) => collection.codebasePath).filter(Boolean)).size,
            orphanCandidateCount: collections.filter((collection) => collection.risks.includes('orphan_candidate')).length,
            staleSnapshotCount: collections.filter((collection) => collection.risks.includes('stale_snapshot')).length,
            snapshotOnlyMissingCollectionCount: snapshotOnly.length,
        },
        warnings,
    };
}

export function createDryRunReclaimPlan(
    report: StorageAuditReport,
    codebasePath: string,
): ReclaimPlan {
    const normalizedPath = normalizeCodebasePath(codebasePath);
    const collections = report.collections.filter((collection) => collection.codebasePath === normalizedPath);
    const snapshotOnlyEntry = report.snapshotOnly.find((entry) => entry.codebasePath === normalizedPath);
    const snapshotStatus = collections[0]?.snapshotStatus || snapshotOnlyEntry?.snapshotStatus || 'not_found';
    const actions: ReclaimPlanAction[] = collections.map((collection) => ({
        type: 'drop_collection',
        target: collection.collectionName,
        required: true,
    }));

    if (snapshotStatus !== 'not_found' || snapshotOnlyEntry) {
        actions.push({
            type: 'remove_snapshot',
            target: normalizedPath,
            required: true,
        });
    }
    actions.push({
        type: 'remove_codebase_config',
        target: normalizedPath,
        required: false,
    });

    const warnings = [
        'Dry run only; no Milvus collections, snapshot entries, or codebase config files were modified.',
        'Confirmed reclaim must drop collections through Milvus/vector database APIs. Do not delete MinIO files directly.',
    ];
    if (collections.length === 0) {
        warnings.push('No matching Milvus collection was found; reclaim would only clean snapshot/config state if present.');
    }

    return {
        generatedAt: new Date().toISOString(),
        dryRun: true,
        codebasePath: normalizedPath,
        snapshotStatus,
        collections,
        actions,
        willLoseIndex: collections.length > 0,
        reindexRequired: collections.length > 0,
        warnings,
    };
}

export async function executeConfirmedReclaimPlan(
    plan: ReclaimPlan,
    dependencies: ReclaimExecutionDependencies,
    options: { confirm: boolean },
): Promise<ReclaimExecutionResult> {
    if (!options.confirm) {
        throw new Error('Refusing to reclaim Milvus storage without explicit confirmation.');
    }

    const actions: ReclaimExecutionResult['actions'] = [];
    const dropActions = plan.actions.filter((action) => action.type === 'drop_collection');
    for (const action of dropActions) {
        await dependencies.vectorDatabase.dropCollection(action.target);
        actions.push({ ...action, status: 'completed' });
    }

    if (plan.actions.some((action) => action.type === 'remove_snapshot')) {
        dependencies.snapshotManager.removeCodebaseCompletely(plan.codebasePath);
        await dependencies.snapshotManager.saveCodebaseSnapshot('milvus-storage-reclaim');
        actions.push({
            type: 'remove_snapshot',
            target: plan.codebasePath,
            required: true,
            status: 'completed',
        });
    }

    if (plan.actions.some((action) => action.type === 'remove_codebase_config')) {
        await dependencies.codebaseConfigManager.removeConfig(plan.codebasePath);
        actions.push({
            type: 'remove_codebase_config',
            target: plan.codebasePath,
            required: false,
            status: 'completed',
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        codebasePath: plan.codebasePath,
        confirmed: true,
        actions,
        warnings: [
            'Collections were dropped through Milvus/vector database APIs, not by deleting MinIO files directly.',
            'If filesystem usage does not fall immediately, Milvus/MinIO compaction or garbage collection may still be pending.',
        ],
    };
}
