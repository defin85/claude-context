# demo-1c-retrieval-ranking Specification

## Purpose
TBD - created by archiving change tune-demo-1c-retrieval-ranking. Update Purpose after archive.
## Requirements
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

### Requirement: Universal 1C evaluation uses a multi-configuration query matrix
The system SHALL provide a committed universal 1C search evaluation dataset that separates reusable query intent from fixture-specific expected paths.

#### Scenario: Universal matrix rows define reusable intent
- **WHEN** the universal 1C evaluation dataset is loaded
- **THEN** each query row SHALL include an identifier, query text, intent, domain, kind, and per-configuration targets
- **AND** query identifiers, domains, intents, and notes SHALL be evaluation metadata only

#### Scenario: Per-configuration applicability is explicit
- **WHEN** a universal query is evaluated for a fixture
- **THEN** the target entry for that fixture SHALL declare `applicable`, `optional`, `not-applicable`, or `needs-inspection`
- **AND** strict acceptance SHALL score only `applicable` targets
- **AND** targets marked `needs-inspection` SHALL fail strict acceptance until source-inspected labels are supplied or the target is marked `not-applicable`

#### Scenario: Universal matrix covers current real fixtures
- **WHEN** the universal matrix is validated
- **THEN** it SHALL include target entries for `examples/demo-do30-1c`, `examples/demo-bp30-1c`, `examples/demo-ut-1c`, and `examples/demo-unf-1c`
- **AND** missing local fixture directories SHALL be reported clearly before live acceptance runs

### Requirement: Universal 1C query set covers portable developer intents
The system SHALL include universal query coverage for broad 1C developer navigation and domain-specific search tasks without requiring every query to apply to every configuration.

#### Scenario: Metadata navigation intents are covered
- **WHEN** the universal matrix is reviewed
- **THEN** it SHALL include positive queries for list forms, item forms, document forms, document commands, reports, data processors, constants, information registers, accumulation registers, and accounting registers where applicable

#### Scenario: Execution-code intents are covered
- **WHEN** the universal matrix is reviewed
- **THEN** it SHALL include positive queries for document posting, before-write validation, fill-on-base behavior, print forms, record-set modules, and exchange-plan registration where applicable

#### Scenario: Shared platform and BSP intents are covered
- **WHEN** the universal matrix is reviewed
- **THEN** it SHALL include positive queries for users, roles, settings storage, attached files, email settings, email sending, full-text search, scheduled jobs, and event-log diagnostics where applicable

#### Scenario: Domain intents are covered
- **WHEN** the universal matrix is reviewed
- **THEN** it SHALL include positive queries for EDI, signatures, MCHD, accounting, VAT, month closing, bank, cash, sales orders, purchase orders, stock balances, prices, inventory, reservations, work orders, production, money movement, and retail scenarios where applicable

### Requirement: Universal matrix labels are validated before scoring
The system SHALL validate every strict and acceptable path prefix for every applicable universal target before using matrix metrics as acceptance evidence.

#### Scenario: Applicable labels are reachable
- **WHEN** label validation runs for a universal matrix fixture target
- **THEN** every strict expected prefix and acceptable prefix for `applicable` targets SHALL match at least one file under the fixture path
- **AND** unreachable prefixes SHALL fail validation with the query ID, fixture name, label kind, and prefix

#### Scenario: Optional labels are reported separately
- **WHEN** label validation runs for `optional` targets
- **THEN** reachable optional labels SHALL be reported
- **AND** optional target failures SHALL NOT count as strict misses unless the target is promoted to `applicable`

#### Scenario: Not-applicable targets are not scored
- **WHEN** scoring runs for a target marked `not-applicable`
- **THEN** that fixture/query pair SHALL be excluded from positive Hit@k denominators
- **AND** the report SHALL preserve the not-applicable reason for audit

### Requirement: Universal evaluation reports grouped quality and regressions
The system SHALL score universal matrix results by fixture, domain, intent, control class, and query ID so portability failures remain visible.

