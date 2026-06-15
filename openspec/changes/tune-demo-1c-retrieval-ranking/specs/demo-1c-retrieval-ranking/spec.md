## ADDED Requirements

### Requirement: Demo 1C ranking evaluation is reproducible
The system SHALL provide a committed workflow for collecting and scoring live MCP `search_code` results against the `demo-1c` relevance dataset.

#### Scenario: Live MCP results are collected for the relevance dataset
- **WHEN** the ranking evaluation runner is executed against an active MCP daemon and the `examples/demo-1c` codebase
- **THEN** it SHALL run every query from `evaluation/retrieval/demo-1c-relevance.json`
- **AND** it SHALL save raw per-query top results with relative paths, line ranges, scores, and result metadata
- **AND** it SHALL save a machine-readable report and a human-readable summary under `.artifacts/hybrid-code-symbol-retrieval/`

#### Scenario: Evaluation reports standard ranking metrics
- **WHEN** saved live results are scored against `evaluation/retrieval/demo-1c-relevance.json`
- **THEN** the report SHALL include Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, Precision@3, Precision@5, Precision@10, relevant hits at 10, per-query first relevant rank, top paths, failures, and latency where available

#### Scenario: Live result schemas are normalized before scoring
- **WHEN** the scoring workflow receives saved live results
- **THEN** it SHALL normalize supported result shapes, including raw per-query `results` arrays and live report rows with `top10[].path`
- **AND** it SHALL fail explicitly on unsupported shapes instead of scoring every query as missing because paths could not be read

#### Scenario: Baseline and tuned reports are comparable
- **WHEN** a tuned ranking run is produced
- **THEN** the artifacts SHALL identify the baseline run, tuned run, codebase path, backend label, dataset version, query count, and acceptance threshold
- **AND** the tuned report SHALL make per-query regressions visible rather than only reporting aggregate metrics

#### Scenario: Dataset labels are validated before threshold acceptance
- **WHEN** the acceptance runner evaluates `evaluation/retrieval/demo-1c-relevance.json`
- **THEN** every expected path prefix SHALL be checked against the indexed `examples/demo-1c` fixture or an equivalent fixture path manifest
- **AND** stale, unreachable, or intentionally ambiguous expected prefixes SHALL be corrected in the dataset or listed by query ID in the report before a final Hit@10 threshold is used as a hard completion gate
- **AND** the final threshold SHALL be documented after label validation, using Hit@10 24/30 only when the current label set is confirmed reachable and unambiguous enough for that target
- **AND** the acceptance runner SHALL exit unsuccessfully when a configured acceptance threshold is not reached, unless the run explicitly marks itself as a baseline or measurement pass that allows a below-threshold result
- **AND** label corrections SHALL remain evaluation data and SHALL NOT be used by production `search_code`

### Requirement: Ranking diagnostics explain score composition
The system SHALL expose enough result metadata to explain why top results were ranked above or below expected 1C objects.

#### Scenario: Top results include score components
- **WHEN** `search_code` returns ranked results for the demo 1C acceptance run
- **THEN** each top result used in the report SHALL include available score components such as semantic score, lexical score, exact-symbol boost, path boost, 1C intent or object boost, duplicate penalty or diversity metadata, and final fusion score

#### Scenario: Diagnostics do not expose large vector payloads
- **WHEN** ranking diagnostics are included in MCP results or evaluation artifacts
- **THEN** they SHALL NOT include dense, sparse, or ColBERT vector payloads
- **AND** they SHALL remain small enough for normal `search_code` responses

### Requirement: 1C-aware ranking improves navigation results without hard-coded labels
The system SHALL tune hybrid code-symbol retrieval using bounded 1C metadata and query-intent hints rather than `demo-1c` expected path labels or fixed assumptions about one configuration layout.

#### Scenario: Metadata object kind influences ranking
- **WHEN** a query contains 1C object-kind intent such as catalog, document, register, report, command, item form, list form, document form, or print command
- **THEN** results whose `relativePath` and metadata match that object-kind intent SHALL receive a bounded deterministic ranking signal
- **AND** that signal SHALL NOT dominate stronger semantic, lexical, exact-symbol, or provider-rank evidence by itself
- **AND** controlled ranking fixtures SHALL show that unrelated generic forms or modules do not outrank a more specific matching object solely because they share common words like `ФормаЭлемента`, `ФормаСписка`, `товар`, or `контрагент`

