## ADDED Requirements

### Requirement: Dashboard profile state visibility
The dashboard SHALL display daemon, selected-codebase, and latest-search profile state when the server provides `profileState`.

#### Scenario: Profile state is available
- **WHEN** dashboard status responses include `profileState`
- **THEN** the dashboard SHALL render separate daemon, repository, and latest-search profile sections
- **AND** it SHALL distinguish daemon defaults from persisted repository index state

#### Scenario: Codebase profile differs from daemon default
- **WHEN** selected-codebase profile state differs from the daemon default retrieval profile or schema
- **THEN** the dashboard SHALL show a mismatch or compatibility indicator without marking the codebase as failed unless the server reports a failure state

#### Scenario: One-C reduced coverage is available
- **WHEN** selected-codebase profile state includes reduced 1C coverage or a reduced `oneCIndexScopeProfile`
- **THEN** the dashboard SHALL show that the repository was indexed with reduced 1C coverage

#### Scenario: RLM BSL enrichment status is available
- **WHEN** selected-codebase profile state includes RLM BSL enrichment status
- **THEN** the dashboard SHALL show whether enrichment is disabled, enabled, required, partial, unavailable, or failed according to the server-provided status

### Requirement: Dashboard profile state fallback
The dashboard SHALL remain compatible with status responses that do not yet include `profileState`.

#### Scenario: Profile state is absent
- **WHEN** daemon, codebase, or search responses omit `profileState`
- **THEN** the dashboard SHALL fall back to existing retrieval, ranking, 1C scope, and enrichment fields where available
- **AND** it SHALL show unknown states for unavailable profile data without blocking status refresh or search

#### Scenario: Profile labels are operator-readable
- **WHEN** the dashboard renders profile state
- **THEN** labels SHALL use clear operator-facing names for retrieval profile, retrieval mode, ranking profile, 1C coverage, and RLM BSL enrichment
- **AND** labels SHALL NOT expose raw secret-bearing configuration values
