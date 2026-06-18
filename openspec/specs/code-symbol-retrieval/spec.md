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

### Requirement: Demo 1C residual edge cases are closed against the final residual baseline
The system SHALL treat the final `improve-demo-1c-ranking-residuals` live score of Hit@10 `27/30` as the regression baseline for this follow-up.

#### Scenario: Follow-up live run preserves the final residual baseline
- **WHEN** the Qdrant default backend indexes `examples/demo-1c` with `oneCIndexScopeProfile=developer`
- **AND** the live MCP acceptance runner executes the 30-query relevance dataset
- **THEN** the run SHALL have `0` MCP tool errors
- **AND** it SHALL have `0` missing ColBERT vector errors
- **AND** it SHALL reach at least Hit@10 `27/30`
- **AND** it SHALL compare against the final `27/30` residual baseline
- **AND** it SHALL fail when the tuned run falls below that baseline

#### Scenario: Residual assertions cannot be hidden by aggregate metrics
- **WHEN** the live acceptance runner is configured with required residual outcomes
- **THEN** the runner SHALL fail if a required residual query regresses
- **AND** it SHALL fail if a required residual ordering assertion is not satisfied
- **AND** it SHALL report the status, first relevant rank, and top paths for each required residual query
- **AND** residual query IDs and assertions SHALL be supplied through evaluation configuration or runner options rather than production ranking code

### Requirement: Product-card intent outranks barcode-only commands when card evidence is stronger
The system SHALL rank product catalog item forms and product object modules above scanner setup or barcode print commands for product-card attribute queries when the product-card candidate has supporting query, path, content, semantic, lexical, symbol, or provider evidence.

#### Scenario: Product-card live query does not prefer barcode print command solely for barcode terms
- **WHEN** the query is `карточка товара реквизиты цена артикул штрихкод`
- **AND** both `Catalogs/Товары/Commands/ПечатьШтрихкода` and a product item form or product object module are available in the candidate set
- **THEN** the product item form or product object module SHALL rank above the barcode print command
- **AND** the result diagnostics SHALL show bounded path, name, intent, fusion, or diversity evidence explaining the ordering

#### Scenario: Print-barcode intent still supports barcode print commands
- **WHEN** a query explicitly asks to print a product barcode or barcode label
- **THEN** barcode print commands SHALL remain eligible for bounded ranking support
- **AND** product-card deboosting SHALL NOT remove exact-symbol or provider-backed barcode print command chunks

### Requirement: Stock-report residual intent surfaces stock report contexts
The system SHALL rank stock reports, stock-balance common commands, and stock-related product list forms above broad document modules for stock-report navigation queries when those stock contexts have supporting evidence.

#### Scenario: Stock-report residual reaches top ten
- **WHEN** the query is `остатки товаров на складах отчет по складу`
- **THEN** at least one expected stock report, stock-balance common command, or stock-related product list form prefix SHALL appear in the top 10 results
- **AND** broad document modules SHALL NOT occupy the top results solely because they contain common inventory words

#### Scenario: Stock-report diagnostics expose diversity and intent evidence
- **WHEN** repeated broad document chunks compete with distinct stock-report files
- **THEN** duplicate penalties or diversity reasons SHALL be visible in result diagnostics
- **AND** stock-report candidates SHALL show bounded stock-report path, name, content, semantic, lexical, symbol, provider, or intent evidence

### Requirement: Mobile-device common-form residual intent surfaces exact common forms
The system SHALL rank exact or near-exact common-form name matches for mobile-device settings above generic settings, selection, storage, or unrelated mobile catalog contexts when the query matches the common-form name.

#### Scenario: Mobile-device settings common form reaches top ten
- **WHEN** the query is `настройки мобильного устройства форма настройки`
- **THEN** `CommonForms/НастройкиМобильногоУстройства` SHALL appear in the top 10 results
- **AND** generic settings forms, storage forms, selection forms, or mobile-device catalog modules SHALL NOT outrank it solely because they share words such as `настройки`, `мобильного`, `устройства`, or `форма`

#### Scenario: Common-form name support remains generic
- **WHEN** a query nearly matches a common-form path name outside `examples/demo-1c`
- **THEN** that common form SHALL receive bounded support based on path-name and query-term evidence
- **AND** unknown customized layouts SHALL remain neutral unless their path, name, content, semantic, lexical, symbol, or provider evidence supports the query

