## ADDED Requirements

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
