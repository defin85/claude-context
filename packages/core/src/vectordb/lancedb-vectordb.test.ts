import { LanceDbVectorDatabase } from './lancedb-vectordb';

describe('LanceDbVectorDatabase write capabilities', () => {
    it('declares single-writer collection writes with coalescing enabled', () => {
        const db = new LanceDbVectorDatabase({ uri: '/tmp/claude-context-lancedb-test' });

        expect(db.getWriteCapabilities('chunks')).toEqual(expect.objectContaining({
            parallelWritesToSameCollection: false,
            idempotentUpsert: true,
            retrySafeInsertModes: {
                regular: false,
                hybrid: false,
                bge_m3: false,
            },
            recommendedInsertConcurrency: 1,
            writeCoalescingRecommended: true,
            ambiguousWriteFailureMode: 'fail_fast',
        }));
    });
});