#### Scenario: Positive scoring reports grouped ranking metrics
- **WHEN** saved or live results are scored against the universal matrix
- **THEN** the report SHALL include strict Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, and first strict rank for applicable positive targets
- **AND** it SHALL include acceptable Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, and first acceptable rank when acceptable labels exist
- **AND** it SHALL group metrics by fixture, domain, and intent

#### Scenario: Query-level regressions are visible
- **WHEN** a universal run is compared with a baseline
- **THEN** the comparison SHALL list query-level improvements and regressions by fixture
- **AND** aggregate gains SHALL NOT hide regressions for previously passing fixture/query pairs

#### Scenario: Live reports record backend context
- **WHEN** universal live results are collected
- **THEN** raw JSON, scored JSON, comparison JSON, and Markdown reports SHALL record codebase path, backend label, retrieval mode, ranking profile, index status, latency, MCP tool errors, and missing ColBERT vector errors where available

### Requirement: Universal negative controls prevent generic-term overfitting
The universal evaluation SHALL include negative controls that detect over-ranking caused by broad generic 1C terms.

#### Scenario: Negative-control rows define prohibited behavior
- **WHEN** a negative-control query is loaded
- **THEN** it SHALL declare the broad query, control class, target fixtures, and prohibited over-ranking pattern
- **AND** it SHALL define pass/fail criteria independent from positive strict Hit@k metrics

#### Scenario: Negative-control failures are reported separately
- **WHEN** universal results are scored
- **THEN** negative-control pass/fail counts SHALL be reported separately from positive strict and acceptable hits
- **AND** failed negative controls SHALL list the top paths that violated the prohibited pattern

#### Scenario: Broad generic queries remain broad
- **WHEN** negative-control queries use broad terms such as `форма`, `подпись`, `настройки`, `контрагент`, `почта`, `менеджер`, or `документ`
- **THEN** scoring SHALL detect when an unrelated exact-looking candidate is forced above better-supported broad or semantic results solely by generic-term matching

### Requirement: Universal acceptance preserves existing fixture baselines
The universal evaluation SHALL complement existing single-fixture acceptance workflows without replacing their historical baselines.

#### Scenario: Existing demo evaluations still run
- **WHEN** universal evaluation support is validated
- **THEN** the existing `examples/demo-1c` relevance workflow SHALL still run with its current accepted threshold and backend correctness checks
- **AND** the existing `examples/demo-do30-1c` scenario workflow SHALL still run with its current strict and backend correctness checks

#### Scenario: Universal thresholds are baseline-derived
- **WHEN** universal matrix acceptance thresholds are documented
- **THEN** they SHALL be derived from measured baseline reports
- **AND** guessed aggregate thresholds SHALL NOT be used as hard completion gates before source-inspected labels and baseline artifacts exist

#### Scenario: Multi-fixture acceptance requires portability evidence
- **WHEN** a later ranking change uses the universal matrix as acceptance evidence
- **THEN** it SHALL compare results across at least three of the four configured real fixtures
- **AND** it SHALL report any fixture or domain where quality regressed even if aggregate quality improved

### Requirement: Compound-name holdout evaluation prevents fixture overfitting
The system SHALL provide evaluation coverage that distinguishes generic compound-name ranking improvements from tuning to known `demo-do30-1c` answers.

#### Scenario: Holdout dataset is collected separately
- **WHEN** compound-name ranking is evaluated
- **THEN** the evaluation SHALL include committed holdout coverage separate from the original `demo-do30-1c` 30-query scenario dataset
- **AND** the holdout coverage SHALL either extend the universal 1C matrix or use a universal-matrix-compatible shape with identifier, query text, intent, domain, kind, failure or control class, and per-fixture targets
- **AND** each applicable target SHALL include strict expected path prefixes and optional acceptable path prefixes
- **AND** the dataset SHALL mark labels as evaluation truth only, not production ranking rules

#### Scenario: Holdout includes positive and negative controls
- **WHEN** the holdout dataset is reviewed
- **THEN** it SHALL include positive compound-name queries for forms, constants, modules, commands, document journals, manager modules, and object modules
- **AND** it SHALL include negative controls where shared generic terms must not force an unrelated compound-name candidate to the top
- **AND** negative-control failures SHALL be reported separately from strict positive misses

