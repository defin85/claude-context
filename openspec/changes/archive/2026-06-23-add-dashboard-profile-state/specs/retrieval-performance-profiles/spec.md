## ADDED Requirements

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
