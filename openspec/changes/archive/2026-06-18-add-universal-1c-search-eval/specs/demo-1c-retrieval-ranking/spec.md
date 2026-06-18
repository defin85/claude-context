## ADDED Requirements

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
