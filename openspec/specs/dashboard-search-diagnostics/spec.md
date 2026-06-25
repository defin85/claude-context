# dashboard-search-diagnostics Specification

## Purpose
TBD - created by archiving change add-dashboard-search-diagnostics. Update Purpose after archive.
## Requirements
### Requirement: Search Filters
The dashboard SHALL let operators pass supported search filters to the existing search behavior.

#### Scenario: Extension filters are provided
- **WHEN** the operator enters extension filters
- **THEN** the dashboard SHALL send those filters to the dashboard search API and render the returned results.

#### Scenario: Ranking profile is selected
- **WHEN** the operator selects `auto`, `generic`, or `one-c`
- **THEN** the dashboard SHALL pass that ranking profile to the existing search behavior.

### Requirement: Retrieval Context Visibility
The dashboard SHALL display retrieval configuration relevant to search.

#### Scenario: Retrieval configuration is available
- **WHEN** selected-codebase status or search response includes retrieval profile, retrieval mode, schema version, or 1C scope profile
- **THEN** the dashboard SHALL display those fields near the search controls or results.

#### Scenario: Retrieval configuration is absent
- **WHEN** retrieval configuration is absent
- **THEN** the dashboard SHALL show an unknown state without blocking search.

### Requirement: Result Diagnostics
The dashboard SHALL render search result diagnostics when metadata is available.

#### Scenario: Search result metadata exists
- **WHEN** a search result includes retrieval sources, semantic score, lexical score, ranking profile, boosts, penalties, or provider diagnostics
- **THEN** the dashboard SHALL make those fields available in the result details.

#### Scenario: Copy result location
- **WHEN** an operator clicks a copy-location action
- **THEN** the dashboard SHALL copy or expose the result location as `relativePath:startLine`.

### Requirement: Search Does Not Implicitly Index
The dashboard SHALL NOT start indexing as a side effect of search.

#### Scenario: Codebase is unindexed
- **WHEN** search returns a not-indexed error
- **THEN** the dashboard SHALL show the error state and SHALL NOT start an indexing job.

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

