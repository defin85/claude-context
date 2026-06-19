## ADDED Requirements

### Requirement: Ranking profile state is observable
The system SHALL expose ranking profile observability through profile state without coupling it to retrieval performance profile or 1C indexing scope.

#### Scenario: Search response includes ranking profile state
- **WHEN** `search_code` runs with ranking profile `auto`, `generic`, or `one-c`
- **THEN** the response profile state SHALL identify the requested ranking profile
- **AND** it SHALL identify the resolved ranking profile when resolution differs from the request or is otherwise known

#### Scenario: Ranking profile remains request-time state
- **WHEN** a search request sets `rankingProfile`
- **THEN** profile state SHALL report it under latest-search state
- **AND** it SHALL NOT persist it as codebase profile state
- **AND** it SHALL NOT require reindexing

#### Scenario: One-C ranking signals are visible
- **WHEN** ranking profile resolution activates 1C-specific ranking behavior
- **THEN** profile state SHALL expose a non-secret indicator that 1C ranking signals are active
- **AND** it SHALL keep this indicator separate from `oneCIndexScopeProfile`
