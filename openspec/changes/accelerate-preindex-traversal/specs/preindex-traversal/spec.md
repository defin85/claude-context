## ADDED Requirements

### Requirement: Bounded parallel pre-index traversal
The system SHALL traverse, filter, and hash supported files for initial and force indexing using bounded concurrency rather than a strictly sequential file-by-file loop.

#### Scenario: Large force indexing uses configured concurrency
- **WHEN** a force indexing job starts for a codebase with many supported files
- **THEN** the pre-index traversal runs with no more than the configured concurrency limit and no less than one active worker while work remains available

#### Scenario: Conservative default remains safe
- **WHEN** no pre-index concurrency setting is provided
- **THEN** the system uses a conservative bounded default suitable for interactive MCP operation

### Requirement: Reusable traversal result
The system SHALL reuse a single pre-index traversal result for synchronizer snapshot generation and the indexer file list when initial or force indexing requires both.

#### Scenario: Cold force indexing avoids duplicate full walk
- **WHEN** a force indexing job has no merkle snapshot for the codebase
- **THEN** the system uses one traversal result to populate synchronizer state and select files for indexing instead of performing two independent full-tree walks

#### Scenario: Selected files remain equivalent
- **WHEN** the new traversal path is run on a fixture with nested directories, hidden paths, ignored patterns, and supported extensions
- **THEN** the selected indexable files match the existing filtering semantics

### Requirement: Compatible synchronizer snapshots
The system SHALL preserve compatibility with existing merkle snapshot files and write snapshot data that existing snapshot loading can read.

#### Scenario: Existing snapshot loads
- **WHEN** a codebase has a merkle snapshot written by the previous synchronizer implementation
- **THEN** the new synchronizer path loads it without requiring migration

#### Scenario: New snapshot remains readable
- **WHEN** the new traversal path writes a merkle snapshot
- **THEN** the synchronizer can reload that snapshot and detect unchanged files correctly

### Requirement: Pre-index phase observability
The system SHALL report aggregate pre-index timing and progress separately from splitting, embedding, and vector insertion.

#### Scenario: Status distinguishes pre-index work
- **WHEN** indexing is in the pre-index traversal or hashing phase
- **THEN** indexing status exposes that phase without reusing stale accelerator data from a previous embedding run

#### Scenario: Completion metrics include pre-index timing
- **WHEN** indexing completes
- **THEN** logs or status include pre-index scan/hash/list timing alongside split, embedding, and insert timing

### Requirement: Retrieval behavior unchanged
The system SHALL NOT alter retrieval schema, vector contents, ranking semantics, or indexed collection migration requirements as part of pre-index traversal acceleration.

#### Scenario: Full BGE-M3 indexing produces same retrieval shape
- **WHEN** a full BGE-M3 codebase is indexed through the accelerated pre-index path
- **THEN** inserted records still contain the same dense, sparse, and ColBERT vector fields expected by the existing retrieval pipeline
