import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { InitialIndexingManifestStore } from './indexing-manifest';

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

describe('InitialIndexingManifestStore', () => {
    it('persists manifests atomically and reloads them by identity', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'initial-manifest-'));
        const store = new InitialIndexingManifestStore(root);
        const manifest = store.create(identity);

        await store.write(manifest);
        const loaded = await store.read(identity);

        expect(loaded?.runState).toBe('planning');
        expect(loaded?.identity).toEqual(identity);
        expect(await fs.readdir(root)).toHaveLength(1);
    });

    it('treats corrupt manifests as unusable for resume', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'initial-manifest-corrupt-'));
        const store = new InitialIndexingManifestStore(root);
        const manifest = store.create(identity);
        await store.write(manifest);
        await fs.writeFile(store.getManifestPath(identity), '{not-json', 'utf8');

        const loaded = await store.read(identity);

        expect(loaded).toBeUndefined();
    });
});
