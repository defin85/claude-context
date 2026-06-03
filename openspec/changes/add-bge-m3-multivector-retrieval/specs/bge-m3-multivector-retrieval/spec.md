## ADDED Requirements

### Requirement: BGE-M3 Full Retrieval Mode
The system SHALL provide a BGE-M3 retrieval mode that uses model-generated dense vectors, model-generated sparse lexical vectors, and ColBERT token vectors.

#### Scenario: Full mode returns all vector families
- **GIVEN** `EMBEDDING_PROVIDER=BGE_M3`
- **AND** `BGE_M3_MODE=full`
- **WHEN** the system embeds a query or code chunk
- **THEN** the embedding result includes dense, sparse, and ColBERT vector data
- **AND** the system rejects provider responses that omit sparse or ColBERT data.

#### Scenario: Dense-only mode is explicit
- **GIVEN** `EMBEDDING_PROVIDER=BGE_M3`
- **AND** `BGE_M3_MODE=dense`
- **WHEN** the system embeds a query or code chunk
- **THEN** the embedding result may include only dense vector data
- **AND** user-facing status and logs identify the mode as dense-only, not full multivector retrieval.

### Requirement: Multivector Index Schema
The system SHALL store BGE-M3 full retrieval indexes in a schema that is distinct from existing dense-only and Milvus BM25 hybrid schemas.

#### Scenario: New collection namespace
- **WHEN** a codebase is indexed with BGE-M3 full retrieval
- **THEN** the collection name is distinct from `code_chunks_*` and `hybrid_code_chunks_*`
- **AND** collection metadata records the retrieval mode and schema version.

#### Scenario: Existing index is incompatible
- **GIVEN** a codebase has an existing dense-only or BM25-hybrid collection
- **WHEN** BGE-M3 full retrieval is requested for that codebase
- **THEN** the system reports that reindexing is required
- **AND** does not silently reuse the existing collection.

### Requirement: Dense and Sparse Candidate Retrieval
The system SHALL retrieve first-stage candidates using both BGE-M3 dense vectors and BGE-M3 sparse lexical vectors.

#### Scenario: Candidate search uses model sparse weights
- **GIVEN** a BGE-M3 full index exists
- **WHEN** `search_code` is called
- **THEN** the first-stage search uses the query dense vector against the dense field
- **AND** the query sparse vector against the sparse field
- **AND** does not use Milvus BM25-generated sparse vectors as the BGE-M3 sparse source.

#### Scenario: Candidate limit is bounded
- **GIVEN** `BGE_M3_CANDIDATE_LIMIT` is configured
- **WHEN** `search_code` is called
- **THEN** no more than the configured candidate count is sent to ColBERT reranking.

### Requirement: ColBERT Late-Interaction Reranking
The system SHALL rerank first-stage candidates using ColBERT-style late interaction over query and document token vectors.

#### Scenario: Rerank top candidates
- **GIVEN** a BGE-M3 full index exists
- **AND** first-stage retrieval returns candidate chunks
- **WHEN** ColBERT reranking runs
- **THEN** the system computes a token-level late-interaction score for each candidate
- **AND** returns final results ordered by the reranked score.

#### Scenario: Missing ColBERT vectors fail clearly
- **GIVEN** a candidate chunk lacks stored ColBERT vectors
- **WHEN** ColBERT reranking is required
- **THEN** the search fails with a clear index corruption or reindex-required error
- **AND** does not silently fall back to dense-only ranking.

### Requirement: MCP Visibility
The MCP server SHALL expose BGE-M3 retrieval mode state through existing indexing and search workflows.

#### Scenario: Index status includes retrieval mode
- **WHEN** `get_indexing_status` is called for a BGE-M3 indexed codebase
- **THEN** the response identifies the retrieval mode as BGE-M3 full or BGE-M3 dense-only
- **AND** includes the schema version when available.

#### Scenario: Search result metadata identifies reranking
- **WHEN** `search_code` returns BGE-M3 full results
- **THEN** the response indicates that ColBERT reranking was applied
- **AND** preserves existing location fields including relative path, start line, and end line.

### Requirement: Fully Local Operation
The system SHALL support BGE-M3 full retrieval without remote embedding APIs.

#### Scenario: Local sidecar endpoint
- **GIVEN** `BGE_M3_ENDPOINT` points to a local BGE-M3 sidecar
- **AND** Milvus is available locally
- **WHEN** indexing and search are performed
- **THEN** embedding, vector storage, retrieval, and reranking complete without OpenAI, VoyageAI, Gemini, or Zilliz Cloud credentials.
