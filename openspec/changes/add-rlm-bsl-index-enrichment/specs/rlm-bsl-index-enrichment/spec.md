## ADDED Requirements

### Requirement: RLM exposes a whole-codebase snapshot export for enrichment
The `rlm-tools-bsl` integration SHALL provide a machine-readable whole-codebase snapshot/export API before live RLM data is used for `claude-context` index enrichment.

#### Scenario: Snapshot export returns file-level structure
- **WHEN** `claude-context` invokes the configured RLM snapshot/export transport for a BSL/1C codebase
- **THEN** the response SHALL include provider identity, schema version, provider status, source root, capabilities, diagnostics, and file entries grouped by relative path
- **AND** each file entry SHALL include available object metadata, module metadata, bounded synonyms, and method/procedure symbols with line ranges when present

#### Scenario: Per-query provider lookup is not accepted as enrichment snapshot
- **WHEN** only a per-query RLM provider lookup such as `provider query <path> <query> --json` is available
- **THEN** `claude-context` SHALL NOT treat that transport as sufficient for index-time enrichment
- **AND** it SHALL either run without RLM enrichment, fail in required mode, or use fixture data in tests

#### Scenario: Snapshot export remains query-only
- **WHEN** RLM snapshot/export is requested for enrichment
- **THEN** the RLM transport SHALL NOT build, update, drop, migrate, or otherwise mutate RLM indexes
- **AND** missing, stale, busy, unsupported, and error states SHALL be represented as structured status or diagnostics

### Requirement: Indexing loads RLM BSL enrichment snapshots
The system SHALL support an index-time RLM BSL enrichment provider that loads a structured `rlm-tools-bsl` snapshot for a codebase before vector documents are inserted.

#### Scenario: Available RLM snapshot is loaded once per indexing job
- **WHEN** indexing a BSL/1C codebase with RLM enrichment configured and the provider reports `available`
- **THEN** the indexer SHALL load the structured RLM snapshot once for the indexing job
- **AND** it SHALL reuse the loaded snapshot for chunk enrichment instead of querying RLM separately for each chunk

#### Scenario: RLM enrichment does not mutate RLM indexes
- **WHEN** the indexer checks or loads RLM enrichment data
- **THEN** it SHALL NOT build, update, drop, migrate, or otherwise mutate the `rlm-tools-bsl` index
- **AND** any missing, stale, busy, unsupported, or error state SHALL be reported through enrichment diagnostics

### Requirement: BSL chunks are enriched with bounded structural metadata
The system SHALL store compact RLM-derived BSL metadata on indexed chunks whose paths and line ranges match RLM snapshot entries.

#### Scenario: Chunk receives object module and symbol metadata
- **WHEN** a chunk from `Documents/ЭлектронныйДокументВходящийЭДО/Forms/ФормаПросмотра/Ext/Form/Module.bsl` overlaps an RLM method or procedure declaration
- **THEN** the inserted vector document metadata SHALL include a bounded BSL enrichment envelope with provider identity, schema version, source root, object name, object kind, module kind, module name, and overlapping symbol metadata

#### Scenario: Enrichment payload remains bounded
- **WHEN** a file has many methods, synonyms, form elements, or metadata references
- **THEN** each chunk metadata payload SHALL include only the configured bounded subset relevant to that chunk
- **AND** it SHALL NOT embed full RLM rows, call graphs, role rights, or unbounded form element trees in every vector document

#### Scenario: Non-overlapping symbols are not attached as chunk declarations
- **WHEN** an RLM symbol belongs to the same file but its line range does not overlap the chunk
- **THEN** that symbol SHALL NOT be recorded as an overlapping declaration for the chunk
- **AND** the implementation MAY record a bounded file-level object or module context separately from declaration-level symbol context

### Requirement: RLM source roots are mapped to indexed relative paths
The system SHALL map RLM snapshot paths to the relative paths used by the `claude-context` index.

#### Scenario: Equal root path mapping
- **WHEN** RLM and `claude-context` use the same codebase root
- **THEN** RLM file paths SHALL map to the same normalized `relativePath` values stored in vector documents

#### Scenario: Nested root path mapping
- **WHEN** RLM indexes a nested source root such as `src/cf` and `claude-context` indexes the repository root
- **THEN** the enrichment provider SHALL translate RLM paths into repository-relative vector document paths before matching chunks

#### Scenario: Unmapped RLM paths are diagnostic only
- **WHEN** an RLM snapshot entry cannot be mapped to any indexed file or chunk
- **THEN** the indexer SHALL record compact diagnostics
- **AND** it SHALL NOT attach that entry to unrelated chunks

