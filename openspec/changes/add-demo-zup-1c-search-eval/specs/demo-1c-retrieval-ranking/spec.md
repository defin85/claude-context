## ADDED Requirements

### Requirement: Universal 1C matrix supports a ZUP fixture
The system SHALL include `demo-zup-1c` as a first-class fixture in the universal 1C search matrix.

#### Scenario: ZUP fixture metadata is present
- **WHEN** the universal 1C matrix is loaded
- **THEN** its fixtures SHALL include `demo-zup-1c`
- **AND** the fixture SHALL point to `examples/demo-zup-1c`
- **AND** the fixture label SHALL identify it as a ZUP or HR/payroll configuration

#### Scenario: Existing universal rows are classified for ZUP
- **WHEN** a universal matrix query has a ZUP target
- **THEN** the target SHALL declare `applicable`, `not-applicable`, `optional`, or `needs-inspection`
- **AND** every `not-applicable` ZUP target SHALL include a short reason
- **AND** every `applicable` ZUP target SHALL include strict expected path prefixes unless it is a negative control

#### Scenario: ZUP labels validate against the source export
- **WHEN** label validation runs for `demo-zup-1c`
- **THEN** every strict and acceptable ZUP path prefix SHALL match at least one path under `examples/demo-zup-1c`
- **AND** unreachable ZUP prefixes SHALL fail validation before acceptance thresholds are used

### Requirement: ZUP evaluation covers HR and payroll scenarios
The universal 1C matrix SHALL include ZUP-specific positive queries that exercise HR and payroll business surfaces.

#### Scenario: Payroll document scenarios are present
- **WHEN** the universal matrix is reviewed for ZUP coverage
- **THEN** it SHALL include positive scenarios for salary accrual and payroll payment statements
- **AND** those scenarios SHALL target source-backed ZUP documents, document journals, common modules, or forms

#### Scenario: HR order scenarios are present
- **WHEN** the universal matrix is reviewed for ZUP coverage
- **THEN** it SHALL include positive scenarios for hiring, HR transfer, and dismissal
- **AND** those scenarios SHALL target source-backed ZUP document or module paths

#### Scenario: Leave, sick leave, and time tracking scenarios are present
- **WHEN** the universal matrix is reviewed for ZUP coverage
- **THEN** it SHALL include positive scenarios for leave, leave balances, sick leave, and time sheet workflows
- **AND** those scenarios SHALL target source-backed ZUP document, business process, register, report, or module paths

#### Scenario: Payroll reporting and statutory workflows are present
- **WHEN** the universal matrix is reviewed for ZUP coverage
- **THEN** it SHALL include positive scenarios for NDFL, insurance contributions, SEDO/FSS, and military accounting
- **AND** those scenarios SHALL target source-backed ZUP paths

### Requirement: ZUP negative controls are reported separately
The system SHALL evaluate broad ZUP-domain negative controls separately from strict positive misses.

#### Scenario: Broad HR and payroll terms do not become positive hits
- **WHEN** a ZUP negative-control query contains broad terms such as employee, accrual, document, report, leave, or setting
- **THEN** the scorer SHALL check prohibited path prefixes for that query
- **AND** negative-control failures SHALL be reported separately from positive strict misses

#### Scenario: Negative-control reports include top paths
- **WHEN** a ZUP live or saved-results report is written
- **THEN** the report SHALL include per-query top paths for negative controls
- **AND** it SHALL list any prohibited-prefix violations

### Requirement: ZUP live evaluation is reproducible
The system SHALL provide a reproducible live MCP evaluation path for `examples/demo-zup-1c`.

#### Scenario: ZUP live report records runtime context
- **WHEN** the ZUP live evaluation runner executes
- **THEN** it SHALL record the backend label, retrieval mode, ranking profile, codebase path, index status, raw top results, summary metrics, label validation, and negative-control summary
- **AND** it SHALL record MCP tool error and missing ColBERT vector counts when available

#### Scenario: ZUP acceptance does not require reindexing existing fixtures
- **WHEN** ZUP evaluation support is added
- **THEN** existing `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c` indexes SHALL remain valid
- **AND** only `examples/demo-zup-1c` SHALL need its own index before live ZUP acceptance can run

#### Scenario: ZUP baseline can be compared by query
- **WHEN** a ZUP baseline report is supplied to the scorer
- **THEN** the comparison SHALL match rows by fixture-aware query id
- **AND** it SHALL report query-level improvements and regressions
