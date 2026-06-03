import { Context, IndexAbortError } from './context';
import { Embedding, EmbeddingVector } from './embedding';
import { Splitter, CodeChunk } from './splitter';
import {
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
} from './vectordb';

class TestEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'test';
    }
}

class TestSplitter implements Splitter {
    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [{ content: code, metadata: { startLine: 1, endLine: 1, language, filePath } }];
    }

    setChunkSize(): void {}
    setChunkOverlap(): void {}
}

class TestVectorDatabase implements VectorDatabase {
    async createCollection(): Promise<void> {}
    async createHybridCollection(): Promise<void> {}
    async createBgeM3Collection(): Promise<void> {}
    async dropCollection(): Promise<void> {}
    async hasCollection(): Promise<boolean> { return false; }
    async listCollections(): Promise<string[]> { return []; }
    async insert(): Promise<void> {}
    async insertHybrid(): Promise<void> {}
    async insertBgeM3(): Promise<void> {}
    async search(): Promise<VectorSearchResult[]> { return []; }
    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> { return []; }
    async bgeM3HybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> { return []; }
    async delete(): Promise<void> {}
    async query(): Promise<Record<string, any>[]> { return []; }
    async getCollectionDescription(): Promise<string> { return ''; }
    async checkCollectionLimit(): Promise<boolean> { return true; }
    async getCollectionRowCount(): Promise<number> { return -1; }
}

describe('Context abort handling', () => {
    test('indexCodebase throws IndexAbortError when aborted before work starts', async () => {
        const context = new Context({
            embedding: new TestEmbedding(),
            vectorDatabase: new TestVectorDatabase(),
            codeSplitter: new TestSplitter(),
        });
        const controller = new AbortController();
        controller.abort();

        await expect(
            context.indexCodebase(process.cwd(), undefined, false, controller.signal),
        ).rejects.toBeInstanceOf(IndexAbortError);
    });
});
