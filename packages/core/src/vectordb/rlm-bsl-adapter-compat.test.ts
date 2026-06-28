import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LanceDbVectorDatabase } from './lancedb-vectordb';
import { MilvusRestfulVectorDatabase } from './milvus-restful-vectordb';
import { MilvusVectorDatabase } from './milvus-vectordb';
import { VectorDocument } from './types';

const bslMetadata = {
    provider: 'rlm-tools-bsl',
    status: 'available',
    sourceFingerprint: 'fingerprint-1',
    objectName: 'СкладскойЖурнал',
    symbols: [{
        name: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
        declarationKind: 'function',
        startLine: 10,
        endLine: 18,
    }],
};

function document(): VectorDocument {
    return {
        id: 'chunk-1',
        vector: [0.1, 0.2, 0.3],
        sparseVector: { indices: [1], values: [0.4] },
        colbertVectors: [[0.1, 0.2]],
        content: 'Функция ПараметрыЗаполненияЗаписейСкладскогоЖурнала() КонецФункции',
        relativePath: 'CommonModules/СкладскойЖурнал/Ext/Module.bsl',
        startLine: 10,
        endLine: 18,
        fileExtension: '.bsl',
        metadata: {
            language: 'bsl',
            bsl: bslMetadata,
        },
    };
}

describe('RLM BSL vector adapter compatibility', () => {
    it('preserves nested metadata.bsl through LanceDB row serialization and collection metadata storage', async () => {
        const uri = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-lancedb-compat-'));
        const db = new LanceDbVectorDatabase({ uri }) as any;
        const row = db.documentToRow(document());

        expect(JSON.parse(row.metadata_json).bsl).toEqual(bslMetadata);
        expect(db.rowToDocument(row).metadata.bsl).toEqual(bslMetadata);

        await db.saveCollectionMetadata('bge_m3_code_chunks_demo', {
            description: [
                'retrievalMode:bge_m3_full',
                'enrichmentProvider:rlm-tools-bsl',
                'enrichmentStatus:available',
                'enrichmentSourceFingerprint:fingerprint-1',
            ].join('\n'),
            mode: 'bge_m3_full',
            dimension: 3,
        });

        await expect(db.getCollectionDescription('bge_m3_code_chunks_demo'))
            .resolves.toContain('enrichmentProvider:rlm-tools-bsl');
    });

    it('preserves nested metadata.bsl in Milvus JSON payloads and reads collection descriptions', async () => {
        const db = new MilvusVectorDatabase({ address: 'localhost:19530' }) as any;
        db.initializationPromise = Promise.resolve();
        db.initializationError = null;
        db.client = {
            upsert: jest.fn(),
            describeCollection: jest.fn().mockResolvedValue({
                schema: {
                    description: 'retrievalMode:bge_m3_full\nenrichmentProvider:rlm-tools-bsl',
                },
            }),
        };

        const [entity] = db.toBgeM3Entities([document()]);

        expect(JSON.parse(entity.metadata).bsl).toEqual(bslMetadata);
        expect(db.getWriteCapabilities('chunks').retrySafeInsertModes).toEqual({
            regular: false,
            hybrid: false,
            bge_m3: true,
        });
        await expect(db.getCollectionDescription('bge_m3_code_chunks_demo'))
            .resolves.toContain('enrichmentProvider:rlm-tools-bsl');
    });

    it('preserves nested metadata.bsl in Milvus REST JSON payloads and reads collection descriptions', async () => {
        const db = new MilvusRestfulVectorDatabase({ address: 'http://localhost:19530', database: 'default' }) as any;
        db.initializationPromise = Promise.resolve();
        db.makeRequest = jest.fn().mockResolvedValue({
            data: {
                description: 'retrievalMode:bge_m3_full\nenrichmentProvider:rlm-tools-bsl',
            },
        });

        const [entity] = db.toBgeM3Entities([document()]);

        expect(JSON.parse(entity.metadata).bsl).toEqual(bslMetadata);
        expect(db.getWriteCapabilities('chunks').retrySafeInsertModes).toEqual({
            regular: false,
            hybrid: false,
            bge_m3: true,
        });
        await expect(db.getCollectionDescription('bge_m3_code_chunks_demo'))
            .resolves.toContain('enrichmentProvider:rlm-tools-bsl');
        expect(db.makeRequest).toHaveBeenCalledWith('/collections/describe', 'POST', {
            collectionName: 'bge_m3_code_chunks_demo',
            dbName: 'default',
        });
    });
});
