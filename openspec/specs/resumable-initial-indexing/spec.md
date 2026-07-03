# resumable-initial-indexing Specification

## Purpose
TBD - created by archiving change add-resumable-initial-indexing-manifest. Update Purpose after archive.
## Requirements
### Requirement: Automatic indexing mode selection

The system SHALL decide whether an indexing request runs full initial indexing, resumes interrupted initial indexing, runs ordinary changed-file indexing, or fails closed due to incompatible persisted state.

#### Scenario: New codebase starts full initial indexing

- **WHEN** `index_codebase` is called for a codebase without a compatible completed index or compatible initial-indexing manifest
- **THEN** the system SHALL select `initial_full`

#### Scenario: Interrupted initial indexing resumes

- **WHEN** `index_codebase` is called for a codebase with a compatible interrupted initial-indexing manifest
- **AND** the target collection and effective indexing configuration still match the manifest
- **THEN** the system SHALL select `initial_resume`

#### Scenario: Completed index uses ordinary change indexing

- **WHEN** `index_codebase` is called for a codebase with a compatible completed index and synchronizer snapshot
- **THEN** the system SHALL select `incremental_changes`

#### Scenario: Incompatible state fails closed

- **WHEN** persisted index or manifest state exists for the codebase
- **AND** the effective profile, embedding, retrieval mode, vector schema, collection, splitter, supported extensions, ignore patterns, or 1C scope profile are incompatible
- **THEN** the system SHALL select `incompatible_requires_reindex`
- **AND** the caller SHALL receive an explicit reason instead of silently resuming or incrementally updating

### Requirement: Durable initial-indexing manifest

The system SHALL persist enough initial-indexing state to distinguish confirmed inserted chunks from unconfirmed work after interruption, failure, or daemon restart.

#### Scenario: Manifest records compatibility identity

- **WHEN** an initial indexing run starts
- **THEN** the manifest SHALL record the normalized codebase path, target collection identity, retrieval mode, vector schema fingerprint, embedding profile fingerprint, splitter fingerprint, effective file-selection configuration, and effective 1C scope profile when present

#### Scenario: Manifest records batch lifecycle

- **WHEN** chunk batches are planned, embedded, inserted, failed, or cancelled
- **THEN** the manifest SHALL record batch states that distinguish `planned`, `embedding`, `inserting`, `inserted`, `failed`, and `cancelled`

#### Scenario: Force reindex invalidates previous manifest

- **WHEN** `index_codebase` is called with `force=true`
- **THEN** the system SHALL NOT resume a previous interrupted manifest
- **AND** any previous manifest for the same codebase and collection identity SHALL be deleted or marked `superseded` before the target collection is dropped or recreated

#### Scenario: Confirmed state is written after vector insertion

- **WHEN** a vector insert or upsert operation succeeds for a batch
- **THEN** the manifest SHALL mark the corresponding stable document identifiers as confirmed inserted
- **AND** chunks without confirmed inserted identifiers SHALL remain eligible for reprocessing

#### Scenario: Manifest writes are atomic

- **WHEN** the manifest is updated
- **THEN** the update SHALL either be fully visible or leave the previous valid manifest intact
- **AND** readers SHALL treat corrupt or partially written manifest content as unusable for resume

### Requirement: Initial resume skips only confirmed inserted chunks

The system SHALL skip only chunks whose stable document identifiers are confirmed as inserted in a compatible manifest.

#### Scenario: Confirmed chunks are skipped

- **WHEN** `initial_resume` processes a compatible manifest
- **AND** a planned chunk has a stable document identifier recorded as confirmed inserted
- **THEN** the system SHALL NOT re-embed or rewrite that chunk

#### Scenario: Unconfirmed chunks are reprocessed

- **WHEN** `initial_resume` processes chunks in `planned`, `embedding`, `inserting`, `failed`, or `cancelled` state
- **THEN** those chunks SHALL be treated as unconfirmed and processed again through embedding and vector insertion

#### Scenario: Resume completes initial indexing

- **WHEN** every selected chunk is confirmed inserted after an `initial_resume` run
- **THEN** the system SHALL mark the manifest and codebase index state as completed
- **AND** ordinary changed-file indexing SHALL be eligible on the next compatible request

#### Scenario: Chunk limit does not publish completed initial state

