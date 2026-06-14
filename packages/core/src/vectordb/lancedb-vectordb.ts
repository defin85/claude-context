import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
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

export interface LanceDbConfig {
    uri: string;
}

type LanceDbModule = {
    connect(uri: string): Promise<any>;
    makeArrowTable(rows: Record<string, any>[], options?: Record<string, any>): any;
};

type ArrowModule = {
    Schema: new (fields: any[]) => any;
    Field: new (name: string, type: any, nullable?: boolean) => any;
    Utf8: new () => any;
    Float32: new () => any;
    Int32: new () => any;
    FixedSizeList: new (listSize: number, child: any) => any;
    List: new (child: any) => any;
};

interface CollectionMetadata {
    description: string;
    mode: 'dense' | 'hybrid' | 'bge_m3';
    dimension: number;
}

const requireFromHere = createRequire(__filename);

export class LanceDbVectorDatabase implements VectorDatabase {
    private readonly uri: string;
    private db?: any;
    private lancedb?: LanceDbModule;
    private arrow?: ArrowModule;
    private readonly metadataPath: string;

    constructor(config: LanceDbConfig) {
        this.uri = config.uri;
        this.metadataPath = path.join(this.uri, '_claude_context_collections.json');
    }

    async createCollection(collectionName: string, dimension: number, description = ''): Promise<void> {
        await this.saveCollectionMetadata(collectionName, { description, mode: 'dense', dimension });
    }

    async createHybridCollection(collectionName: string, dimension: number, description = ''): Promise<void> {
        await this.saveCollectionMetadata(collectionName, { description, mode: 'hybrid', dimension });
    }

    async createBgeM3Collection(collectionName: string, dimension: number, description = ''): Promise<void> {
        await this.saveCollectionMetadata(collectionName, { description, mode: 'bge_m3', dimension });
    }

    async dropCollection(collectionName: string): Promise<void> {
        const db = await this.getDb();
        if (await this.hasPhysicalTable(collectionName)) {
            await db.dropTable(collectionName);
        }
        const metadata = await this.readMetadata();
        delete metadata[collectionName];
        await this.writeMetadata(metadata);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        if (await this.hasPhysicalTable(collectionName)) {
            return true;
        }
        const metadata = await this.readMetadata();
        return Boolean(metadata[collectionName]);
    }

    async listCollections(): Promise<string[]> {
        const db = await this.getDb();
        const tableNames = await db.tableNames();
        const metadata = await this.readMetadata();
        return [...new Set([...tableNames, ...Object.keys(metadata)])].sort();
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.writeDocuments(collectionName, documents, 'dense');
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.writeDocuments(collectionName, documents, 'hybrid');
    }

