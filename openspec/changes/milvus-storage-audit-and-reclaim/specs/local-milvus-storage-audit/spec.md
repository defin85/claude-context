## ADDED Requirements

### Requirement: Local Milvus Storage Inventory
The system SHALL provide a read-only inventory of local Milvus collections and their codebase ownership when connected to local Milvus.

#### Scenario: Inventory lists codebase-owned collections
- **WHEN** the operator requests a local Milvus storage audit
- **THEN** the report SHALL list collections, codebase paths when known, collection descriptions, row counts when available, retrieval mode/schema when known, and indexed status from daemon snapshot when available

#### Scenario: Local object-store size is available
- **WHEN** the audit runs on a host with access to the local Milvus volume path
- **THEN** the report SHALL include aggregate filesystem size for the Milvus volume and major object-store categories such as `wp`, `insert_log`, and `index_files`

#### Scenario: Size cannot be mapped exactly
- **WHEN** Milvus does not expose precise per-collection object-store size
- **THEN** the report SHALL label filesystem size estimates as approximate and SHALL NOT present them as exact collection ownership

### Requirement: Safe Reclaim Uses Milvus APIs
The system SHALL reclaim local Milvus storage by dropping collections through vector database or Milvus APIs, never by deleting MinIO files directly.

#### Scenario: Known codebase is cleared
- **WHEN** the operator confirms reclaim for a known codebase path
- **THEN** the system SHALL drop the associated Milvus collection through the vector database layer and update snapshot/config state consistently

#### Scenario: Manual MinIO deletion is requested
- **WHEN** documentation or tool output describes local storage cleanup
- **THEN** it SHALL warn that deleting files inside `~/.local/share/claude-context/milvus/volumes` is unsupported and can corrupt Milvus metadata

### Requirement: Reclaim Supports Dry Run
Reclaim operations SHALL support dry-run output before mutation.

#### Scenario: Dry run for known codebase
- **WHEN** the operator runs reclaim in dry-run mode for a codebase
- **THEN** the system SHALL report the collection names, snapshot/config updates, expected index loss, and whether reindexing will be required without mutating Milvus or snapshot state

#### Scenario: Mutation requires explicit confirmation
- **WHEN** a reclaim operation would drop a collection
- **THEN** the operation SHALL require explicit non-dry-run confirmation

### Requirement: Orphaned Collection Detection
The audit SHALL identify likely orphaned collections without deleting them automatically.

#### Scenario: Collection has no known codebase
- **WHEN** a Milvus collection has no codebase description and no matching daemon snapshot entry
- **THEN** the audit SHALL mark it as orphan candidate and require manual confirmation before reclaim

#### Scenario: Snapshot references missing collection
- **WHEN** daemon snapshot says a codebase is indexed but the Milvus collection is missing
- **THEN** the audit SHALL report stale snapshot state separately from storage reclaim candidates

### Requirement: Storage Reports Explain Retrieval Cost
The audit SHALL surface retrieval settings that materially affect storage size.

#### Scenario: BGE-M3 full collection is audited
- **WHEN** a collection uses BGE-M3 full dense+sparse+ColBERT retrieval metadata
- **THEN** the report SHALL identify it as high-storage-cost due to stored multivector/ColBERT payloads

#### Scenario: Retrieval profile is persisted
- **WHEN** a codebase has persisted retrieval profile or 1C scope profile metadata
- **THEN** the audit SHALL include those profiles in the storage report

### Requirement: Reclaim Evidence Is Recorded
The system SHALL make before/after cleanup evidence easy to capture.

#### Scenario: Reclaim completes
- **WHEN** a reclaim operation completes
- **THEN** output SHALL include before/after collection inventory, affected codebase paths, and current aggregate local Milvus volume size when available

#### Scenario: Disk is not immediately freed
- **WHEN** collections are dropped but filesystem usage does not immediately decrease
- **THEN** the output SHALL report that Milvus/MinIO compaction or garbage collection may be required and SHALL provide the next diagnostic step

## MODIFIED Requirements

### Requirement: Profile Documentation and Operator Guidance
The system SHALL document retrieval profiles, tradeoffs, migration requirements, verification commands, and local storage cleanup implications.

#### Scenario: Operator investigates disk usage
- **WHEN** a user reads BGE-M3 or Milvus troubleshooting documentation
- **THEN** it SHALL explain how full BGE-M3 storage affects local Milvus disk usage and how to use the safe audit/reclaim workflow
