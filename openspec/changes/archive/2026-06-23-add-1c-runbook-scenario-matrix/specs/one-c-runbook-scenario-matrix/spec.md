## ADDED Requirements

### Requirement: Runbook scenario matrix models multi-search 1C context gathering
The system SHALL provide a committed 1C runbook scenario matrix that represents multi-step implementation-context gathering independently from single-query retrieval evaluation.

#### Scenario: Scenario rows define implementation tasks
- **WHEN** the runbook scenario matrix is loaded
- **THEN** each scenario SHALL include a stable identifier, user task text, domain, fixture targets, and required context roles
- **AND** scenario identifiers, domains, role labels, and notes SHALL be evaluation metadata only

#### Scenario: Scenario matrix is separate from universal query matrix
- **WHEN** maintainers review 1C evaluation datasets
- **THEN** the runbook scenario matrix SHALL be stored separately from `evaluation/retrieval/universal-1c-search-matrix.json`
- **AND** the universal matrix SHALL remain usable for single-query ranking checks without running scenario workflows

#### Scenario: Source-inspected fixture targets are explicit
- **WHEN** a scenario applies to a fixture
- **THEN** that fixture target SHALL declare source-inspected expected path prefixes by required role
- **AND** missing or unsupported fixture coverage SHALL be marked explicitly rather than represented by empty expected labels

#### Scenario: Fixture applicability values are explicit
- **WHEN** scenario fixture targets are validated
- **THEN** each fixture target SHALL use one of `applicable`, `optional`, `not-applicable`, or `needs-inspection`
- **AND** targets marked `needs-inspection` SHALL fail strict scenario validation until source-inspected labels are supplied or the target is marked `not-applicable`

#### Scenario: Initial scenario coverage is bounded
- **WHEN** the initial runbook scenario matrix is reviewed
- **THEN** it SHALL include at least 5 source-inspected implementation scenarios
- **AND** it SHALL NOT require more than 8 initial scenarios before the first baseline evidence exists

### Requirement: Runbook scenario evaluation scores context-bundle completion
The system SHALL score scenario runs by whether the runbook workflow collected the required context roles for each applicable fixture.

#### Scenario: Bundle completion is reported
- **WHEN** saved or live scenario results are scored
- **THEN** the scored report SHALL include bundle completeness by scenario and fixture
- **AND** it SHALL include missing roles by scenario, fixture, and role identifier
- **AND** it SHALL aggregate missing-role counts across the whole run

#### Scenario: Broad-query baseline is preserved
- **WHEN** a scenario run starts with the user task as written
- **THEN** the report SHALL record which required roles were found by the first broad search
- **AND** final workflow completeness SHALL be reported separately from first-query completeness

#### Scenario: Workflow gain is visible
- **WHEN** focused role searches find roles that the first broad query missed
- **THEN** the report SHALL show the workflow gain between first-query role coverage and final role coverage
- **AND** strong first-query Hit@k SHALL NOT hide incomplete bundle coverage

### Requirement: Runbook scenario runner executes role-focused searches without changing production search
The system SHALL provide an evaluation runner that can execute role-focused searches for scenario roles while keeping production `search_code` behavior unchanged.

#### Scenario: Runner uses existing search interfaces
- **WHEN** a live scenario run is executed
- **THEN** it SHALL call the existing MCP search flow for the target fixture
- **AND** it SHALL save raw per-search results, query text, role intent, latency where available, and result metadata under `.artifacts/`

#### Scenario: Role-focused searches are evaluation artifacts
- **WHEN** focused query text or role hints are generated for a scenario
- **THEN** they SHALL be stored only as optional evaluation hints or run artifacts
- **AND** exact focused query wording SHALL NOT be required for scenario success
- **AND** production `search_code` SHALL NOT read scenario role labels, expected path prefixes, or generated query text

#### Scenario: Search budget is bounded
- **WHEN** a scenario run executes focused searches
- **THEN** the runner SHALL enforce a configurable maximum number of searches per scenario
- **AND** reports SHALL record searches-to-complete or searches attempted when the bundle remains incomplete

#### Scenario: Result depth is recorded
- **WHEN** a scenario search requests a result limit
- **THEN** reports SHALL record the requested result limit and the effective number of returned results for each search
- **AND** scoring SHALL use the effective returned results rather than assuming that the requested limit was honored

### Requirement: Runbook scenario validation prevents stale labels
The system SHALL validate scenario labels before using scenario metrics as acceptance evidence.

#### Scenario: Required role labels are reachable
- **WHEN** scenario matrix validation runs for a fixture
- **THEN** every required path prefix for applicable targets SHALL match at least one file under the fixture path
- **AND** unreachable prefixes SHALL fail validation with scenario ID, fixture name, role ID, and prefix

#### Scenario: Optional roles are reported separately
- **WHEN** a scenario target declares optional roles
- **THEN** reachable optional role labels SHALL be reported
- **AND** missing optional roles SHALL NOT count as required bundle failures

#### Scenario: Non-applicable targets are not scored
- **WHEN** a scenario target is marked not applicable for a fixture
- **THEN** that fixture/scenario pair SHALL be excluded from bundle-completion denominators
- **AND** the non-applicable reason SHALL be preserved in validation and scoring output

### Requirement: Runbook scenario reports preserve retrieval context
The system SHALL record enough backend and retrieval context to compare scenario runs safely.

#### Scenario: Live reports include backend context
- **WHEN** a live scenario run is saved
- **THEN** the report SHALL record fixture, codebase path, backend label, retrieval mode, ranking profile, index status, timestamps, MCP tool errors, and missing ColBERT vector errors where available

#### Scenario: Dense-only and full BGE-M3 runs are distinguished
- **WHEN** scenario reports describe BGE-M3 retrieval
- **THEN** they SHALL distinguish dense-only BGE-M3 from full BGE-M3 dense+sparse+ColBERT retrieval when that metadata is available
- **AND** reports SHALL NOT compare those modes as equivalent without explicitly showing the retrieval mode

#### Scenario: Scenario matrix does not create indexed-data migration
- **WHEN** this capability is implemented
- **THEN** existing indexed collections SHALL NOT require migration or rebuild solely because the scenario matrix exists
- **AND** scenario evaluation labels SHALL remain outside indexed production data
