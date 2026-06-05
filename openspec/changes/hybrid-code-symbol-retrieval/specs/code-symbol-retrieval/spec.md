## ADDED Requirements

### Requirement: Hybrid retrieval preserves exact code symbol matches
The system SHALL rank chunks containing exact code identifiers or declarations above semantically related chunks when the query includes that exact symbol.

#### Scenario: BSL exact function symbol is returned near the top
- **WHEN** a codebase contains `Функция ПараметрыЗаполненияЗаписейСкладскогоЖурнала() Экспорт` in `src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl`
- **THEN** searching for `ПараметрыЗаполненияЗаписейСкладскогоЖурнала` SHALL return that file in the top 3 results

#### Scenario: Exact symbol beats related semantic matches
- **WHEN** both an exact symbol chunk and several semantically related chunks mention `ЗаписьСкладскогоЖурнала`
- **THEN** the exact symbol chunk SHALL rank above related chunks that do not contain the searched symbol

### Requirement: Hybrid retrieval uses code-symbol providers
The system SHALL support pluggable code-symbol providers that return deterministic symbol, declaration, module, and path candidates for fusion with semantic retrieval.

#### Scenario: Provider candidate carries symbol metadata
- **WHEN** a provider returns a candidate for `Функция ПараметрыЗаполненияЗаписейСкладскогоЖурнала() Экспорт`
- **THEN** the candidate SHALL include provider identity plus available symbol metadata such as symbol name, declaration kind, export flag, relative path, module name, object kind, and declaration line

#### Scenario: Provider candidates join semantic candidates
- **WHEN** a query matches a symbol through a code-symbol provider and semantic retrieval also returns candidates
- **THEN** the final result set SHALL include both provider and semantic candidates before fusion ranking is applied

#### Scenario: Provider candidates must map to indexed chunks
- **WHEN** a provider returns a candidate for a relative path or line range that cannot be mapped to any indexed chunk in the current collection
- **THEN** the system SHALL record provider diagnostics and SHALL NOT return or boost that unmapped provider candidate

#### Scenario: Missing provider fails open
- **WHEN** a provider is missing, stale, busy, errors, or is unsupported for the codebase
- **THEN** search SHALL continue using semantic retrieval and the no-reindex lexical fallback over existing stored fields

### Requirement: BSL symbol retrieval reuses specialized BSL tooling
The system SHALL prefer `rlm-tools-bsl` as the BSL/1C symbol provider when it is available and fresh for the codebase, and SHALL NOT require duplicating the full BSL structural index inside `claude-context`.

#### Scenario: rlm-tools-bsl method result is mapped to a search result
- **WHEN** `rlm-tools-bsl` returns a method match for `ПараметрыЗаполненияЗаписейСкладскогоЖурнала` in `src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl`
- **THEN** `claude-context` SHALL map the provider candidate to matching indexed chunk candidates using relative path and available line range

#### Scenario: rlm-tools-bsl root differs from claude-context root
- **WHEN** `rlm-tools-bsl` indexes a nested source root such as `src/cf` and `claude-context` indexes the repository root
- **THEN** provider path normalization SHALL translate the provider path into the `claude-context` relative path before chunk lookup and diagnostics

#### Scenario: rlm-tools-bsl transport is not machine-readable
- **WHEN** the available `rlm-tools-bsl` integration path cannot return structured machine-readable method/object/path results
- **THEN** the provider SHALL remain disabled and search SHALL use semantic retrieval plus fallback lexical matching

#### Scenario: rlm-tools-bsl provider does not auto-build indexes
- **WHEN** no fresh `rlm-tools-bsl` index is available for the codebase
- **THEN** `claude-context` SHALL report provider status and SHALL NOT automatically build, update, or drop the `rlm-tools-bsl` index during search

#### Scenario: BSL provider diagnostics are exposed
- **WHEN** BSL symbol candidates are provided by `rlm-tools-bsl`
- **THEN** result diagnostics SHALL identify `rlm-tools-bsl` as a retrieval source or symbol provider

### Requirement: Hybrid retrieval boosts code paths and module names
The system SHALL recognize path and module-name terms in queries and boost chunks whose `relativePath`, module name, or object path matches those terms.

#### Scenario: BSL common module name is boosted
- **WHEN** a query contains `ЗаполнениеДокументовВЕТИС`
- **THEN** chunks from `src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl` SHALL receive a lexical path/module boost

#### Scenario: Path-like query terms are matched without semantic dilution
- **WHEN** a query contains a path fragment such as `CommonModules ЗаполнениеДокументовВЕТИС`
- **THEN** matching `relativePath` chunks SHALL be included in the fused candidate set before final ranking

### Requirement: Hybrid retrieval preserves semantic search behavior
The system SHALL keep the existing semantic retrieval path active and SHALL fuse lexical candidates with vector candidates instead of replacing vector search.

#### Scenario: Natural-language query still returns semantic candidates
- **WHEN** a user searches for a conceptual query without exact code identifiers
- **THEN** the system SHALL return BGE-M3 dense/sparse/ColBERT semantic results using the existing retrieval mode

#### Scenario: Lexical miss does not suppress semantic results
- **WHEN** no lexical candidate matches the query
- **THEN** the system SHALL return the semantic search results that would have been returned by the existing search pipeline

### Requirement: Hybrid retrieval is backward-compatible with existing indexes
The system SHALL provide a no-reindex lexical fallback using existing stored fields and SHALL keep existing collections searchable when symbol providers or new symbol metadata are unavailable.

#### Scenario: Existing collection without symbol metadata is searchable
- **WHEN** a collection was indexed before symbol metadata fields were introduced
- **THEN** search SHALL still work using semantic retrieval and lexical fallback over existing fields such as `content` and `relativePath`

#### Scenario: Symbol metadata improves ranking after reindex
- **WHEN** a symbol provider is available or a future generic sidecar has been built with symbol metadata
- **THEN** the system SHALL use that metadata for deterministic symbol, declaration, and module boosts

### Requirement: Hybrid retrieval exposes explainable ranking diagnostics
The system SHALL attach optional diagnostics to search result metadata that identify whether a result came from semantic retrieval, lexical retrieval, or both.

#### Scenario: Result metadata includes retrieval source information
- **WHEN** a result is returned by the hybrid code-symbol retrieval pipeline
- **THEN** its metadata SHALL include retrieval source or score fields such as `retrievalSources`, `symbolProvider`, `providerStatus`, `semanticScore`, `lexicalScore`, or `fusionScore`

#### Scenario: Diagnostics remain optional for clients
- **WHEN** a client ignores the new diagnostics fields
- **THEN** the existing `search_code` response shape SHALL remain usable without client changes