### Requirement: Print residual label decision is executable and label-isolated
The system SHALL convert the `r05` print-command audit into a testable evaluation decision without using print residual labels as production routing rules.

#### Scenario: Print residual label is broadened or command-only target is enforced
- **WHEN** `r05` is evaluated for `печать расходной накладной документ расход товара`
- **THEN** the evaluation SHALL either include the legitimate object-module print context in expected prefixes
- **OR** the command-only label SHALL remain documented and `Documents/РасходТовара/Commands/ПечатьРасходнойНакладной` SHALL appear in the top 10 results
- **AND** the chosen decision SHALL be recorded in the generated report and verification notes

#### Scenario: Print evaluation truth does not become production routing
- **WHEN** production `search_code` ranks print-related candidates
- **THEN** it SHALL NOT read query IDs, expected path prefixes, residual labels, or print audit decisions to route, filter, boost, or rank results
- **AND** print support SHALL remain based on generic command, form, report, module, layout, path, content, semantic, lexical, symbol, provider, and score evidence

### Requirement: Production ranking remains independent from universal evaluation labels
The production retrieval and ranking pipeline SHALL NOT use universal 1C evaluation metadata as routing, filtering, boosting, or ranking input.

#### Scenario: Universal query metadata is evaluation-only
- **WHEN** `search_code` processes any query
- **THEN** it SHALL NOT inspect universal query IDs, domains, intents, target statuses, expected path prefixes, acceptable path prefixes, notes, or negative-control labels
- **AND** those fields SHALL be loaded only by evaluation, validation, and reporting workflows

