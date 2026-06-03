// Interface definitions
export interface VectorDocument {
    id: string;
    vector: number[];
    sparseVector?: {
        indices: number[];
        values: number[];
    };
    colbertVectors?: number[][];
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: Record<string, any>;
}

export type RetrievalMode = 'dense' | 'hybrid_bm25' | 'bge_m3_dense' | 'bge_m3_full';

export interface RetrievalSchemaMetadata {
    retrievalMode: RetrievalMode;
    schemaVersion: number;
}

export interface SearchOptions {
    topK?: number;
    filter?: Record<string, any>;
    threshold?: number;
    filterExpr?: string;
}

// New interfaces for hybrid search
export interface HybridSearchRequest {
    data: number[] | string | { indices: number[]; values: number[] } | Record<number, number>; // Query vector, text, or sparse vector
    anns_field: string; // Vector field name (vector or sparse_vector)
    param: Record<string, any>; // Search parameters
    limit: number;
}

export interface HybridSearchOptions {
    rerank?: RerankStrategy;
    limit?: number;
    filterExpr?: string;
}

export interface RerankStrategy {
    strategy: 'rrf' | 'weighted';
    params?: Record<string, any>;
}

export interface VectorSearchResult {
    document: VectorDocument;
    score: number;
}

export interface HybridSearchResult {
    document: VectorDocument;
    score: number;
    metadata?: Record<string, any>;
}

export interface VectorDatabase {
    /**
     * Create collection
     * @param collectionName Collection name
     * @param dimension Vector dimension
     * @param description Collection description
     */
    createCollection(collectionName: string, dimension: number, description?: string): Promise<void>;

    /**
     * Create collection with hybrid search support
     * @param collectionName Collection name
     * @param dimension Dense vector dimension
     * @param description Collection description
     */
    createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void>;

    /**
     * Create collection with BGE-M3 full retrieval support.
     * Stores dense vectors, model-generated sparse vectors, and ColBERT token vectors.
     */
    createBgeM3Collection(collectionName: string, dimension: number, description?: string): Promise<void>;

    /**
     * Drop collection
     * @param collectionName Collection name
     */
    dropCollection(collectionName: string): Promise<void>;

    /**
     * Check if collection exists
     * @param collectionName Collection name
     */
    hasCollection(collectionName: string): Promise<boolean>;

    /**
     * List all collections
     */
    listCollections(): Promise<string[]>;

    /**
     * Insert vector documents
     * @param collectionName Collection name
     * @param documents Document array
     */
    insert(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Insert hybrid vector documents
     * @param collectionName Collection name
     * @param documents Document array
     */
    insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Insert BGE-M3 full retrieval documents.
     */
    insertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Upsert BGE-M3 full retrieval documents when the backing database supports idempotent writes.
     */
    upsertBgeM3?(collectionName: string, documents: VectorDocument[]): Promise<void>;

    /**
     * Search similar vectors
     * @param collectionName Collection name
     * @param queryVector Query vector
     * @param options Search options
     */
    search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;

    /**
     * Hybrid search with multiple vector fields
     * @param collectionName Collection name
     * @param searchRequests Array of search requests for different fields
     * @param options Hybrid search options including reranking
     */
    hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]>;

    /**
     * BGE-M3 dense+sparse candidate search using model-generated sparse vectors.
     */
    bgeM3HybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]>;

    /**
     * Delete documents
     * @param collectionName Collection name
     * @param ids Document ID array
     */
    delete(collectionName: string, ids: string[]): Promise<void>;

    /**
     * Query documents with filter conditions
     * @param collectionName Collection name
     * @param filter Optional filter expression
     * @param outputFields Fields to return
     * @param limit Maximum number of results
     */
    query(collectionName: string, filter: string | undefined, outputFields: string[], limit?: number): Promise<Record<string, any>[]>;

    /**
     * Get collection description
     * @param collectionName Collection name
     * @returns Collection description string
     */
    getCollectionDescription(collectionName: string): Promise<string>;

    /**
     * Check collection limit
     * Returns true if collection can be created, false if limit exceeded
     */
    checkCollectionLimit(): Promise<boolean>;

    /**
     * Get the number of rows in a collection.
     * Returns -1 when the count is unknown or cannot be read.
     */
    getCollectionRowCount(collectionName: string): Promise<number>;
}

/**
 * Special error message for collection limit exceeded
 * This allows us to distinguish it from other errors across all Milvus implementations
 */
export const COLLECTION_LIMIT_MESSAGE = "[Error]: Your Zilliz Cloud account has hit its collection limit. To continue creating collections, you'll need to expand your capacity. We recommend visiting https://zilliz.com/pricing to explore options for dedicated or serverless clusters."; 
