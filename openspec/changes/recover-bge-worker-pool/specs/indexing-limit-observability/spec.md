## ADDED Requirements

### Requirement: Chunk limit is reported
The system SHALL report the configured `CODE_CHUNK_LIMIT` for indexing jobs that can stop due to the chunk limit.

#### Scenario: Indexing starts with visible chunk limit
- **WHEN** an initial or force indexing job starts
- **THEN** logs or status include the configured chunk limit value used by that job

#### Scenario: Invalid chunk limit falls back visibly
- **WHEN** `CODE_CHUNK_LIMIT` is invalid
- **THEN** the system uses the default chunk limit and logs the fallback value

### Requirement: Limit-reached outcome is explicit
The system SHALL mark an indexing job that reaches the chunk limit as a limit-reached partial index outcome rather than an ambiguous stop.

#### Scenario: Chunk limit reached
- **WHEN** indexing reaches the configured chunk limit before all files are processed
- **THEN** status or completion output reports `limit_reached`, indexed chunk count, processed file count, and the configured limit

#### Scenario: Search remains available after limit reached
- **WHEN** an index is completed with `limit_reached`
- **THEN** the codebase remains searchable and status indicates that results may be incomplete

### Requirement: Raised limit requires reindex
The system SHALL make clear that raising `CODE_CHUNK_LIMIT` requires a new indexing run to include chunks skipped by an earlier lower limit.

#### Scenario: Operator raises chunk limit
- **WHEN** an operator raises `CODE_CHUNK_LIMIT` after a previous limit-reached run
- **THEN** the system documentation or completion message indicates that force reindexing is required to add previously skipped chunks
