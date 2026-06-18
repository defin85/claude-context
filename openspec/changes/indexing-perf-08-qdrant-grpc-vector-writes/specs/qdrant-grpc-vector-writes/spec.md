## ADDED Requirements

### Requirement: Qdrant write transport is configurable
The system SHALL allow Qdrant vector writes to use either the existing HTTP transport or an opt-in gRPC transport.

#### Scenario: Default transport is not configured
- **WHEN** Qdrant is selected as the vector database backend and no Qdrant transport override is configured
- **THEN** the system SHALL use the existing HTTP write transport

#### Scenario: gRPC transport is configured
- **WHEN** Qdrant is selected as the vector database backend and the Qdrant transport is configured as gRPC
- **THEN** indexing writes SHALL use the configured Qdrant gRPC endpoint

#### Scenario: HTTP transport is configured
- **WHEN** Qdrant is selected as the vector database backend and the Qdrant transport is configured as HTTP
- **THEN** indexing writes SHALL use the existing Qdrant HTTP endpoint

### Requirement: gRPC writes preserve BGE-M3 point data
The gRPC write transport SHALL store the same point identifiers, named vectors, and payload fields as the HTTP write transport for full BGE-M3 indexing.

#### Scenario: Full BGE-M3 point is written through gRPC
- **WHEN** an indexed chunk has a dense vector, sparse lexical weights, ColBERT token vectors, content, and metadata
- **THEN** the gRPC write transport SHALL write the same stable point identifier, dense vector, sparse vector, ColBERT multivector, content, and metadata payload as the HTTP transport

#### Scenario: Dense-only point is written through gRPC
- **WHEN** an indexed chunk only has a dense vector and payload
- **THEN** the gRPC write transport SHALL write the same stable point identifier, dense vector, content, and metadata payload as the HTTP transport

#### Scenario: gRPC write parity is tested
- **WHEN** automated tests exercise the gRPC write mapper
- **THEN** they SHALL verify point identity, vector names, vector dimensions, sparse indices and values, ColBERT vector counts, and payload fields against the HTTP representation or a read-back result

### Requirement: gRPC write failures are contained
The system SHALL fail or fall back conservatively when gRPC vector writes cannot be completed safely.

#### Scenario: gRPC endpoint is unavailable at startup
- **WHEN** gRPC transport is configured and the Qdrant gRPC endpoint cannot be reached during adapter initialization or the first write
- **THEN** the indexing job SHALL fail with a Qdrant gRPC transport error that identifies the endpoint

#### Scenario: gRPC write fails ambiguously
- **WHEN** a gRPC point write may have reached Qdrant before failing
- **THEN** the system SHALL apply the same idempotent upsert retry rules as the HTTP write path or fail the indexing job without pretending the batch was not written

#### Scenario: Operator rolls back to HTTP
- **WHEN** the operator changes Qdrant transport configuration from gRPC to HTTP and restarts the daemon
- **THEN** the system SHALL continue using existing Qdrant collections without collection migration

### Requirement: HTTP and gRPC write performance is measured on disposable collections
The change SHALL include a controlled comparison of HTTP and gRPC Qdrant write performance before any default transport change is recommended.

#### Scenario: Benchmark uses temporary data
- **WHEN** HTTP-versus-gRPC write performance is measured
- **THEN** the benchmark SHALL use temporary collections or disposable fixture indexes and SHALL NOT clear or rewrite existing production or live-demo collections

#### Scenario: Benchmark summary is produced
- **WHEN** the HTTP-versus-gRPC benchmark finishes
- **THEN** the summary SHALL include transport, endpoint, compression mode when applicable, total wall-clock time, insert-stage timing, insert batch counts, failures, and collection or fixture identity

#### Scenario: Default transport recommendation is documented
- **WHEN** benchmark results are recorded
- **THEN** the verification notes SHALL state whether HTTP remains the recommended default or gRPC should be proposed as a later default change
