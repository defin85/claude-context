# qdrant-bge-m3-retrieval Specification

## Purpose
TBD - created by archiving change complete-qdrant-bge-m3-retrieval. Update Purpose after archive.
## Requirements
### Requirement: Qdrant stores complete BGE-M3 full retrieval records
The system SHALL store Qdrant records for BGE-M3 full indexes with dense, sparse, and ColBERT vectors plus the payload fields required by MCP search and code-symbol retrieval.

#### Scenario: Clean Qdrant force indexing writes full-mode vectors
- **WHEN** `index_codebase` runs with `force=true`, `VECTOR_DATABASE_BACKEND=qdrant`, and BGE-M3 full retrieval enabled
- **THEN** each indexed chunk record includes a dense vector, sparse vector, ColBERT vectors, stable chunk identity, relative path, content, line range, file extension, and metadata

#### Scenario: Qdrant collection metadata identifies full mode
- **WHEN** a Qdrant collection is created for BGE-M3 full retrieval
- **THEN** the collection metadata identifies BGE-M3 full mode and the vector dimension required by the active embedding profile

### Requirement: Qdrant BGE-M3 full search returns rerank-ready candidates
The system SHALL return Qdrant BGE-M3 full search candidates with enough document data for the shared ColBERT rerank stage to execute without re-fetching from another backend.

#### Scenario: Search candidates include ColBERT vectors
- **WHEN** `search_code` queries a Qdrant BGE-M3 full collection
- **THEN** the Qdrant backend returns candidate documents with ColBERT vectors populated for rerank
- **AND** it does not require callers to force reindex when the stored Qdrant point already has ColBERT vectors

#### Scenario: Search avoids unnecessary vector payloads
- **WHEN** Qdrant returns candidates for the BGE-M3 full rerank stage
- **THEN** the backend requests only the vector fields required for rerank and does not return dense or sparse vectors unless a caller explicitly requires them

#### Scenario: Rerank completes on clean index
- **WHEN** a clean Qdrant BGE-M3 full index contains dense, sparse, and ColBERT vectors for the searched codebase
- **THEN** `search_code` completes without a missing ColBERT vector error

### Requirement: Qdrant query supports code-symbol lexical retrieval
The system SHALL expose Qdrant payload query results in the same logical document shape expected by the no-reindex code-symbol retrieval layer.

#### Scenario: Payload query projects metadata fields
- **WHEN** code-symbol retrieval queries Qdrant for lexical candidates
- **THEN** the returned rows include requested document fields such as `id`, `content`, `relativePath`, `startLine`, `endLine`, `fileExtension`, and `metadata`

#### Scenario: Unsupported projected fields do not break compatible payloads
- **WHEN** code-symbol retrieval requests a metadata alias that is not physically stored by Qdrant
- **THEN** Qdrant projection either maps the alias to the stored metadata payload or omits the alias without failing the whole search

### Requirement: Qdrant compatibility failures are actionable
The system SHALL fail closed with actionable diagnostics when an existing Qdrant collection cannot satisfy BGE-M3 full retrieval requirements.

#### Scenario: Collection lacks ColBERT vectors
- **WHEN** a Qdrant collection is selected for BGE-M3 full search but stored points do not contain ColBERT vectors
- **THEN** `search_code` fails with a message that identifies the collection as incompatible and instructs the operator to clear or force reindex the Qdrant collection

#### Scenario: Backend response omits stored ColBERT vectors
- **WHEN** Qdrant stored points contain ColBERT vectors but the backend response mapping omits them
- **THEN** tests fail before release and live validation reports a backend retrieval bug rather than an indexing problem

#### Scenario: Collection contains another codebase
- **WHEN** a Qdrant collection selected for a codebase contains only points whose metadata belongs to a different codebase
- **THEN** search does not return misleading results and the operator receives guidance to clear the collection or force reindex into a compatible collection

### Requirement: Qdrant BGE-M3 full retrieval is live-verifiable through MCP
The system SHALL provide repeatable MCP-level verification that Qdrant indexing and search work together for a representative BSL codebase.

#### Scenario: Demo 1C clean live verification passes without tool errors
- **WHEN** a local Qdrant service is available, the MCP daemon uses the Qdrant backend, and `examples/demo-1c` is force-indexed with the developer 1C scope profile
- **THEN** the verification run records successful indexing status, Qdrant collection counts for the target codebase, and `search_code` results for the 30-query acceptance set without MCP tool errors

#### Scenario: Verification artifacts separate indexing and search evidence
- **WHEN** live verification completes
- **THEN** artifacts record indexing facts separately from search quality metrics such as Hit@10 and per-query top paths

