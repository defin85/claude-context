# retrieval-performance-profiles Specification

## Purpose
Define retrieval performance profiles that control indexing cost, stored vector shape, and search quality tradeoffs independently from search-time ranking profiles.
## Requirements
### Requirement: Retrieval Profile Selection
The system SHALL support explicit retrieval performance profiles named `fast`, `balanced`, and `quality`.

#### Scenario: Fast profile is selected
- **WHEN** retrieval profile is configured as `fast`
- **THEN** the system SHALL use a retrieval configuration that minimizes indexing and insert cost and SHALL NOT store ColBERT token vectors

#### Scenario: Balanced profile is selected
- **WHEN** retrieval profile is configured as `balanced`
- **THEN** the system SHALL use a retrieval configuration that keeps lexical or sparse retrieval help where available without requiring stored ColBERT token vectors

#### Scenario: Fast profile does not change chunking or batching controls
- **WHEN** retrieval profile is configured as `fast`
- **THEN** the system SHALL NOT change splitter type, chunk size, chunk overlap, `CODE_CHUNK_LIMIT`, or embedding and insert batch limits solely because of the profile

#### Scenario: Quality profile is selected
- **WHEN** retrieval profile is configured as `quality`
- **THEN** the system SHALL use full BGE-M3 dense+sparse+ColBERT retrieval when the BGE-M3 provider is active and full mode is available

#### Scenario: Invalid profile is configured
- **WHEN** retrieval profile configuration contains an unsupported value
- **THEN** the system SHALL fail configuration validation with a clear error that lists supported profile values

### Requirement: Profile Mapping Is Deterministic
The system SHALL map each retrieval profile to a deterministic retrieval mode, schema version, and provider-specific low-level settings.

#### Scenario: BGE-M3 fast profile mapping
- **WHEN** `EMBEDDING_PROVIDER=BGE_M3` and retrieval profile is `fast`
- **THEN** the system SHALL use BGE-M3 dense-only retrieval and SHALL NOT require sparse weights or ColBERT vectors from the sidecar

#### Scenario: BGE-M3 balanced profile mapping
- **WHEN** `EMBEDDING_PROVIDER=BGE_M3` and retrieval profile is `balanced`
- **THEN** the system SHALL use BGE-M3 dense-only retrieval in the first version
- **AND** it SHALL NOT store sparse weights or ColBERT vectors
- **AND** it SHALL NOT use a sparse-without-ColBERT BGE-M3 collection or search path

#### Scenario: BGE-M3 quality profile mapping
- **WHEN** `EMBEDDING_PROVIDER=BGE_M3` and retrieval profile is `quality`
- **THEN** the system SHALL require full BGE-M3 dense, sparse, and ColBERT vectors and SHALL require stored document ColBERT token vectors for reranking

#### Scenario: Non-BGE provider balanced profile mapping
- **WHEN** a non-BGE-M3 embedding provider uses retrieval profile `balanced`
- **THEN** the system SHALL map the profile to the existing hybrid dense+BM25 sparse retrieval behavior when hybrid mode is enabled

#### Scenario: Low-level override conflicts with profile
- **WHEN** low-level environment settings conflict with the selected retrieval profile
- **THEN** the system SHALL reject configuration validation with a clear conflict error
- **AND** it SHALL NOT silently normalize, downgrade, or ignore the conflicting low-level setting

#### Scenario: Retrieval profile is distinct from ranking profile
- **WHEN** a retrieval profile and a ranking profile are both configured
- **THEN** retrieval profile SHALL control storage and search shape
- **AND** ranking profile SHALL control result scoring behavior only
- **AND** changing ranking profile SHALL NOT require reindexing by itself

### Requirement: Profile Persistence
The system SHALL persist the selected retrieval profile for each indexed codebase together with retrieval mode and retrieval schema version.

#### Scenario: New index persists profile
- **WHEN** a codebase is indexed with a retrieval profile
- **THEN** the persisted codebase session config SHALL include the profile, retrieval mode, and retrieval schema version

