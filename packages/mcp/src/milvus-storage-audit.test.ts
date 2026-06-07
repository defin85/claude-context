import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createDryRunReclaimPlan,
    createLocalMilvusStorageAuditReport,
    executeConfirmedReclaimPlan,
    getKnownCollectionNamesForCodebase,
    parseCollectionDescription,
} from './milvus-storage-audit.js';
import type { CodebaseInfo } from './config.js';

const ownedPath = '/repo/owned';
const failedPath = '/repo/failed';
const configuredOnlyPath = '/repo/configured-only';
const ownedCollection = getKnownCollectionNamesForCodebase(ownedPath)[2];
const failedCollection = getKnownCollectionNamesForCodebase(failedPath)[2];
const configuredOnlyCollection = getKnownCollectionNamesForCodebase(configuredOnlyPath)[0];

function createDependencies() {
    const descriptions = new Map<string, string>([
        [
            ownedCollection,
            [
                `codebasePath:${ownedPath}`,
                'retrievalMode:bge_m3_full',
                'retrievalSchemaVersion:1',
            ].join('\n'),
        ],
        [failedCollection, ''],
        [configuredOnlyCollection, ''],
        ['random_collection', ''],
        ['bge_m3_code_chunks_deadbeef', ''],
    ]);
    const rowCounts = new Map<string, number>([
        [ownedCollection, 100],
        [failedCollection, 25],
        [configuredOnlyCollection, 8],
        ['random_collection', 1],
        ['bge_m3_code_chunks_deadbeef', 4],
    ]);
    const snapshotInfo: Record<string, CodebaseInfo> = {
        [ownedPath]: {
            status: 'indexed',
            indexedFiles: 10,
            totalChunks: 100,
            indexStatus: 'completed',
            lastUpdated: new Date(0).toISOString(),
        },
        [failedPath]: {
            status: 'indexfailed',
            errorMessage: 'stopped',
            lastUpdated: new Date(0).toISOString(),
        },
    };

    return {
        vectorDatabase: {
            listCollections: async () => [
                ownedCollection,
                failedCollection,
                configuredOnlyCollection,
                'random_collection',
                'bge_m3_code_chunks_deadbeef',
            ],
            getCollectionDescription: async (collectionName: string) => descriptions.get(collectionName) || '',
            getCollectionRowCount: async (collectionName: string) => rowCounts.get(collectionName) ?? -1,
        },
        snapshotManager: {
            getAllCodebaseInfo: () => snapshotInfo,
        },
        codebaseConfigManager: {
            listConfiguredCodebases: async () => [configuredOnlyPath],
            getConfig: async (codebasePath: string) => {
                if (codebasePath === configuredOnlyPath) {
                    return { customExtensions: ['.bsl'], customIgnorePatterns: [], retrievalMode: 'dense' as const };
                }
                return null;
            },
        },
        sizeReader: (targetPath: string) => {
            if (targetPath.endsWith('/volumes')) return 1024;
            if (targetPath.endsWith('/wp')) return 512;
            if (targetPath.endsWith('/insert_log')) return 256;
            if (targetPath.endsWith('/index_files')) return 128;
            return undefined;
        },
    };
}

test('parseCollectionDescription extracts codebase and retrieval metadata', () => {
    const parsed = parseCollectionDescription('codebasePath:/repo/a\nretrievalMode:bge_m3_full\nretrievalSchemaVersion:2');

    assert.equal(parsed.codebasePath, '/repo/a');
    assert.equal(parsed.retrievalMode, 'bge_m3_full');
    assert.equal(parsed.retrievalSchemaVersion, 2);
});

test('audit maps owned, configured, stale, and orphan candidate collections', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        includeLocalVolume: false,
        now: new Date(0),
    });

    const owned = report.collections.find((collection) => collection.collectionName === ownedCollection);
    assert.equal(owned?.codebasePath, ownedPath);
    assert.equal(owned?.ownershipSource, 'description');
    assert.equal(owned?.rowCount, 100);
    assert.equal(owned?.snapshotStatus, 'indexed');
    assert.equal(owned?.storageCost.highStorageCost, true);

    const failed = report.collections.find((collection) => collection.collectionName === failedCollection);
    assert.equal(failed?.codebasePath, failedPath);
    assert.equal(failed?.ownershipSource, 'known-codebase-name');
    assert.equal(failed?.snapshotStatus, 'indexfailed');

    const configured = report.collections.find((collection) => collection.collectionName === configuredOnlyCollection);
    assert.equal(configured?.codebasePath, configuredOnlyPath);
    assert.equal(configured?.snapshotStatus, 'not_found');
    assert.deepEqual(configured?.risks, ['stale_snapshot']);

    const orphan = report.collections.find((collection) => collection.collectionName === 'bge_m3_code_chunks_deadbeef');
    assert.equal(orphan?.codebasePath, undefined);
    assert.deepEqual(orphan?.risks, ['orphan_candidate']);
    assert.equal(report.summary.orphanCandidateCount, 1);
});

test('audit reports local volume aggregate categories as approximate filesystem sizes', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        localVolumePath: '/not-created-in-test/volumes',
        now: new Date(0),
    });

    assert.equal(report.localVolume?.exists, false);
    assert.equal(report.localVolume?.approximate, true);
});

