## ADDED Requirements

### Requirement: Provider API returns structured JSON
The system SHALL expose a machine-readable BSL symbol provider API that returns structured JSON instead of human-readable helper text.

#### Scenario: Successful provider query returns schema metadata
- **WHEN** a consumer queries the provider for a BSL symbol
- **THEN** the response SHALL include `schemaVersion`, `provider`, `status`, `sourceRoot`, `query`, `limit`, `capabilities`, `candidates`, and `diagnostics`

#### Scenario: CLI transport stdout is JSON only
- **WHEN** the provider API is invoked through a CLI JSON mode
- **THEN** stdout SHALL contain parseable JSON and SHALL NOT include progress logs or human-readable table output

### Requirement: Provider candidates include mapping metadata
The system SHALL include enough metadata for external consumers to map BSL symbol candidates to their own indexed code chunks.

#### Scenario: Method candidate includes path and line range
- **WHEN** `search_methods` finds `ПараметрыЗаполненияЗаписейСкладскогоЖурнала`
- **THEN** the provider candidate SHALL include `kind=method`, `relativePath`, `symbolName`, `declarationKind`, `startLine`, `endLine`, `objectName`, and provider rank when available

#### Scenario: Object candidate includes object metadata
- **WHEN** `search_objects` finds a matching object or synonym
- **THEN** the provider candidate SHALL include `kind=object`, `relativePath` or file path when available, `objectName`, `objectKind` or category, synonym when available, and provider rank when available

#### Scenario: Provider reports source root
- **WHEN** a provider response contains any candidates
- **THEN** it SHALL include the BSL source root used to compute candidate relative paths

### Requirement: Provider API is query-only
The system SHALL NOT build, update, drop, migrate, or otherwise mutate BSL indexes during provider lookup.

#### Scenario: Missing index is reported without build
- **WHEN** no usable `bsl_index.db` exists for the requested path
- **THEN** the provider response SHALL report a non-available status such as `missing_index` and SHALL NOT start index build or update work

#### Scenario: Stale index is reported without update
- **WHEN** the existing index freshness check reports stale or warning state
- **THEN** the provider response SHALL include status or diagnostics indicating the stale state and SHALL NOT update the index

### Requirement: Provider transport is safe for external adapters
The system SHALL support invocation by external adapters without shell-specific quoting or text scraping.

#### Scenario: Cyrillic query and path with spaces are accepted
- **WHEN** a CLI provider transport is called with argv arguments containing Cyrillic identifiers and paths with spaces
- **THEN** it SHALL parse the arguments correctly and return JSON without requiring shell interpolation

#### Scenario: Unsupported or non-machine-readable transport fails closed
- **WHEN** structured JSON output cannot be produced
- **THEN** the provider SHALL return a documented error/status and consumers SHALL be able to disable provider usage

### Requirement: Existing rlm-tools-bsl behavior remains compatible
The system SHALL preserve existing `rlm-tools-bsl` helper behavior and index management behavior.

#### Scenario: Existing search helpers keep their current shape
- **WHEN** callers use existing helpers such as `search_methods` or `search_objects`
- **THEN** their existing return shapes and fallback behavior SHALL remain compatible

#### Scenario: Existing index management remains explicit
- **WHEN** callers use existing build, update, info, or drop commands
- **THEN** their existing approval, locking, and background behavior SHALL remain controlled by the existing index management flows
