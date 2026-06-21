## ADDED Requirements

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
