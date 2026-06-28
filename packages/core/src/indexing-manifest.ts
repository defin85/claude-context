import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { RetrievalMode } from './vectordb';
import type { OneCIndexScopeProfile } from './sync/one-c-scope';

export const INITIAL_INDEXING_MANIFEST_VERSION = 1;

export type InitialIndexingRunState =
    | 'planning'
    | 'indexing'
    | 'interrupted'
    | 'failed'
    | 'completed'
    | 'cancelled'
    | 'limit_reached'
    | 'superseded';

export type InitialIndexingBatchState =
    | 'planned'
    | 'embedding'
    | 'inserting'
    | 'inserted'
    | 'failed'
    | 'cancelled';

export interface InitialIndexingIdentity {
    codebasePath: string;
    collectionName: string;
    vectorBackend: string;
    retrievalMode: RetrievalMode;
    vectorSchemaFingerprint: string;
    embeddingProfileFingerprint: string;
    splitterFingerprint: string;
    fileSelectionFingerprint: string;
    supportedExtensions: string[];
    ignorePatterns: string[];
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
}

export interface InitialIndexingBatchRecord {
    id: string;
    state: InitialIndexingBatchState;
    filePaths: string[];
    documentIds: string[];
    error?: string;
    updatedAt: string;
}

export interface InitialIndexingManifest {
    manifestVersion: typeof INITIAL_INDEXING_MANIFEST_VERSION;
    identity: InitialIndexingIdentity;
    selectedMode?: 'initial_full' | 'initial_resume';
    runState: InitialIndexingRunState;
    traversal: {
        selectedFileCount: number;
        hashedFileCount: number;
        selectedFileFingerprint: string;
    };
    batches: InitialIndexingBatchRecord[];
    confirmedDocumentIds: string[];
    lastCompletedSynchronizerSnapshot?: string;
    createdAt: string;
    updatedAt: string;
}

export class InitialIndexingManifestStore {
    // ponytail: global write queue; use per-manifest queues if manifest write throughput matters.
    private writeQueue = Promise.resolve();

    constructor(private readonly rootDir: string) {}

    create(identity: InitialIndexingIdentity): InitialIndexingManifest {
        const now = new Date().toISOString();
        return {
            manifestVersion: INITIAL_INDEXING_MANIFEST_VERSION,
            identity: this.normalizeIdentity(identity),
            runState: 'planning',
            traversal: {
                selectedFileCount: 0,
                hashedFileCount: 0,
                selectedFileFingerprint: identity.fileSelectionFingerprint,
            },
            batches: [],
            confirmedDocumentIds: [],
            createdAt: now,
            updatedAt: now,
        };
    }

    getManifestPath(identity: InitialIndexingIdentity): string {
        const hash = crypto
            .createHash('sha256')
            .update(JSON.stringify(this.normalizeIdentity(identity)))
            .digest('hex')
            .slice(0, 32);
        return path.join(this.rootDir, `${hash}.json`);
    }

    async read(identity: InitialIndexingIdentity): Promise<InitialIndexingManifest | undefined> {
        try {
            const raw = await fs.readFile(this.getManifestPath(identity), 'utf8');
            const parsed = JSON.parse(raw) as InitialIndexingManifest;
            return this.isUsableManifest(parsed) ? parsed : undefined;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return undefined;
            }
            return undefined;
        }
    }

    async findLatestForCodebaseCollection(
        codebasePath: string,
        collectionName: string,
    ): Promise<InitialIndexingManifest | undefined> {
        let entries: string[];
        try {
            entries = await fs.readdir(this.rootDir);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }

        const manifests: InitialIndexingManifest[] = [];
        for (const entry of entries) {
            if (!entry.endsWith('.json')) {
                continue;
            }
            try {
                const parsed = JSON.parse(
                    await fs.readFile(path.join(this.rootDir, entry), 'utf8'),
                ) as InitialIndexingManifest;
                if (
                    this.isUsableManifest(parsed) &&
                    parsed.identity.codebasePath === codebasePath &&
                    parsed.identity.collectionName === collectionName
                ) {
                    manifests.push(parsed);
                }
            } catch {
                // Corrupt manifests are unusable for resume.
            }
        }

        return manifests.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    }

    async write(manifest: InitialIndexingManifest): Promise<void> {
        const nextWrite = this.writeQueue.then(() => this.writeNow(manifest));
        this.writeQueue = nextWrite.catch(() => undefined);
        await nextWrite;
    }

    private async writeNow(manifest: InitialIndexingManifest): Promise<void> {
        await fs.mkdir(this.rootDir, { recursive: true });
        const targetPath = this.getManifestPath(manifest.identity);
        const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
        const nextManifest: InitialIndexingManifest = {
            ...manifest,
            identity: this.normalizeIdentity(manifest.identity),
            updatedAt: new Date().toISOString(),
        };
        const handle = await fs.open(tempPath, 'w');
        try {
            await handle.writeFile(`${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.rename(tempPath, targetPath);
        await this.syncDirectory();
    }

    private normalizeIdentity(identity: InitialIndexingIdentity): InitialIndexingIdentity {
        return {
            ...identity,
            supportedExtensions: [...identity.supportedExtensions].sort(),
            ignorePatterns: [...identity.ignorePatterns].sort(),
        };
    }

    private isUsableManifest(value: unknown): value is InitialIndexingManifest {
        return Boolean(
            value &&
            typeof value === 'object' &&
            (value as InitialIndexingManifest).manifestVersion === INITIAL_INDEXING_MANIFEST_VERSION &&
            (value as InitialIndexingManifest).identity &&
            Array.isArray((value as InitialIndexingManifest).batches) &&
            Array.isArray((value as InitialIndexingManifest).confirmedDocumentIds),
        );
    }

    private async syncDirectory(): Promise<void> {
        let handle: fs.FileHandle | undefined;
        try {
            handle = await fs.open(this.rootDir, 'r');
            await handle.sync();
        } catch {
            // Directory fsync is best-effort across platforms.
        } finally {
            await handle?.close();
        }
    }
}