test('dry-run reclaim reports planned destructive actions without mutation', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        includeLocalVolume: false,
        now: new Date(0),
    });
    const plan = createDryRunReclaimPlan(report, failedPath);

    assert.equal(plan.dryRun, true);
    assert.equal(plan.codebasePath, failedPath);
    assert.equal(plan.willLoseIndex, true);
    assert.equal(plan.reindexRequired, true);
    assert.deepEqual(plan.actions.map((action) => action.type), [
        'drop_collection',
        'remove_snapshot',
        'remove_codebase_config',
    ]);
    assert.match(plan.warnings.join('\n'), /Dry run only/);
    assert.match(plan.warnings.join('\n'), /Do not delete MinIO files directly/);
});

test('confirmed reclaim refuses to run without explicit confirmation', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        includeLocalVolume: false,
        now: new Date(0),
    });
    const plan = createDryRunReclaimPlan(report, failedPath);

    await assert.rejects(
        () => executeConfirmedReclaimPlan(plan, {
            vectorDatabase: { dropCollection: async () => undefined },
            snapshotManager: {
                removeCodebaseCompletely: () => undefined,
                saveCodebaseSnapshot: async () => undefined,
            },
            codebaseConfigManager: { removeConfig: async () => undefined },
        }, { confirm: false }),
        /without explicit confirmation/,
    );
});

test('confirmed reclaim drops collections through vector DB before snapshot cleanup', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        includeLocalVolume: false,
        now: new Date(0),
    });
    const plan = createDryRunReclaimPlan(report, failedPath);
    const calls: string[] = [];

    const result = await executeConfirmedReclaimPlan(plan, {
        vectorDatabase: {
            dropCollection: async (collectionName: string) => {
                calls.push(`drop:${collectionName}`);
            },
        },
        snapshotManager: {
            removeCodebaseCompletely: (codebasePath: string) => {
                calls.push(`snapshot:${codebasePath}`);
            },
            saveCodebaseSnapshot: async (reason: string) => {
                calls.push(`save:${reason}`);
            },
        },
        codebaseConfigManager: {
            removeConfig: async (codebasePath: string) => {
                calls.push(`config:${codebasePath}`);
            },
        },
    }, { confirm: true });

    assert.deepEqual(calls, [
        `drop:${failedCollection}`,
        `snapshot:${failedPath}`,
        'save:milvus-storage-reclaim',
        `config:${failedPath}`,
    ]);
    assert.equal(result.confirmed, true);
    assert.equal(result.actions.every((action) => action.status === 'completed'), true);
});

test('confirmed reclaim cleans snapshot and config when collection is already missing', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        includeLocalVolume: false,
        now: new Date(0),
    });
    const missingPath = '/repo/snapshot-only';
    report.snapshotOnly.push({
        codebasePath: missingPath,
        snapshotStatus: 'indexfailed',
        expectedCollections: getKnownCollectionNamesForCodebase(missingPath),
        risk: 'snapshot_only_missing_collection',
    });
    const plan = createDryRunReclaimPlan(report, missingPath);
    const calls: string[] = [];

    const result = await executeConfirmedReclaimPlan(plan, {
        vectorDatabase: {
            dropCollection: async (collectionName: string) => {
                calls.push(`drop:${collectionName}`);
            },
        },
        snapshotManager: {
            removeCodebaseCompletely: (codebasePath: string) => {
                calls.push(`snapshot:${codebasePath}`);
            },
            saveCodebaseSnapshot: async (reason: string) => {
                calls.push(`save:${reason}`);
            },
        },
        codebaseConfigManager: {
            removeConfig: async (codebasePath: string) => {
                calls.push(`config:${codebasePath}`);
            },
        },
    }, { confirm: true });

    assert.equal(plan.collections.length, 0);
    assert.match(plan.warnings.join('\n'), /No matching Milvus collection/);
    assert.deepEqual(calls, [
        `snapshot:${missingPath}`,
        'save:milvus-storage-reclaim',
        `config:${missingPath}`,
    ]);
    assert.deepEqual(result.actions.map((action) => action.type), [
        'remove_snapshot',
        'remove_codebase_config',
    ]);
});

test('confirmed reclaim stops before snapshot cleanup when collection drop fails', async () => {
    const report = await createLocalMilvusStorageAuditReport(createDependencies(), {
        includeLocalVolume: false,
        now: new Date(0),
    });
    const plan = createDryRunReclaimPlan(report, failedPath);
    const calls: string[] = [];

    await assert.rejects(
        () => executeConfirmedReclaimPlan(plan, {
            vectorDatabase: {
                dropCollection: async (collectionName: string) => {
                    calls.push(`drop:${collectionName}`);
                    throw new Error('drop failed');
                },
            },
            snapshotManager: {
                removeCodebaseCompletely: (codebasePath: string) => {
                    calls.push(`snapshot:${codebasePath}`);
                },
                saveCodebaseSnapshot: async (reason: string) => {
                    calls.push(`save:${reason}`);
                },
            },
            codebaseConfigManager: {
                removeConfig: async (codebasePath: string) => {
                    calls.push(`config:${codebasePath}`);
                },
            },
        }, { confirm: true }),
        /drop failed/,
    );

    assert.deepEqual(calls, [`drop:${failedCollection}`]);
});
