import * as crypto from 'node:crypto';
import {
    HybridSearchOptions,
    HybridSearchRequest,
    HybridSearchResult,
    SearchOptions,
    VectorDatabase,
    VectorDocument,
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
                with_vector: false,
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
        return collectionMetadata?.description || '';
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
        await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points?wait=true`, {
            method: 'PUT',
            body: JSON.stringify({
                points: documents.map((document) => ({
                    id: stableUuid(document.id),
                    vector: {
                        dense: document.vector,
                        sparse: document.sparseVector || { indices: [], values: [] },
                        colbert: document.colbertVectors || [],
                    },
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
        });
    }

    private pointToDocument(point: any): VectorDocument {
        const payload = point.payload || {};
        return {
            id: String(payload.id || point.id),
            vector: [],
            sparseVector: { indices: [], values: [] },
            colbertVectors: [],
            content: String(payload.content || ''),
            relativePath: String(payload.relativePath || ''),
            startLine: Number(payload.startLine || 0),
            endLine: Number(payload.endLine || 0),
            fileExtension: String(payload.fileExtension || ''),
            metadata: payload.metadata || {},
        };
    }

    private async saveCollectionMetadata(collectionName: string, metadata: CollectionMetadata): Promise<void> {
        await this.fetchJson(`/collections/${encodeURIComponent(collectionName)}/points?wait=true`, {
            method: 'PUT',
            body: JSON.stringify({
                points: [{
                    id: stableUuid(`__claude_context_metadata__:${collectionName}`),
                    vector: {
                        dense: Array(metadata.dimension).fill(0),
                        sparse: { indices: [], values: [] },
                        colbert: [Array(metadata.dimension).fill(0)],
                    },
                    payload: {
                        id: `__claude_context_metadata__:${collectionName}`,
                        _claudeContextMetadata: metadata,
                    },
                }],
            }),
        });
        await this.delete(collectionName, [`__claude_context_metadata__:${collectionName}`]);
    }

    private async readCollectionMetadata(_collectionName: string): Promise<CollectionMetadata | undefined> {
        return undefined;
    }

    private async fetchJson(pathname: string, init: RequestInit = {}): Promise<any> {
        const response = await fetch(`${this.baseUrl}${pathname}`, {
            ...init,
            headers: {
                ...this.headers,
                ...(init.headers || {}),
            },
        });
        if (!response.ok) {
            throw new Error(`Qdrant request failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }

    private withoutContentType(): Record<string, string> {
        const headers = { ...this.headers };
        delete headers['content-type'];
        return headers;
    }
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
    return undefined;
}

function projectPayload(payload: Record<string, any>, outputFields: string[]): Record<string, any> {
    if (outputFields.length === 0) {
        return payload;
    }
    const projected: Record<string, any> = {};
    for (const field of outputFields) {
        projected[field] = payload[field];
    }
    return projected;
}

function stableUuid(value: string): string {
    const hash = crypto.createHash('sha256').update(value).digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
