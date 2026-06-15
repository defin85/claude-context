# code-symbol-retrieval Specification

## Purpose
TBD - created by archiving change hybrid-code-symbol-retrieval. Update Purpose after archive.
## Requirements
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

### Requirement: Hybrid retrieval is validated by fixed 1C relevance eval
The system SHALL include a small fixed 1C relevance eval that measures retrieval quality for representative 1C navigation queries without using eval labels in production search.

#### Scenario: Eval path prefixes are test truth only
- **WHEN** a control query has hand-labeled expected path prefixes
- **THEN** the eval SHALL score returned `relativePath` values against those prefixes
- **AND** production search SHALL NOT use those labels as routing, filtering, boosting, or ranking rules

#### Scenario: Eval reports ranking quality metrics
- **WHEN** the 1C relevance eval runs against a search backend or hybrid retrieval mode
- **THEN** it SHALL report Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, Precision@3, Precision@5, Precision@10, relevant hits at 10, per-query first relevant rank, top result paths, latency, and failures
- **AND** it SHALL omit recall unless the labels become exhaustive relevant-document sets

#### Scenario: Eval covers known 1C navigation misses
- **WHEN** the fixed eval includes queries such as `печать расходной накладной`, `настройки мобильного устройства`, `остатки товаров на складах`, and `карточка товара`
- **THEN** validation SHALL record whether the expected 1C object, command, form, report, or catalog path prefixes appear in the top 5 and top 10 results
- **AND** missing expected prefixes SHALL be reported as per-query quality failures

#### Scenario: Hybrid-symbol quality is compared with baseline
- **WHEN** hybrid-symbol retrieval is implemented
- **THEN** validation SHALL compare it against a captured semantic-only baseline on the fixed 1C relevance eval
- **AND** exact-symbol regressions SHALL fail validation
- **AND** broad semantic queries SHOULD not regress in aggregate Hit@k, MRR@10, or Precision@k metrics

### Requirement: Residual 1C ranking misses are improved against the current live baseline
The system SHALL treat the post-commit `examples/demo-1c` live score of Hit@10 `26/30` as the regression baseline for residual 1C ranking improvements.

#### Scenario: Residual live run preserves current aggregate quality
- **WHEN** the Qdrant default backend indexes `examples/demo-1c` with `oneCIndexScopeProfile=developer`
- **AND** the live MCP acceptance runner executes the 30-query relevance dataset
- **THEN** the run SHALL have `0` MCP tool errors
- **AND** it SHALL have `0` missing ColBERT vector errors
- **AND** it SHALL reach at least Hit@10 `26/30`
- **AND** it SHALL compare against the current `26/30` baseline rather than only the older `18/30` baseline
- **AND** the acceptance runner SHALL fail when the tuned run falls below the current `26/30` baseline
- **AND** the acceptance runner SHALL allow equality with the current `26/30` baseline when the run is explicitly checking non-regression rather than strict improvement

#### Scenario: Residual query outcomes are reported explicitly
- **WHEN** the live acceptance runner produces a tuned report
- **THEN** the report SHALL list the outcome for residual queries `r01`, `r05`, `r06`, and `r28`
- **AND** it SHALL show whether each residual query improved, regressed, remained missing, or was excluded because label validation found it ambiguous or stale
- **AND** aggregate improvements SHALL NOT hide residual-query regressions
- **AND** residual query IDs SHALL be supplied through evaluation configuration or runner options rather than becoming permanent production ranking inputs

### Requirement: Residual 1C labels are validated before score credit
The system SHALL validate residual `demo-1c` expected path prefixes before accepting ranking improvements for the remaining misses.

#### Scenario: Residual labels are checked against fixture paths and content
- **WHEN** the implementation evaluates residual queries `r01`, `r05`, `r06`, and `r28`
- **THEN** each expected path prefix SHALL be checked against the indexed fixture path manifest
- **AND** the implementation SHALL inspect whether highly ranked non-labeled paths are legitimate contexts for the query before treating them as ranking defects
- **AND** stale, ambiguous, or too-narrow labels SHALL be corrected in `evaluation/retrieval/demo-1c-relevance.json` or documented in the generated report

#### Scenario: Print residual labels do not become production routing
- **WHEN** `r05` or another print-related residual label is reviewed
- **THEN** any decision to accept commands, forms, reports, object modules, manager modules, common modules, or layouts SHALL remain evaluation truth only
- **AND** production `search_code` SHALL NOT read query IDs, expected path prefixes, or residual-case labels to route, filter, boost, or rank results

### Requirement: Residual 1C intent signals remain generic and bounded
The system SHALL improve residual 1C navigation ranking through generic query, path, content, provider, and score evidence rather than fixture-specific rules.

#### Scenario: Stock report intent can surface report and stock-list contexts
- **WHEN** a query contains stock-report intent such as `остатки`, `товары`, `склад`, and `отчет`
- **THEN** report paths, stock-balance common commands, and stock-related catalog list forms SHALL receive bounded ranking support when their path, name, code text, semantic score, lexical score, symbol evidence, or provider evidence also supports the query
- **AND** broad document modules SHALL NOT crowd out these report/list contexts solely because they share common inventory words

#### Scenario: Product card intent can surface product item contexts
- **WHEN** a query contains product-card intent such as `карточка товара`, `реквизиты`, `цена`, `артикул`, or `штрихкод`
- **THEN** product catalog item forms and product object modules SHALL receive bounded ranking support when their path, name, code text, semantic score, lexical score, symbol evidence, or provider evidence also supports the query
- **AND** scanner setup commands or print-barcode commands SHALL NOT outrank a more specific product card result solely because they contain `штрихкод`

#### Scenario: Common form name matching can surface exact form intents
- **WHEN** a query nearly matches a common-form path name such as `НастройкиМобильногоУстройства`
- **THEN** that common form SHALL receive bounded ranking support
- **AND** generic settings forms, storage forms, or unrelated selection forms SHALL NOT outrank it solely because they share words like `настройки` or `форма`

#### Scenario: Residual duplicate control protects distinct expected files
- **WHEN** repeated chunks from one broad file compete with distinct files that also have strong query evidence
- **THEN** final top-10 ranking SHALL keep distinct expected-object files eligible
- **AND** duplicate penalties or diversity reasons SHALL be visible in diagnostics
- **AND** exact-symbol or provider-backed chunks SHALL NOT be removed solely because another chunk from the same file was already selected