#### Scenario: Status exposes profile
- **WHEN** `get_indexing_status` is called for a codebase with persisted retrieval configuration
- **THEN** the structured status SHALL include retrieval profile, retrieval mode, and retrieval schema version

#### Scenario: Daemon status exposes active profile
- **WHEN** daemon status includes current retrieval configuration
- **THEN** the structured daemon status SHALL include the configured default retrieval profile without exposing secrets

### Requirement: Profile Compatibility Guard
The system SHALL prevent accidental use of an existing codebase index with an incompatible retrieval profile.

#### Scenario: Compatible persisted profile
- **WHEN** an indexed codebase is searched with the same persisted profile and retrieval schema
- **THEN** the system SHALL use the existing collection without requiring reindex

#### Scenario: Incompatible profile without force
- **WHEN** indexing is requested for a codebase whose persisted profile or retrieval schema is incompatible with the requested profile and `force` is not true
- **THEN** the system SHALL reject the operation and report that `force=true` reindex is required

#### Scenario: Incompatible profile with force
- **WHEN** indexing is requested for a codebase whose persisted profile or retrieval schema is incompatible with the requested profile and `force=true`
- **THEN** the system SHALL rebuild the index using the requested profile and update persisted retrieval configuration after successful indexing

#### Scenario: Search uses persisted retrieval shape
- **WHEN** a codebase has persisted retrieval mode and schema
- **THEN** search SHALL use the persisted retrieval profile, mode, schema, and collection prefix rather than a different current default profile

### Requirement: Profile Override Scope
The system SHALL define clear precedence between global defaults and per-indexing profile overrides.

#### Scenario: Global default profile
- **WHEN** no per-call retrieval profile is provided
- **THEN** indexing SHALL use the configured global default retrieval profile

#### Scenario: Per-call profile override
- **WHEN** `index_codebase` receives a retrieval profile override
- **THEN** that indexing operation SHALL use the override after access-policy and compatibility validation

#### Scenario: Override is persisted
- **WHEN** indexing with a per-call profile override succeeds
- **THEN** the override profile SHALL become the persisted profile for that codebase

### Requirement: Documentation and Operator Guidance
The system SHALL document retrieval profiles, tradeoffs, migration requirements, and verification commands.

#### Scenario: Operator chooses a profile
- **WHEN** a user reads the retrieval profile documentation
- **THEN** it SHALL explain indexing speed, storage cost, query quality, and latency tradeoffs for `fast`, `balanced`, and `quality`

#### Scenario: BGE-M3 modes are explained
- **WHEN** a user reads BGE-M3 documentation
- **THEN** it SHALL distinguish dense-only BGE-M3 from full BGE-M3 dense+sparse+ColBERT retrieval

#### Scenario: Profile migration is explained
- **WHEN** a user reads migration documentation
- **THEN** it SHALL explain that incompatible profile changes require explicit `force=true` reindex and do not automatically migrate existing collections

### Requirement: Retrieval profile state is included in unified profile state
The system SHALL include retrieval performance profile information in the unified profile-state contract for daemon defaults and persisted codebase indexes.

#### Scenario: Daemon retrieval profile state is available
- **WHEN** daemon status includes current retrieval configuration
- **THEN** `profileState.daemon.retrieval` SHALL include configured retrieval profile, resolved retrieval profile, retrieval mode, retrieval schema version, and provider-specific shape indicators when available

#### Scenario: Codebase retrieval profile state is available
- **WHEN** codebase status includes persisted retrieval configuration
- **THEN** `profileState.codebase.retrieval` SHALL include indexed retrieval profile, retrieval mode, retrieval schema version, and compatibility classification

#### Scenario: Dense-only and full BGE-M3 are distinguishable
- **WHEN** profile state represents BGE-M3 retrieval
- **THEN** it SHALL distinguish dense-only BGE-M3 from full BGE-M3 dense+sparse+ColBERT retrieval
- **AND** the distinction SHALL be machine-readable for dashboard rendering