    async insertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.writeDocuments(collectionName, documents, 'bge_m3');
    }

    async upsertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.writeDocuments(collectionName, documents, 'bge_m3');
    }

    getWriteCapabilities(_collectionName?: string): VectorWriteCapabilities {
        return {
            backend: 'lancedb',
            parallelWritesToSameCollection: false,
            idempotentUpsert: true,
            recommendedInsertConcurrency: 1,
            targetCoalescedDocumentCount: 100,
            maxCoalescedDocumentCount: 300,
            writeCoalescingRecommended: true,
            ambiguousWriteFailureMode: 'fail_fast',
        };
    }

    async search(collectionName: string, queryVector: number[], options: SearchOptions = {}): Promise<VectorSearchResult[]> {
        const table = await this.openTable(collectionName);
        const rows = await table
            .vectorSearch(queryVector)
            .column('dense_vector')
            .limit(options.topK || 10)
            .toArray();
        return rows.map((row: Record<string, any>) => ({
            document: this.rowToDocument(row),
            score: this.rowScore(row),
        }));
    }

    async hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
        return this.searchByRequest(collectionName, searchRequests, options);
    }

    async bgeM3HybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
        return this.searchByRequest(collectionName, searchRequests, options);
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        if (ids.length === 0 || !(await this.hasPhysicalTable(collectionName))) {
            return;
        }
        const table = await this.openTable(collectionName);
        await table.delete(`id in (${ids.map((id) => `"${escapeSqlString(id)}"`).join(',')})`);
    }

    async query(collectionName: string, filter: string | undefined, outputFields: string[], limit = 100): Promise<Record<string, any>[]> {
        if (!(await this.hasPhysicalTable(collectionName))) {
            return [];
        }
        const table = await this.openTable(collectionName);
        let query = table.query();
        if (filter) {
            query = query.where(filter);
        }
        const rows = await query.limit(limit).toArray();
        return rows.map((row: Record<string, any>) => projectRow(row, outputFields));
    }

    async getCollectionDescription(collectionName: string): Promise<string> {
        const metadata = await this.readMetadata();
        return metadata[collectionName]?.description || '';
    }

    async checkCollectionLimit(): Promise<boolean> {
        return true;
    }

    async getCollectionRowCount(collectionName: string): Promise<number> {
        if (!(await this.hasPhysicalTable(collectionName))) {
            return 0;
        }
        const table = await this.openTable(collectionName);
        return table.countRows();
    }

    private async searchByRequest(collectionName: string, searchRequests: HybridSearchRequest[], options: HybridSearchOptions): Promise<HybridSearchResult[]> {
        const denseRequest = searchRequests.find((request) => Array.isArray(request.data));
        if (!denseRequest) {
            return [];
        }
        const table = await this.openTable(collectionName);
        const rows = await table
            .vectorSearch(denseRequest.data as number[])
            .column(denseRequest.anns_field === 'colbert_vectors' ? 'colbert_vectors' : 'dense_vector')
            .limit(options.limit || denseRequest.limit || 10)
            .toArray();
        return rows.map((row: Record<string, any>) => ({
            document: this.rowToDocument(row),
            score: this.rowScore(row),
        }));
    }

    private async writeDocuments(collectionName: string, documents: VectorDocument[], mode: CollectionMetadata['mode']): Promise<void> {
        if (documents.length === 0) {
            return;
        }
        await this.ensureLoaded();
        const rows = documents.map((document) => this.documentToRow(document));
        const schema = this.buildSchema(documents[0]);
        const table = this.lancedb!.makeArrowTable(rows, { schema });
        const db = await this.getDb();
        if (await this.hasPhysicalTable(collectionName)) {
            const existing = await db.openTable(collectionName);
            await existing.add(table);
        } else {
            await db.createTable(collectionName, table, { mode: 'overwrite' });
        }
        const metadata = await this.readMetadata();
        await this.saveCollectionMetadata(collectionName, {
            description: metadata[collectionName]?.description || '',
            mode,
            dimension: documents[0].vector.length,
        });
    }

    private documentToRow(document: VectorDocument): Record<string, any> {
        const sparseIndices = document.sparseVector?.indices || [];
        const sparseValues = document.sparseVector?.values || [];
        return {
            id: document.id,
            content: document.content,
            dense_vector: document.vector,
            sparse_indices: sparseIndices,
            sparse_values: sparseValues,
            colbert_vectors: document.colbertVectors || [document.vector],
            relativePath: document.relativePath,
            startLine: document.startLine,
            endLine: document.endLine,
            fileExtension: document.fileExtension,
            metadata_json: JSON.stringify(document.metadata || {}),
        };
    }

    private rowToDocument(row: Record<string, any>): VectorDocument {
        return {
            id: String(row.id),
            vector: Array.from(row.dense_vector || []),
            sparseVector: {
                indices: Array.from(row.sparse_indices || []),
                values: Array.from(row.sparse_values || []),
            },
            colbertVectors: Array.from(row.colbert_vectors || []),
            content: String(row.content || ''),
            relativePath: String(row.relativePath || ''),
            startLine: Number(row.startLine || 0),
            endLine: Number(row.endLine || 0),
            fileExtension: String(row.fileExtension || ''),
            metadata: parseMetadata(row.metadata_json),
        };
    }

    private rowScore(row: Record<string, any>): number {
        if (Number.isFinite(row._distance)) {
            return -Number(row._distance);
        }
        if (Number.isFinite(row._score)) {
            return Number(row._score);
        }
        return 0;
    }

    private buildSchema(sample: VectorDocument): any {
        const arrow = this.arrow!;
        const denseVectorType = new arrow.FixedSizeList(
            sample.vector.length,
            new arrow.Field('item', new arrow.Float32(), true),
        );
        const colbertDimension = sample.colbertVectors?.[0]?.length || sample.vector.length;
        const colbertTokenType = new arrow.FixedSizeList(
            colbertDimension,
            new arrow.Field('item', new arrow.Float32(), true),
        );
        const colbertMultiVectorType = new arrow.List(
            new arrow.Field('item', colbertTokenType, true),
        );
        return new arrow.Schema([
            new arrow.Field('id', new arrow.Utf8(), false),
            new arrow.Field('content', new arrow.Utf8(), false),
            new arrow.Field('dense_vector', denseVectorType, false),
            new arrow.Field('sparse_indices', new arrow.List(new arrow.Field('item', new arrow.Int32(), true)), true),
            new arrow.Field('sparse_values', new arrow.List(new arrow.Field('item', new arrow.Float32(), true)), true),
            new arrow.Field('colbert_vectors', colbertMultiVectorType, false),
            new arrow.Field('relativePath', new arrow.Utf8(), false),
            new arrow.Field('startLine', new arrow.Int32(), false),
            new arrow.Field('endLine', new arrow.Int32(), false),
            new arrow.Field('fileExtension', new arrow.Utf8(), false),
            new arrow.Field('metadata_json', new arrow.Utf8(), false),
        ]);
    }

    private async openTable(collectionName: string): Promise<any> {
        const db = await this.getDb();
        return db.openTable(collectionName);
    }

    private async hasPhysicalTable(collectionName: string): Promise<boolean> {
        const db = await this.getDb();
        const tableNames = await db.tableNames();
        return tableNames.includes(collectionName);
    }

    private async getDb(): Promise<any> {
        await this.ensureLoaded();
        if (!this.db) {
            await fs.mkdir(this.uri, { recursive: true });
            this.db = await this.lancedb!.connect(this.uri);
        }
        return this.db;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.lancedb && this.arrow) {
            return;
        }
        const lanceDbPath = requireFromHere.resolve('@lancedb/lancedb');
        this.lancedb = requireFromHere(lanceDbPath) as LanceDbModule;
        this.arrow = requireFromHere(requireFromHere.resolve('apache-arrow', {
            paths: [path.dirname(lanceDbPath)],
        })) as ArrowModule;
    }

    private async saveCollectionMetadata(collectionName: string, value: CollectionMetadata): Promise<void> {
        const metadata = await this.readMetadata();
        metadata[collectionName] = value;
        await this.writeMetadata(metadata);
    }

    private async readMetadata(): Promise<Record<string, CollectionMetadata>> {
        try {
            return JSON.parse(await fs.readFile(this.metadataPath, 'utf8'));
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    }

    private async writeMetadata(metadata: Record<string, CollectionMetadata>): Promise<void> {
        await fs.mkdir(this.uri, { recursive: true });
        await fs.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2));
    }
}

function parseMetadata(raw: unknown): Record<string, any> {
    if (typeof raw !== 'string' || !raw) {
        return {};
    }
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function projectRow(row: Record<string, any>, outputFields: string[]): Record<string, any> {
    if (outputFields.length === 0) {
        return row;
    }
    const projected: Record<string, any> = {};
    for (const field of outputFields) {
        projected[field] = row[field];
    }
    return projected;
}

function escapeSqlString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
