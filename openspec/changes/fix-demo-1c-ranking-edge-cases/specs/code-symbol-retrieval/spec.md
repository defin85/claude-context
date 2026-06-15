## ADDED Requirements

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