#### Scenario: Fixture identity does not select production weights
- **WHEN** `search_code` ranks results for `rankingProfile=one-c`
- **THEN** it SHALL NOT choose production ranking weights based on fixture names such as `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, or `demo-unf-1c`
- **AND** ranking signals SHALL remain based on query text, path shape, metadata kind, code content, lexical evidence, semantic evidence, symbol/provider evidence, and score diagnostics

#### Scenario: Universal acceptance does not require reindexing
- **WHEN** universal evaluation support is added
- **THEN** existing indexed collections SHALL remain searchable without reindexing
- **AND** any later ranking-only changes validated by the universal matrix SHALL document when reindexing is not required

### Requirement: One-C ranking changes are evaluated for portability
Future `one-c` ranking changes SHALL be validated against generic 1C intent behavior across multiple configurations when they claim cross-configuration quality improvements.

#### Scenario: Generic 1C intent evidence is required
- **WHEN** a ranking change boosts a 1C object kind, metadata name, module kind, form kind, command kind, or domain intent
- **THEN** the change SHALL include evidence that the signal is based on generic query, path, content, semantic, lexical, symbol, provider, or score evidence
- **AND** it SHALL NOT rely on a single fixture's expected answer paths as production behavior

#### Scenario: Multi-configuration regressions are reviewed
- **WHEN** a ranking change is evaluated with the universal matrix
- **THEN** the report SHALL show per-fixture and per-domain regressions
- **AND** regressions in one fixture SHALL be reviewed explicitly before aggregate gains are accepted

#### Scenario: Negative-control behavior protects broad search
- **WHEN** a ranking change increases exact-looking metadata-name, object-kind, form-kind, or module-kind support
- **THEN** universal negative controls SHALL verify that broad conceptual queries still keep better-supported broad or semantic results eligible
- **AND** exact-symbol or provider-backed results SHALL NOT be suppressed solely to satisfy a universal positive label

### Requirement: One-C ranking matches compound 1C metadata names without labels
The system SHALL use generic compound-name matching for recognized 1C exported-configuration paths when `rankingProfile=one-c` or equivalent automatic 1C behavior is active.

#### Scenario: Compound form name matches natural-language phrase
- **WHEN** a query contains natural-language terms that correspond to a compound 1C form name such as `ПечатьПисьма`, `ПросмотрВложенногоПисьма`, or `Подписи`
- **AND** candidate results include a recognized 1C form whose path kind, area kind, content, semantic score, lexical score, exact-symbol evidence, or provider evidence independently supports that compound-name intent beyond raw form-name token overlap
- **THEN** the matching form candidate SHALL receive bounded compound-name ranking support
- **AND** unrelated email, EDI, settings, or viewing forms SHALL NOT outrank it solely through shared generic domain words

#### Scenario: Compound constant name matches registry-address intent
- **WHEN** a query contains terms such as `адрес`, `реестр`, `МЧД`, `ФНС`, `константа`, or `менеджер`
- **AND** candidate results include a constant manager module whose compound name and independent evidence from module kind, content, semantic score, lexical score, exact-symbol evidence, or provider evidence support that query
- **THEN** the matching constant manager SHALL receive bounded ranking support
- **AND** unrelated address-list, email-list, or exchange-manager candidates SHALL NOT outrank it solely through generic `адрес` or `менеджер` terms

#### Scenario: Compound module name matches counterparty state intent
- **WHEN** a query asks about saved counterparty state by INN and KPP
- **AND** candidate results include a counterparty-checking client/server or server-call module whose compound name and independent content, semantic, lexical, exact-symbol, or provider evidence support that intent
- **THEN** the matching counterparty-checking module SHALL receive bounded ranking support
- **AND** unrelated counterparty overview, requisites-fill, dossier, or EDI state candidates SHALL NOT outrank it solely through shared `контрагент`, `состояние`, `ИНН`, or `КПП` terms

#### Scenario: Object-module and manager-module terms are distinguished
- **WHEN** a query names a 1C document and asks for its object module or manager module behavior
- **THEN** candidates whose module kind matches the requested module kind and whose document name or content supports the requested workflow SHALL receive bounded support
- **AND** the opposite module kind SHALL NOT outrank the matching module solely because it shares the same document object name

### Requirement: Compound-name ranking resists overfitting
The system SHALL keep compound-name ranking generic, bounded, and independent from evaluation datasets.

#### Scenario: Production ranking does not inspect evaluation labels
- **WHEN** production `search_code` ranks any result
- **THEN** it SHALL NOT inspect scenario IDs, holdout IDs, expected path prefixes, acceptable path prefixes, failure classes, notes, or dataset files
- **AND** compound-name support SHALL be derived from query text and candidate evidence only

#### Scenario: Fixture identity does not select compound-name weights
- **WHEN** production `search_code` ranks results with `rankingProfile=one-c`
- **THEN** it SHALL NOT choose compound-name weights or routing based on fixture names such as `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, `demo-unf-1c`, or `demo-zup-1c`
- **AND** compound-name ranking SHALL remain based on query text, 1C path shape, metadata kind, module kind, content, lexical evidence, semantic evidence, exact-symbol evidence, provider evidence, and diagnostics

#### Scenario: Broad conceptual queries keep subsystem results eligible
- **WHEN** a query contains broad subsystem terms without concrete object, form, constant, command, manager-module, object-module, or compound-name intent
- **THEN** broad common modules, manager modules, service modules, and subsystem modules SHALL remain eligible for top ranking
- **AND** compound-name support SHALL NOT penalize them solely because they are broad files

#### Scenario: Negative controls prevent exact-looking false positives
- **WHEN** a query asks for a generic email, EDI, MCHD, archive, counterparty, state, settings, signature, or document concept
- **AND** a candidate has an exact-looking compound name but lacks supporting query and candidate evidence for the requested workflow
- **THEN** that candidate SHALL NOT receive enough compound-name support to outrank better-supported broad or semantic candidates
- **AND** exact-symbol and provider-backed candidates SHALL remain protected when they are genuinely requested

#### Scenario: Diagnostics expose compound-name evidence
- **WHEN** compound-name support changes a result score
- **THEN** result metadata SHALL expose a compact diagnostic score or reason for the compound-name component
- **AND** diagnostics SHALL NOT include dense, sparse, or ColBERT vector payloads

### Requirement: 1C scenario intent influences ranking without evaluation labels
The system SHALL use bounded, generic 1C scenario-intent signals to rank concrete workflow files above broad neighboring files when candidate evidence supports the query.

