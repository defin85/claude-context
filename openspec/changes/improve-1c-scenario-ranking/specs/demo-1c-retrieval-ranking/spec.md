## ADDED Requirements

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
