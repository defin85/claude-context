## ADDED Requirements

### Requirement: Hybrid retrieval supports explicit ranking profiles
The system SHALL support an explicit ranking profile that controls domain-specific ranking signals without disabling semantic, lexical, exact-symbol, path, provider, or duplicate-diversity retrieval behavior.

#### Scenario: Generic profile disables 1C-specific ranking signals
- **WHEN** a search runs with ranking profile `generic`
- **THEN** 1C-specific object-kind, object-name, and intent boosts SHALL be disabled
- **AND** semantic, lexical, exact-symbol, path, provider, and duplicate-diversity scoring SHALL remain active
- **AND** paths such as `src/Documents/Foo.ts`, `src/Catalogs/Product.ts`, or `src/Reports/Sales.ts` SHALL NOT receive 1C-specific boosts solely because their path segments resemble 1C metadata names

#### Scenario: One-C profile enables 1C-specific ranking signals
- **WHEN** a search runs with ranking profile `one-c`
- **THEN** recognized 1C exported-configuration paths SHALL be eligible for bounded 1C object-kind, object-name, and intent boosts
- **AND** 1C ranking signals SHALL still be based on generic query, path, content, semantic, lexical, symbol, provider, and score evidence rather than evaluation labels

#### Scenario: Auto profile preserves backward-compatible behavior
- **WHEN** a search omits ranking profile or explicitly uses ranking profile `auto`
- **THEN** the system SHALL preserve the existing automatic path-based 1C signal behavior
- **AND** existing callers SHALL NOT need to change their request shape to keep current search behavior

### Requirement: Ranking profile is exposed through MCP search
The MCP `search_code` tool SHALL allow callers to request the ranking profile for a search and SHALL report the resolved profile in diagnostics or structured output.

#### Scenario: Search-code accepts ranking profile
- **WHEN** a caller invokes `search_code` with `rankingProfile` set to `auto`, `generic`, or `one-c`
- **THEN** the tool SHALL validate the value
- **AND** it SHALL pass the resolved profile to core retrieval
- **AND** invalid profile values SHALL fail with a clear validation error

#### Scenario: Search-code defaults remain backward-compatible
- **WHEN** a caller invokes `search_code` without `rankingProfile`
- **THEN** the tool SHALL use a persisted codebase default profile only when one was explicitly configured
- **AND** otherwise SHALL use `auto`
- **AND** it SHALL NOT infer and persist a profile silently from path shape, index scope, prior query text, or previous search results
- **AND** the response diagnostics or metadata SHALL identify the resolved profile

### Requirement: Ranking profile is independent from 1C indexing scope
The system SHALL keep ranking profile separate from `oneCIndexScopeProfile`.

#### Scenario: Ranking profile override does not require reindexing
- **WHEN** a codebase was indexed with an existing `oneCIndexScopeProfile`
- **AND** a search overrides `rankingProfile`
- **THEN** the search SHALL use the requested ranking profile without requiring a new index
- **AND** it SHALL NOT change the persisted 1C indexing scope profile
- **AND** it SHALL NOT persist the search-time ranking profile unless an explicit configuration operation requests persistence

#### Scenario: One-C indexing scope does not force One-C ranking profile
- **WHEN** a codebase has a persisted `oneCIndexScopeProfile`
- **AND** a caller searches with ranking profile `generic`
- **THEN** the search SHALL disable 1C-specific ranking signals for that request
- **AND** it SHALL continue searching the already indexed collection normally

### Requirement: 1C relevance evaluation declares its ranking profile
The fixed 1C relevance evaluation and live MCP runner SHALL run 1C acceptance checks with an explicit ranking profile.

#### Scenario: Demo 1C live runner uses One-C ranking profile
- **WHEN** the live MCP runner evaluates `examples/demo-1c`
- **THEN** it SHALL pass ranking profile `one-c` to `search_code`
- **AND** the raw JSON, scored JSON, comparison JSON, and Markdown report SHALL record the profile used

#### Scenario: Generic regression tests protect non-1C stacks
- **WHEN** automated tests run for a non-1C codebase with misleading path segments such as `Documents`, `Catalogs`, or `Reports`
- **THEN** ranking profile `generic` SHALL prevent 1C-specific boosts
- **AND** exact-symbol and provider-backed results SHALL keep their expected ordering