- **WHEN** `initial_full` or `initial_resume` stops because `CODE_CHUNK_LIMIT` is reached before every selected chunk is confirmed inserted
- **THEN** the system SHALL mark the manifest state as `limit_reached`
- **AND** ordinary changed-file indexing SHALL NOT be eligible until a later run confirms every selected chunk or a force reindex completes under a sufficient limit

### Requirement: Resume works across indexing profiles

Initial resume SHALL be supported for all repository shapes and indexing profiles that normal initial indexing supports.

#### Scenario: Retrieval modes are supported

- **WHEN** a compatible interrupted run used dense, hybrid, or BGE-M3 full retrieval mode
- **THEN** `initial_resume` SHALL preserve that mode's document identifiers, vector fields, and metadata shape

#### Scenario: 1C scope profiles are supported

- **WHEN** a compatible interrupted run used `full`, `developer`, `minimal`, or `v8unpack` as the 1C indexing scope profile
- **THEN** `initial_resume` SHALL use the same effective profile during compatibility checks and file selection

#### Scenario: Changed 1C scope profile rejects resume

- **WHEN** an interrupted run used one 1C indexing scope profile
- **AND** the next request uses a different 1C indexing scope profile
- **THEN** the system SHALL reject `initial_resume` and require full reindexing

### Requirement: Retry safety for vector writes

The system SHALL avoid duplicate or corrupt vector records when resuming after interrupted or ambiguous vector writes.

#### Scenario: Backend supports idempotent writes

- **WHEN** a backend path supports upsert or equivalent idempotent writes
- **THEN** resume MAY reprocess unconfirmed chunks using that backend-safe write path

#### Scenario: Insert outcome is ambiguous

- **WHEN** a vector write request was sent but its outcome cannot be proven
- **THEN** the system SHALL NOT mark that batch as confirmed inserted
- **AND** it SHALL either retry through an idempotent write path or fail closed with an explicit ambiguous-write reason

#### Scenario: Coalesced writes preserve confirmation

- **WHEN** multiple chunk batches are coalesced into one vector write
- **THEN** the system SHALL preserve enough per-document or per-batch confirmation data to decide which chunks may be skipped on resume

#### Scenario: Write safety is insert-mode specific

- **WHEN** `initial_resume` needs to reprocess unconfirmed chunks for dense, hybrid, or BGE-M3 full retrieval
- **THEN** the vector adapter SHALL provide a safe write path for that specific insert mode, such as upsert or delete-then-upsert by stable document id
- **AND** if no safe write path exists for that insert mode, the system SHALL reject resume and require full reindexing

### Requirement: Completed snapshots are committed only after completed initial indexing

The system SHALL NOT publish synchronizer state as a completed index before all selected chunks are confirmed inserted.

#### Scenario: Initial traversal does not make incremental sync eligible

- **WHEN** initial indexing has completed traversal and hash calculation
- **AND** some selected chunks are not yet confirmed inserted
- **THEN** the synchronizer snapshot SHALL NOT make the codebase eligible for `incremental_changes`

#### Scenario: Completed resume publishes synchronizer state

- **WHEN** `initial_full` or `initial_resume` confirms every selected chunk as inserted
- **THEN** the system SHALL commit the synchronizer snapshot needed for future `incremental_changes`

### Requirement: Resume-aware status

The system SHALL expose the selected indexing mode and resume progress through indexing status.

#### Scenario: Status reports selected mode

- **WHEN** indexing status is requested during or after a run
- **THEN** the response SHALL include the selected indexing mode

#### Scenario: Status reports resume counters

- **WHEN** indexing status is requested for an `initial_resume` run
- **THEN** the response SHALL include confirmed/skipped work, remaining work, failed or unconfirmed work, and the manifest compatibility result

#### Scenario: Status is codebase scoped

- **WHEN** indexing status is requested for one codebase
- **THEN** manifest and batch details from another codebase SHALL NOT be returned

### Requirement: Legacy partial indexes do not resume silently

The system SHALL not treat pre-manifest failed or interrupted indexes as safely resumable.

#### Scenario: Legacy partial state exists without manifest

- **WHEN** a codebase has failed or partial indexing state created before manifest support
- **AND** no compatible manifest exists
- **THEN** the system SHALL NOT select `initial_resume`
- **AND** the caller SHALL receive guidance that a full reindex is required