#### Scenario: Concrete object-kind intent can outrank broad subsystem modules
- **WHEN** a query contains concrete 1C object-kind intent such as form, common form, document, report, constant, command, document journal, manager module, or object module
- **AND** candidate results include both a broad common module and a file whose path, metadata object name, code text, semantic score, lexical score, exact-symbol evidence, or provider evidence supports that object-kind intent
- **THEN** the concrete object-kind candidate SHALL receive bounded ranking support
- **AND** the broad common module SHALL NOT outrank the concrete candidate solely because it contains more generic subsystem terms

#### Scenario: Directional workflow terms influence matching forms and documents
- **WHEN** a query contains directional workflow terms such as inbound, outgoing, incoming, исходящий, входящий, EDI, ЭДО, email, электронная почта, MCHD, МЧД, FNS, ФНС, SMS, or archive transfer
- **THEN** candidates whose path or content matches the direction and workflow domain SHALL receive bounded ranking support
- **AND** candidates from the same broad subsystem but the wrong direction SHALL NOT outrank the matching directional candidate solely through shared subsystem words

#### Scenario: Generic term dominance is dampened when specific evidence exists
- **WHEN** a query contains generic 1C terms such as обработка, состояние, проверка, подпись, настройка, форма, документ, or письмо together with more specific domain evidence
- **THEN** ranking SHALL prevent the generic terms from dominating more specific matching candidates by themselves
- **AND** exact-symbol, provider-backed, or strongly semantic generic-term matches SHALL remain eligible when they are the best supported candidate

#### Scenario: Broad queries keep broad subsystem results eligible
- **WHEN** a query does not express a concrete object-kind or directional workflow intent
- **THEN** broad common modules, manager modules, service modules, and subsystem modules SHALL remain eligible for top ranking
- **AND** the scenario-intent ranking layer SHALL NOT penalize them solely because they are broad files

### Requirement: Observed large 1C failure classes are covered by generic ranking behavior
The system SHALL include generic ranking behavior and tests for the failure classes found in the first `demo-do30-1c` quality probe.

#### Scenario: FNS response handling can surface the FNS module
- **WHEN** a query mentions FNS response handling with terms such as `NdsResponse`, `ФНС`, and counterparty state
- **THEN** the FNS counterparty-checking module SHALL rank above unrelated queue-processing or generic object-processing modules when its candidate evidence is comparable

#### Scenario: Saved counterparty state can surface server-call counterparty modules
- **WHEN** a query asks where the current saved counterparty state by INN and KPP is stored or loaded
- **THEN** counterparty-checking server-call modules SHALL rank above unrelated counterparty exchange modules when their candidate evidence is comparable

#### Scenario: MCHD constants can surface constant manager modules
- **WHEN** a query asks about a specific MCHD constant such as registry address or signature type
- **THEN** the constant manager module or its exact settings form SHALL rank above generic signature-check result forms when their candidate evidence is comparable

#### Scenario: Inbound and outbound EDI forms can surface viewing forms
- **WHEN** a query asks about manual signature or MCHD checks in inbound or outbound EDI documents
- **THEN** the matching inbound or outbound electronic-document viewing form SHALL remain eligible for top-5 ranking
- **AND** broad MCHD modules SHALL NOT suppress it solely through shared MCHD terminology

#### Scenario: Send assistant form intent can surface the form module
- **WHEN** a query asks about the send assistant UI, its variant tree, or sendability checks
- **THEN** `CommonForms` send-assistant form modules SHALL rank above common helper modules when the query expresses form or UI intent

#### Scenario: Email print and save workflows can surface journal forms
- **WHEN** a query asks about printing or saving email from the email journal
- **THEN** the relevant email journal form SHALL remain eligible for top-5 ranking
- **AND** account setup forms SHALL NOT outrank it solely through shared email terms

#### Scenario: SMS document workflow can distinguish service and document contexts
- **WHEN** a query asks about SMS sending implementation through a provider service
- **THEN** SMS service modules SHALL be allowed as acceptable top results
- **AND** when a query asks about SMS notification document status, limits, or document lifecycle, the SMS notification document manager or form SHALL receive bounded ranking support

#### Scenario: Archive-transfer workflow can distinguish manager and object contexts
- **WHEN** a query asks about archive-transfer print registers, signature checks, or 1C Archive integration
- **THEN** the archive-transfer manager or object module matching that action SHALL receive bounded ranking support
- **AND** generic certificate or storage-object forms SHALL NOT outrank it solely through shared archive or signature words