#### Scenario: Holdout labels are validated before acceptance
- **WHEN** the holdout evaluation is scored
- **THEN** every strict and acceptable path prefix SHALL be checked against the target fixture path manifest
- **AND** unreachable or ambiguous labels SHALL fail the acceptance workflow or be explicitly documented before thresholds are used

### Requirement: Compound-name acceptance preserves tuned baselines
The system SHALL improve compound-name scenario ranking without regressing current accepted 1C evaluation behavior.

#### Scenario: Current demo-do30 tuned baseline is preserved
- **WHEN** the live MCP acceptance runner evaluates `examples/demo-do30-1c`
- **THEN** the tuned run SHALL compare by query ID against the current final tuned baseline with strict Top-1 `21/30`, strict Top-5 `24/30`, and strict Top-10 `24/30`
- **AND** it SHALL have `0` MCP tool errors
- **AND** it SHALL have `0` missing ColBERT vector errors
- **AND** it SHALL report query-level improvements and regressions
- **AND** it SHALL fail acceptance when any previously strict-hit query regresses unless that regression is explicitly accepted in the verification notes with source evidence

#### Scenario: Holdout quality gate is enforced
- **WHEN** the compound-name holdout live evaluation runs
- **THEN** it SHALL record backend label, retrieval mode, ranking profile, index status, raw top results, latency, score output, and comparison output where applicable
- **AND** it SHALL require `0` MCP tool errors
- **AND** it SHALL require `0` missing ColBERT vector errors
- **AND** it SHALL meet holdout strict-positive and negative-control thresholds fixed before the final acceptance run and documented in the change verification

#### Scenario: Universal contour is supporting evidence until targets are inspected
- **WHEN** compound-name ranking is accepted for this change
- **THEN** universal matrix results for configured fixtures with source-inspected applicable targets SHALL be recorded as supporting evidence
- **AND** configured fixture targets still marked `needs-inspection` SHALL NOT be used as hard completion gates for this change
- **AND** any regression in a previously passing configured fixture/query pair SHALL be listed and reviewed before acceptance

#### Scenario: Existing small demo acceptance still runs
- **WHEN** compound-name ranking is validated
- **THEN** the existing `examples/demo-1c` relevance workflow SHALL still run with explicit `rankingProfile=one-c`
- **AND** it SHALL preserve the current accepted threshold and backend correctness checks
- **AND** any small-demo regression SHALL be listed before the change is accepted

### Requirement: Large 1C scenario ranking is evaluated separately from the small demo fixture
The system SHALL provide a committed scenario-level evaluation workflow for the `examples/demo-do30-1c` fixture without merging its quality metrics into the existing small `examples/demo-1c` historical baseline.

#### Scenario: Demo-do30 scenario dataset is collected
- **WHEN** the large 1C scenario evaluation dataset is loaded
- **THEN** it SHALL contain 30 source-inspected queries for `examples/demo-do30-1c`
- **AND** each query SHALL include an identifier, query text, strict expected path prefixes, and optional acceptable alternate path prefixes
- **AND** the dataset SHALL identify ambiguous or neighboring-context cases without making those alternates production ranking rules

#### Scenario: Demo-do30 live results are collected
- **WHEN** the large 1C live evaluation runner executes against an active MCP daemon and the indexed `examples/demo-do30-1c` codebase
- **THEN** it SHALL run every query from the large 1C scenario dataset
- **AND** it SHALL use `rankingProfile=one-c`
- **AND** it SHALL save raw per-query top results with relative paths, line ranges, scores, result metadata, backend label, retrieval mode, ranking profile, index status, and latency where available
- **AND** it SHALL save machine-readable and human-readable reports under `.artifacts/`

#### Scenario: Demo-do30 scoring separates strict and acceptable hits
- **WHEN** saved large 1C live results are scored
- **THEN** the report SHALL include strict Hit@1, strict Hit@3, strict Hit@5, strict Hit@10, strict MRR@10, and per-query first strict relevant rank
- **AND** it SHALL include acceptable Hit@1, acceptable Hit@3, acceptable Hit@5, acceptable Hit@10, acceptable MRR@10, and per-query first acceptable rank when acceptable alternates exist
- **AND** it SHALL show which queries were strict misses but acceptable neighboring-context hits
- **AND** acceptable hits SHALL NOT be counted as strict hits

