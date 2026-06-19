## ADDED Requirements

### Requirement: Search profile state diagnostics
The dashboard search diagnostics SHALL expose requested and resolved ranking profile state separately from persisted repository state.

#### Scenario: Ranking profile is resolved
- **WHEN** dashboard search returns results or diagnostics
- **THEN** the response SHALL identify the requested ranking profile and the resolved ranking profile when available
- **AND** the dashboard SHALL render the resolved ranking profile as latest-search state

#### Scenario: Ranking profile differs from 1C indexing scope
- **WHEN** a repository has a persisted 1C indexing scope
- **AND** the latest search uses `generic` ranking profile
- **THEN** the dashboard SHALL show the generic latest-search ranking state
- **AND** it SHALL NOT imply that the repository indexing scope changed

#### Scenario: Search diagnostics omit profile state
- **WHEN** a search response lacks profile-state diagnostics
- **THEN** the dashboard SHALL continue rendering existing result diagnostics and SHALL show unknown latest-search profile state
