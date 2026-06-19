## ADDED Requirements

### Requirement: Unified profile state contract
The system SHALL expose a structured `profileState` object that separates daemon default profile state, selected codebase index-time profile state, and latest search-time profile state.

#### Scenario: Daemon profile state is exposed
- **WHEN** daemon status is requested
- **THEN** the structured response SHALL include `profileState.daemon`
- **AND** it SHALL identify the configured retrieval profile, resolved retrieval profile, retrieval mode, retrieval schema version, and non-secret source or default status when available

#### Scenario: Codebase profile state is exposed
- **WHEN** indexing status is requested for a codebase
- **THEN** the structured response SHALL include `profileState.codebase`
- **AND** it SHALL identify persisted retrieval profile, retrieval mode, retrieval schema version, 1C indexing scope profile, 1C scope status, and RLM BSL enrichment status when available

#### Scenario: Search profile state is exposed
- **WHEN** search results are returned
- **THEN** the structured response SHALL include `profileState.search`
- **AND** it SHALL identify requested ranking profile and resolved ranking profile when available

### Requirement: Profile state compatibility classification
The system SHALL classify selected codebase profile state against current daemon defaults without blocking normal status rendering.

#### Scenario: Codebase retrieval profile differs from daemon default
- **WHEN** a codebase has a persisted retrieval profile
- **AND** daemon status has a different configured or resolved default retrieval profile
- **THEN** `profileState.codebase.retrieval.compatibility` SHALL indicate a mismatch or default difference
- **AND** the status response SHALL NOT imply that the existing index is invalid solely because the daemon default changed

#### Scenario: Retrieval schema requires explicit reindex
- **WHEN** a codebase profile state indicates an incompatible retrieval mode or schema for a requested indexing operation
- **THEN** the profile state SHALL expose a `requires-force` compatibility classification
- **AND** existing force-reindex guard behavior SHALL remain authoritative

#### Scenario: Profile metadata is missing
- **WHEN** an older indexed codebase lacks persisted profile metadata
- **THEN** the system SHALL return an `unknown` or `inferred` profile-state classification
- **AND** it SHALL NOT fail dashboard status rendering

### Requirement: Profile state secret handling
The system SHALL redact secret-bearing profile configuration in all profile-state responses.

#### Scenario: RLM BSL enrichment command is configured
- **WHEN** RLM BSL enrichment has a command configured
- **THEN** profile state SHALL expose only non-secret mode, status, and command-configured boolean fields
- **AND** it SHALL NOT expose raw command lines, tokens, passwords, or environment dumps

#### Scenario: Daemon retrieval configuration uses secret-bearing provider settings
- **WHEN** daemon profile state is returned
- **THEN** it SHALL NOT include bearer tokens, provider API keys, Milvus tokens, or secret environment values