### Requirement: Enrichment mode controls fail-open and fail-closed behavior
The system SHALL provide explicit configuration for RLM BSL enrichment mode.

#### Scenario: Optional mode indexes without RLM data
- **WHEN** RLM enrichment is configured as optional and the provider is missing, stale, busy, unsupported, invalid, or returns an error
- **THEN** indexing SHALL continue without RLM-derived chunk metadata
- **AND** the collection or indexing status SHALL report the enrichment outcome

#### Scenario: Required mode fails indexing without valid RLM data
- **WHEN** RLM enrichment is configured as required and the provider is missing, stale, busy, unsupported, invalid, or returns an error
- **THEN** indexing SHALL fail before dropping an existing collection, creating a replacement collection, or inserting an index that claims to be RLM-enriched
- **AND** the failure message SHALL identify the provider status and codebase path

#### Scenario: Provider-specific statuses are normalized
- **WHEN** the RLM snapshot/export transport returns a provider-specific status such as `missing_index`
- **THEN** `claude-context` SHALL map it to the stable enrichment status vocabulary used by indexing and required-mode branching
- **AND** it SHALL preserve the raw provider status in diagnostics

#### Scenario: Disabled mode preserves current indexing behavior
- **WHEN** RLM enrichment is disabled or no enrichment transport is configured
- **THEN** indexing SHALL behave as it did before this change
- **AND** existing non-BSL codebases SHALL NOT require `rlm-tools-bsl`

#### Scenario: No-RLM mode is supported explicitly
- **WHEN** `rlm-tools-bsl` is not installed, no RLM project is registered, or no RLM index exists
- **AND** enrichment mode is disabled or optional
- **THEN** `claude-context` SHALL index the codebase using existing traversal, splitting, embedding, vector insertion, and 1C scope-profile behavior
- **AND** the absence of RLM SHALL be reported as disabled or unavailable enrichment rather than as an indexing failure

### Requirement: Collection metadata records enrichment compatibility
The system SHALL record collection-level metadata that identifies whether an index contains RLM BSL enrichment.

#### Scenario: Enriched collection records provider metadata
- **WHEN** indexing completes with valid RLM BSL enrichment
- **THEN** the collection metadata SHALL include enrichment provider, enrichment schema version, provider schema version when available, source root, provider status, and source build or fingerprint diagnostics when available

#### Scenario: Search can read collection enrichment compatibility
- **WHEN** searching an existing collection
- **THEN** the vector backend SHALL expose enough collection-level compatibility metadata for search to determine whether stored RLM BSL enrichment is expected
- **AND** search SHALL NOT need to infer collection enrichment solely from the first returned chunk

#### Scenario: Unenriched collection remains searchable
- **WHEN** a collection was built before RLM enrichment existed or was built with enrichment disabled or unavailable in optional mode
- **THEN** search SHALL remain available
- **AND** the collection metadata or diagnostics SHALL allow callers to distinguish the missing enrichment from an enriched index

### Requirement: Incremental reindexing preserves enrichment consistency
The system SHALL keep full indexing, incremental reindexing, and background synchronization consistent with the configured RLM BSL enrichment mode.

#### Scenario: Required incremental update fails before mutating chunks
- **WHEN** an enriched collection is updated through incremental reindexing with enrichment mode `required`
- **AND** a valid compatible RLM snapshot is unavailable
- **THEN** the update SHALL fail before deleting old chunks or inserting replacement chunks

#### Scenario: Optional incremental update reports mixed or unavailable enrichment
- **WHEN** optional enrichment is unavailable during incremental reindexing of a previously enriched collection
- **THEN** the update MAY continue without RLM-derived metadata for changed chunks
- **AND** collection diagnostics SHALL report that the collection is not uniformly enriched

### Requirement: Enriched indexing is validated on 1C fixtures
The system SHALL include tests and evaluation evidence that RLM-enriched indexing improves deterministic 1C navigation without relying on evaluation labels in production indexing.

#### Scenario: Fixture chunk enrichment is deterministic
- **WHEN** a fixture RLM snapshot contains object and symbol metadata for a BSL file split into multiple chunks
- **THEN** tests SHALL prove only the matching chunks receive the overlapping symbol metadata
- **AND** generated vector document identifiers SHALL remain stable for unchanged content, paths, and line ranges

#### Scenario: Live 1C evaluation reports enrichment status
- **WHEN** a live 1C relevance evaluation runs against an RLM-enriched index
- **THEN** the report SHALL identify the enrichment provider and status
- **AND** it SHALL compare enriched results against a non-enriched baseline without using eval expected path prefixes as production ranking rules
