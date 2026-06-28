import * as crypto from 'node:crypto';
import {
    HybridSearchOptions,
    HybridSearchRequest,
    HybridSearchResult,
    SearchOptions,
    VectorDatabase,
    VectorDocument,
    VectorWriteCapabilities,
    VectorSearchResult,
} from './types';

export interface QdrantConfig {
    url: string;
    apiKey?: string;
}

interface CollectionMetadata {
    description: string;
    mode: 'dense' | 'hybrid' | 'bge_m3';
    dimension: number;
}

export class QdrantVectorDatabase implements VectorDatabase {
    private readonly baseUrl: string;
    private readonly headers: Record<string, string>;

    constructor(config: QdrantConfig) {
        this.baseUrl = config.url.replace(/\/+$/, '');
        this.headers = { 'content-type': 'application/json' };
        if (config.apiKey) {
            this.headers['api-key'] = config.apiKey;
        }
    }

    async createCollection(collectionName: string, dimension: number, description = ''): Promise<void> {
        await this.createCollectionWithMode(collectionName, dimension, description, 'dense');
    }

    async createHybridCollection(collectionName: string, dimension: number, description = ''): Promise<void> {
        await this.createCollectionWithMode(collectionName, dimension, description, 'hybrid');
    }

    async createBgeM3Collection(collectionName: string, dimension: number, description = ''): Promise<void> {
        await this.createCollectionWithMode(collectionName, dimension, description, 'bge_m3');
    }