#### Scenario: Demo-do30 baseline is recorded before tuning
- **WHEN** the current Qdrant default indexed `examples/demo-do30-1c` fixture is evaluated before ranking changes
- **THEN** the baseline report SHALL record the current strict score of Top-1 `14/30` and Top-5 `20/30` or explicitly document any drift from that observed baseline
- **AND** later tuned reports SHALL compare against that baseline by query ID
- **AND** aggregate gains SHALL NOT hide per-query regressions from previously strict-hit queries

### Requirement: Large 1C scenario acceptance gates tuned ranking quality
The system SHALL require improved strict large-fixture quality while preserving existing small-fixture behavior before the scenario-ranking change is accepted.

#### Scenario: Tuned demo-do30 live run reaches strict quality targets
- **WHEN** `examples/demo-do30-1c` is indexed through the Qdrant default backend with BGE-M3 full retrieval
- **AND** the live MCP acceptance runner executes the 30-query large 1C scenario dataset
- **THEN** the tuned run SHALL have `0` MCP tool errors
- **AND** it SHALL have `0` missing ColBERT vector errors
- **AND** it SHALL reach strict Top-1 at least `18/30`
- **AND** it SHALL reach strict Top-5 at least `24/30`
- **AND** the acceptance runner SHALL fail when either strict threshold is not reached

#### Scenario: Existing small demo acceptance does not regress
- **WHEN** tuned ranking is validated for the large 1C scenario change
- **THEN** the existing `examples/demo-1c` relevance workflow SHALL still be executed
- **AND** the tuned run SHALL preserve its current accepted Hit@10 threshold and backend correctness conditions
- **AND** any regression in the existing small demo report SHALL be listed before the change is accepted

#### Scenario: Large scenario labels remain evaluation-only
- **WHEN** production `search_code` processes a query from any codebase
- **THEN** it SHALL NOT inspect large-scenario query IDs, strict expected path prefixes, acceptable path prefixes, failure classes, or dataset notes
- **AND** the large scenario dataset SHALL be used only by evaluation, test, and reporting workflows

### Requirement: Universal matrix expands task-oriented context bundles
The universal 1C evaluation SHALL include source-inspected task scenarios that require multiple result roles instead of a single matching path.

#### Scenario: Task bundle scenario count is expanded
- **WHEN** the universal 1C matrix is reviewed after this change
- **THEN** it SHALL contain at least 8 task-oriented matrix rows with `queryPurpose` set to `task-implementation` and with required result roles on at least one applicable target
- **AND** the preferred target range SHALL be 8-12 task-oriented matrix rows unless source inspection shows that fewer high-quality rows are available
- **AND** each applicable role-bearing target SHALL document enough fixture-specific path evidence to validate its role labels

#### Scenario: Primary fixtures receive role coverage
- **WHEN** role-based scenarios are assigned to the primary demo fixtures
- **THEN** each primary configuration fixture (`demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c`) SHALL have at least 2 role-based applicable targets where source-inspected labels are available
- **AND** the implementation SHOULD target 2-3 role-based applicable targets per primary fixture before increasing breadth elsewhere
- **AND** fixtures without a relevant subsystem SHALL mark the target `not-applicable` with an audit reason rather than carrying empty or guessed labels

#### Scenario: Role bundles represent implementation context
- **WHEN** a task-oriented target declares `requiredResultRoles`
- **THEN** the required roles SHALL include the applicable subset of library API, client usage, server usage, applied example, and metadata
- **AND** at least one applied-usage role SHALL be required when the fixture contains a real configuration-level example
- **AND** optional roles SHALL be marked explicitly and SHALL NOT be counted as required bundle completion

### Requirement: Universal matrix classifies query purpose
The universal 1C matrix SHALL classify rows by query purpose so coverage can be audited by how a search is intended to be used.