#### Scenario: Metadata object name influences ranking
- **WHEN** query tokens match a metadata object name encoded in the result path, such as `Контрагенты`, `Склады`, `Пользователи`, `Кассы`, `ЕдиницыИзмерения`, `ОстаткиТоваров`, or `РасходТовара`
- **THEN** the matching object path SHALL receive a bounded deterministic ranking signal independent of the hand-labeled expected prefixes
- **AND** a business term SHALL NOT be mapped to one fixed metadata object unless that object is independently supported by result path, code text, symbol, lexical, semantic, or provider evidence

#### Scenario: Print intent maps to candidate contexts, not fixed paths
- **WHEN** a query contains print-related intent such as `печать`, `печатная форма`, `накладная`, `макет`, or `табличный документ`
- **THEN** the ranking layer SHALL treat commands, forms, reports, object modules, manager modules, common modules, layouts, and code text mentioning print-form concepts as candidate contexts
- **AND** it SHALL NOT assume that print logic must live under one fixed object kind, one fixed metadata object, or one fixed exported configuration path

#### Scenario: Repeated broad chunks do not crowd out specific objects
- **WHEN** multiple high-scoring chunks from the same broad file compete with other files that also have strong semantic or lexical evidence
- **THEN** final top results SHALL apply soft post-fusion duplicate control so the broad file cannot consume most of the top 10 unless its evidence clearly dominates
- **AND** diagnostics SHALL show duplicate penalties or diversity reasons for affected results
- **AND** exact-symbol or provider-backed matches SHALL NOT be removed solely because another chunk from the same file was already selected

#### Scenario: Production search does not use evaluation labels
- **WHEN** `search_code` processes any query
- **THEN** it SHALL NOT inspect query IDs, `expectedPathPrefixes`, or `labelsAreProductionRules` data from `evaluation/retrieval/demo-1c-relevance.json`
- **AND** the relevance dataset SHALL be used only by evaluation and test workflows

#### Scenario: Unknown 1C layouts remain neutral
- **WHEN** a result path does not match the known exported 1C path patterns or comes from a customized layout
- **THEN** the 1C-aware ranking layer SHALL keep layout-specific signals neutral for that result
- **AND** it SHALL NOT penalize the result solely because the path structure is unrecognized

### Requirement: Tuned ranking meets the demo 1C acceptance threshold
The system SHALL improve the live Qdrant default ranking score on the `demo-1c` acceptance set while preserving backend correctness.

#### Scenario: Tuned Qdrant live run exceeds baseline
- **WHEN** `examples/demo-1c` is indexed through the Qdrant default backend with `oneCIndexScopeProfile=developer`
- **AND** the live MCP acceptance runner executes the 30-query dataset
- **THEN** the tuned run SHALL have 0 MCP tool errors
- **AND** it SHALL have 0 missing ColBERT vector errors
- **AND** it SHALL improve Hit@10 over the recorded 18/30 baseline
- **AND** the acceptance runner SHALL exit unsuccessfully if any of those backend correctness conditions fail, unless an explicit non-acceptance override is provided

#### Scenario: Tuned Qdrant live run reaches target threshold
- **WHEN** current dataset labels are confirmed valid for the indexed `examples/demo-1c` fixture
- **THEN** the tuned run SHALL reach the documented post-validation Hit@10 threshold
- **AND** Hit@10 24/30 SHALL be used only when the label-validation report confirms the current 30-query set supports that gate
- **AND** any lower accepted threshold SHALL be documented with the stale, unreachable, intentionally ambiguous, or excluded query IDs that justify it

#### Scenario: Existing successful queries are reported for regression review
- **WHEN** comparing baseline and tuned live reports
- **THEN** the tuned report SHALL list every baseline Hit@10 query that regressed, including previous rank, tuned rank, top paths, and score diagnostics
- **AND** regressions SHALL be reviewed in the final summary before the tuned ranking is accepted