    async dropCollection(collectionName: string): Promise<void> {
        if (!(await this.hasCollection(collectionName))) {
            return;
        }
        await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}`, {
            method: 'DELETE',
        });
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        const response = await fetch(`${this.baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
            method: 'GET',
            headers: this.withoutContentType(),
        });
        if (response.status === 404) {
            return false;
        }
        if (!response.ok) {
            throw new Error(`Qdrant collection check failed for '${collectionName}': ${response.status} ${await response.text()}`);
        }
        return true;
    }

    async listCollections(): Promise<string[]> {
        const response = await this.fetchJson('/collections', {
            method: 'GET',
            headers: this.withoutContentType(),
        });
        return (response.result?.collections || []).map((collection: any) => collection.name).filter(Boolean);
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.upsertDocuments(collectionName, documents);
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.upsertDocuments(collectionName, documents);
    }

    async insertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.upsertDocuments(collectionName, documents);
    }

    async upsertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.upsertDocuments(collectionName, documents);
    }

    getWriteCapabilities(_collectionName?: string): VectorWriteCapabilities {
        return {
            backend: 'qdrant',
            parallelWritesToSameCollection: true,
            idempotentUpsert: true,
            retrySafeInsertModes: {
                regular: true,
                hybrid: true,
                bge_m3: true,
            },
            recommendedInsertConcurrency: 4,
            targetCoalescedDocumentCount: 200,
            maxCoalescedDocumentCount: 400,
            writeCoalescingRecommended: true,
            ambiguousWriteFailureMode: 'retry_safe',
        };
    }

    async search(collectionName: string, queryVector: number[], options: SearchOptions = {}): Promise<VectorSearchResult[]> {
        const response = await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points/query`, {
            method: 'POST',
            body: JSON.stringify({
                query: queryVector,
                using: 'dense',
                limit: options.topK || 10,
                with_payload: true,
                with_vector: false,
                ...(options.filterExpr ? { filter: parseFilterExpr(options.filterExpr) } : {}),
            }),
        });
        return qdrantPoints(response).map((point) => ({
            document: this.pointToDocument(point),
            score: Number(point.score || 0),
        }));
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
        return this.bgeM3HybridSearch(collectionName, searchRequests, options);
    }

    async bgeM3HybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
        const prefetch = searchRequests.map((request) => ({
            query: request.data,
            using: qdrantVectorName(request.anns_field),
            limit: request.limit,
        }));
        const response = await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points/query`, {
            method: 'POST',
            body: JSON.stringify({
                prefetch,
                query: { fusion: 'rrf' },
                limit: options.limit || 10,
                with_payload: true,
                with_vector: ['colbert'],
                ...(options.filterExpr ? { filter: parseFilterExpr(options.filterExpr) } : {}),
            }),
        });
        return qdrantPoints(response).map((point) => ({
            document: this.pointToDocument(point),
            score: Number(point.score || 0),
        }));
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }
        await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points/delete?wait=true`, {
            method: 'POST',
            body: JSON.stringify({
                filter: {
                    must: [{
                        key: 'id',
                        match: { any: ids },
                    }],
                },
            }),
        });
    }

    async query(collectionName: string, filter: string | undefined, outputFields: string[], limit = 100): Promise<Record<string, any>[]> {
        const response = await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points/scroll`, {
            method: 'POST',
            body: JSON.stringify({
                limit,
                with_payload: true,
                with_vector: false,
                ...(filter ? { filter: parseFilterExpr(filter) } : {}),
            }),
        });
        return (response.result?.points || []).map((point: any) => {
            const payload = point.payload || {};
            return projectPayload(payload, outputFields);
        });
    }

    async getCollectionDescription(collectionName: string): Promise<string> {
        const response = await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}`, {
            method: 'GET',
            headers: this.withoutContentType(),
        });
        const metadata = response.result?.config?.params?.on_disk_payload
            ? undefined
            : response.result?.payload_schema?._claude_context_metadata;
        void metadata;
        const collectionMetadata = await this.readCollectionMetadata(collectionName);
        if (collectionMetadata?.description) {
            return collectionMetadata.description;
        }
        if (collectionName.startsWith('bge_m3_code_chunks_') && hasBgeM3VectorSchema(response)) {
            return 'retrievalMode:bge_m3_full\nretrievalSchemaVersion:1';
        }
        return '';
    }

    async checkCollectionLimit(): Promise<boolean> {
        return true;
    }

    async getCollectionRowCount(collectionName: string): Promise<number> {
        if (!(await this.hasCollection(collectionName))) {
            return -1;
        }
        const response = await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points/count`, {
            method: 'POST',
            body: JSON.stringify({ exact: true }),
        });
        return Number(response.result?.count ?? -1);
    }

    private async createCollectionWithMode(collectionName: string, dimension: number, description: string, mode: CollectionMetadata['mode']): Promise<void> {
        await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}`, {
            method: 'PUT',
            body: JSON.stringify({
                vectors: {
                    dense: {
                        size: dimension,
                        distance: 'Cosine',
                    },
                    colbert: {
                        size: dimension,
                        distance: 'Cosine',
                        multivector_config: {
                            comparator: 'max_sim',
                        },
                    },
                },
                sparse_vectors: {
                    sparse: {
                        index: {
                            on_disk: false,
                        },
                    },
                },
            }),
        });
        await this.saveCollectionMetadata(collectionName, { description, mode, dimension });
    }

    private async upsertDocuments(collectionName: string, documents: VectorDocument[]): Promise<void> {
        if (documents.length === 0) {
            return;
        }
        await this.fetchJson(
            `/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
            {
                method: 'PUT',
                body: JSON.stringify({
                    points: documents.map((document) => ({
                        id: stableUuid(document.id),
                        vector: toQdrantVectorPayload(document),
                        payload: {
                            id: document.id,
                            content: document.content,
                            relativePath: document.relativePath,
                            startLine: document.startLine,
                            endLine: document.endLine,
                            fileExtension: document.fileExtension,
                            metadata: document.metadata || {},
                        },
                    })),
                }),
            },
            { retryTransientFetchFailures: true },
        );
    }

    private pointToDocument(point: any): VectorDocument {
        const payload = point.payload || {};
        return {
            id: String(payload.id || point.id),
            vector: [],
            sparseVector: { indices: [], values: [] },
            colbertVectors: extractColbertVectors(point.vector),
            content: String(payload.content || ''),
            relativePath: String(payload.relativePath || ''),
            startLine: Number(payload.startLine || 0),
            endLine: Number(payload.endLine || 0),
            fileExtension: String(payload.fileExtension || ''),
            metadata: payload.metadata || {},
        };
    }

    private async saveCollectionMetadata(collectionName: string, metadata: CollectionMetadata): Promise<void> {
        const metadataId = `__claude_context_metadata__:${collectionName}`;
        await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points?wait=true`, {
            method: 'PUT',
            body: JSON.stringify({
                points: [{
                    id: stableUuid(metadataId),
                    vector: {
                        dense: Array(metadata.dimension).fill(0),
                        sparse: { indices: [], values: [] },
                        colbert: [Array(metadata.dimension).fill(0)],
                    },
                    payload: {
                        id: metadataId,
                        _claudeContextMetadata: metadata,
                    },
                }],
            }),
        });
    }

    private async readCollectionMetadata(collectionName: string): Promise<CollectionMetadata | undefined> {
        const metadataId = `__claude_context_metadata__:${collectionName}`;
        const response = await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points/scroll`, {
            method: 'POST',
            body: JSON.stringify({
                limit: 1,
                with_payload: true,
                with_vector: false,
                filter: {
                    must: [{
                        key: 'id',
                        match: { value: metadataId },
                    }],
                },
            }),
        });
        const metadata = response.result?.points?.[0]?.payload?._claudeContextMetadata;
        if (!metadata || typeof metadata !== 'object') {
            return undefined;
        }
        return metadata as CollectionMetadata;
    }

    private async fetchJson(
        pathname: string,
        init: RequestInit = {},
        options: { retryTransientFetchFailures?: boolean } = {},
    ): Promise<any> {
        const attempts = options.retryTransientFetchFailures ? 3 : 1;
        let lastError: unknown;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const response = await fetch(`${this.baseUrl}${pathname}`, {
                    ...init,
                    headers: {
                        ...this.headers,
                        ...(init.headers || {}),
                        'connection': 'close',
                    },
                });
                if (!response.ok) {
                    throw new Error(`Qdrant request failed: ${response.status} ${await response.text()}`);
                }
                return response.json();
            } catch (error) {
                lastError = error;
                if (attempt >= attempts - 1 || !isTransientFetchFailure(error)) {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    private withoutContentType(): Record<string, string> {
        const headers = { ...this.headers };
        delete headers['content-type'];
        return headers;
    }
}

function isTransientFetchFailure(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('fetch failed')
        || message.includes('connection reset')
        || message.includes('socket hang up')
        || message.includes('econnreset')
        || message.includes('econnrefused');
}

function toQdrantVectorPayload(document: VectorDocument): Record<string, unknown> {
    const vector: Record<string, unknown> = {
        dense: document.vector,
    };
    if (document.sparseVector) {
        vector.sparse = document.sparseVector;
    }
    if (document.colbertVectors && document.colbertVectors.length > 0) {
        vector.colbert = document.colbertVectors;
    }
    return vector;
}

function qdrantVectorName(field: string): string {
    if (field === 'sparse_vector') {
        return 'sparse';
    }
    if (field === 'colbert_vectors') {
        return 'colbert';
    }
    return 'dense';
}

function qdrantPoints(response: any): any[] {
    if (Array.isArray(response?.result)) {
        return response.result;
    }
    if (Array.isArray(response?.result?.points)) {
        return response.result.points;
    }
    return [];
}

function hasBgeM3VectorSchema(response: any): boolean {
    const params = response?.result?.config?.params || {};
    const vectors = params.vectors || {};
    const sparseVectors = params.sparse_vectors || params.sparseVectors || {};
    return Boolean(vectors.dense && vectors.colbert && sparseVectors.sparse);
}

function parseFilterExpr(filter: string): Record<string, any> | undefined {
    const relativePathMatch = filter.match(/^relativePath\s*==\s*"((?:\\"|[^"])*)"$/);
    if (relativePathMatch) {
        return {
            must: [{
                key: 'relativePath',
                match: { value: relativePathMatch[1].replace(/\\"/g, '"') },
            }],
        };
    }
    const likeMatch = filter.match(/^(content|relativePath)\s+like\s+"%((?:\\"|[^"])*)%"$/);
    if (likeMatch) {
        return {
            must: [{
                key: likeMatch[1],
                match: { text: likeMatch[2].replace(/\\"/g, '"') },
            }],
        };
    }
    const extensionMatch = filter.match(/^fileExtension\s+in\s+\[(.*)\]$/);
    if (extensionMatch) {
        const extensions = [...extensionMatch[1].matchAll(/['"]((?:\\.|[^'"\\])*)['"]/g)]
            .map((match) => match[1].replace(/\\(["'])/g, '$1'));
        if (extensions.length > 0) {
            return {
                must: [{
                    key: 'fileExtension',
                    match: { any: extensions },
                }],
            };
        }
    }
    return undefined;
}

function projectPayload(payload: Record<string, any>, outputFields: string[]): Record<string, any> {
    if (outputFields.length === 0) {
        return payload;
    }
    const projected: Record<string, any> = {};
    for (const field of outputFields) {
        projected[field] = field === 'metadata_json' && payload.metadata_json === undefined
            ? payload.metadata
            : payload[field];
    }
    return projected;
}

function extractColbertVectors(vector: any): number[][] {
    if (Array.isArray(vector)) {
        return isNumberMatrix(vector) ? vector : [];
    }
    const colbert = vector?.colbert;
    return isNumberMatrix(colbert) ? colbert : [];
}

function isNumberMatrix(value: unknown): value is number[][] {
    return Array.isArray(value)
        && value.every((row) => Array.isArray(row) && row.every((item) => typeof item === 'number'));
}

function stableUuid(value: string): string {
    const hash = crypto.createHash('sha256').update(value).digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