#### Scenario: Query purpose is explicit
- **WHEN** a universal matrix row is loaded
- **THEN** it SHALL expose a machine-readable `queryPurpose` classification
- **AND** supported `queryPurpose` values SHALL be `navigation`, `task-implementation`, `negative-control`, `library-oriented`, and `applied-usage`
- **AND** the purpose SHALL remain evaluation metadata only

#### Scenario: Purpose coverage is reported
- **WHEN** matrix validation or scoring summarizes the universal dataset
- **THEN** the report SHALL include counts grouped by query purpose
- **AND** the report SHALL make missing or unknown purpose values visible

### Requirement: Universal reports summarize missing result roles
The universal scoring report SHALL aggregate missing required result roles across a run so incomplete task-context bundles are visible beyond per-query rows.

#### Scenario: Missing roles are aggregated
- **WHEN** live or saved universal results are scored
- **THEN** the scored JSON SHALL include `bundleRoles.missingRequiredRolesById`, grouped by role identifier
- **AND** the Markdown report SHALL include a missing-required-role aggregate section derived from that grouped summary
- **AND** they SHALL include enough query and fixture context to identify where each role failed
- **AND** ordinary strict Hit@k metrics SHALL remain unchanged

#### Scenario: Bundle incompleteness remains visible in aggregate summaries
- **WHEN** a run has strong aggregate Hit@k but incomplete required result roles
- **THEN** the report SHALL still show incomplete bundle counts and missing-role summaries
- **AND** a complete strict hit SHALL NOT suppress reporting of a missing required role for the same query

### Requirement: Universal matrix has repeatable live-quality checks
The universal 1C evaluation SHALL provide a repeatable workflow for checking actual semantic-search output against the matrix.

#### Scenario: Live check command is documented
- **WHEN** maintainers review the 1C matrix documentation
- **THEN** it SHALL describe how to run live semantic-search checks for selected fixtures
- **AND** it SHALL identify the expected output artifacts for raw results, scored JSON, Markdown summary, and label validation

#### Scenario: Live check records retrieval context
- **WHEN** a live matrix check is executed
- **THEN** the artifacts SHALL record fixture, codebase path, backend label, retrieval mode, ranking profile, index status, and run timestamps
- **AND** the artifacts SHALL distinguish dense-only BGE-M3 runs from full BGE-M3 dense+sparse+ColBERT runs when that metadata is available

#### Scenario: Live evidence is not a production hint
- **WHEN** production `search_code` handles user queries
- **THEN** it SHALL NOT read query purpose, required result roles, expected path prefixes, or live-evaluation artifacts
- **AND** those labels and artifacts SHALL be used only by evaluation, tests, and documentation

### Requirement: Universal matrix validates runbook-style context bundles
The universal 1C evaluation SHALL support search cases where a useful LLM context requires multiple result roles rather than one expected path.

#### Scenario: Bundle rows declare required result roles
- **WHEN** a universal matrix query represents an implementation task that needs multiple contexts
- **THEN** the matrix target SHALL be able to declare required result roles such as API module, client module, server module, applied example, and related metadata
- **AND** each role SHALL map to one or more strict or acceptable path prefixes for that fixture
- **AND** role labels SHALL remain evaluation truth only and SHALL NOT be used by production `search_code`

#### Scenario: Bundle scoring reports missing roles
- **WHEN** live or saved universal results are scored for a bundle-oriented query
- **THEN** the report SHALL show which required roles were found within the configured top-k window
- **AND** it SHALL list missing roles separately from ordinary strict path misses
- **AND** aggregate Hit@k metrics SHALL NOT hide that a task-oriented context bundle is incomplete

#### Scenario: Long-running operations bundle is covered
- **WHEN** the universal matrix is reviewed for 1C library-oriented developer tasks
- **THEN** it SHALL include a long-running operations query applicable to configurations that contain the BSP long-running operations subsystem
- **AND** the query SHALL require context for the BSP server API, client waiting or progress handling, server completion checks, and at least one applied usage example where available
- **AND** the expected paths SHALL be source-inspected for `demo-bp30-1c` before the row is used as strict acceptance evidence

