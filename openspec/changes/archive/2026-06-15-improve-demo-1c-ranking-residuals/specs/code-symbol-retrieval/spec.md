## ADDED Requirements

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
