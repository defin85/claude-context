## ADDED Requirements

### Requirement: Canonical BGE-M3 fixtures
The benchmark system SHALL create or load canonical BGE-M3 full-vector fixtures that preserve each chunk's dense vector, model sparse vector, ColBERT token vectors, content, path fields, metadata, and stable document identity.

#### Scenario: Full demo-1c fixture is generated
- **WHEN** the benchmark fixture command runs for `examples/demo-1c` with developer scope
- **THEN** it SHALL produce a fixture with the expected chunk count of 893 unless an explicit drift-acceptance option is supplied
- **AND** it SHALL record the scope profile, source path, chunk count, dense dimensions, sparse non-zero statistics, ColBERT vector count statistics, and fixture checksum

#### Scenario: Bounded demo-do30-1c fixture is generated
- **WHEN** the benchmark fixture command runs for `examples/demo-do30-1c` with a configured cap, timeout, or cancellation boundary
- **THEN** it SHALL write `bounded: true` and the boundary reason into the fixture metadata
- **AND** it SHALL prevent bounded fixture results from being labelled as complete throughput wins

### Requirement: Comparable backend write matrix
The benchmark system SHALL write the same fixture records, in the same document order and batch plan, to the current Milvus BGE-M3 path, a Qdrant native dense+sparse+multivector path, and a LanceDB multivector path.

#### Scenario: Milvus baseline run preserves current behavior
- **WHEN** the Milvus candidate runs
- **THEN** it SHALL use the current BGE-M3 insert path, including existing ColBERT JSON payload serialization and flush behavior
- **AND** it SHALL record Milvus address, collection name, client path, batch size, flush behavior, and backend version when available

#### Scenario: Qdrant native multivector run stores full vectors
- **WHEN** the Qdrant candidate runs
- **THEN** it SHALL store dense vectors, model sparse vectors, and ColBERT token vectors in native vector-capable fields rather than as opaque ColBERT JSON payload
- **AND** it SHALL record Qdrant URL, collection schema, vector datatypes, multivector comparator, sparse vector configuration, bulk-write/indexing settings, and backend version when available

#### Scenario: LanceDB multivector run stores full vectors
- **WHEN** the LanceDB candidate runs
- **THEN** it SHALL store ColBERT token vectors in a LanceDB multivector column and preserve dense vector, sparse vector, content, path fields, metadata, and stable document identity
- **AND** it SHALL record database URI, table schema, vector datatype, index/search settings, client/runtime variant, and backend version when available

#### Scenario: Backend cannot run comparably
- **WHEN** a backend dependency, API feature, or local service is unavailable
- **THEN** the benchmark SHALL mark that backend as skipped or failed with a structured reason
- **AND** it SHALL NOT substitute dense-only or payload-only behavior without marking the run non-comparable

### Requirement: Write metrics and artifacts
The benchmark system SHALL emit machine-readable artifacts that include write wall-clock, bytes/request, request count, failures, peak RSS, and backend settings for every attempted backend run.

#### Scenario: Backend write succeeds
- **WHEN** a backend writes all fixture records without failure
- **THEN** the run summary SHALL include setup time, collection/table create time, write wall-clock, finalize/flush/index time, request count, total bytes, min/max/mean bytes per request, failure count, runner peak RSS, RSS delta, and backend process RSS when available
- **AND** it SHALL write per-request timing and byte records suitable for later analysis

#### Scenario: Backend write fails
- **WHEN** a backend write attempt throws, times out, or returns a partial success
- **THEN** the run summary SHALL include failure count, failed request metadata, last error message, records attempted, records confirmed written when available, and `complete: false`
- **AND** it SHALL keep the failed artifact instead of overwriting it with a later successful run

#### Scenario: Matrix summary is produced
- **WHEN** all selected backend runs finish or are skipped
- **THEN** the benchmark SHALL write a matrix summary under `.artifacts/bge-m3-vector-backend-benchmark/`
- **AND** the summary SHALL include artifact paths for each backend run and enough environment metadata to reproduce the comparison

### Requirement: Search parity gate
The benchmark system SHALL run a fixed search-parity check after each successful backend write and SHALL report parity separately from write throughput.

#### Scenario: Search parity passes
- **WHEN** a backend has successfully written the fixture and the parity suite runs
- **THEN** the benchmark SHALL compare returned stable document IDs against the Milvus baseline using configured top-k overlap and query-by-id expectations
- **AND** it SHALL record `searchParity: passed` only when all required parity checks pass

#### Scenario: Search parity fails
- **WHEN** a backend returns missing IDs, unacceptable top-k overlap, query errors, or incomplete vector-shape support
- **THEN** the benchmark SHALL record `searchParity: failed` with per-query mismatch details
- **AND** it SHALL mark any write-speed recommendation for that backend as blocked by parity

### Requirement: Evidence interpretation rules
The benchmark system SHALL make benchmark interpretation explicit so incomplete or non-comparable runs cannot be mistaken for production evidence.

#### Scenario: Result is not comparable
- **WHEN** a run is bounded, skipped, failed, uses different fixture checksums, uses different batch plans, or fails search parity
- **THEN** the matrix summary SHALL mark the run non-comparable
- **AND** it SHALL NOT rank that run as a write-throughput winner

#### Scenario: Result is comparable
- **WHEN** all selected backends use the same fixture checksum, same document count, same batch plan, terminal successful writes, and passing search parity
- **THEN** the matrix summary MAY rank write wall-clock and bytes/request across those backends
- **AND** it SHALL include the backend settings that materially affect storage and latency trade-offs
