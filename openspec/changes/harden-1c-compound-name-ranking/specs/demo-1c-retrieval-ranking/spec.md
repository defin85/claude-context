## ADDED Requirements

### Requirement: Compound-name holdout evaluation prevents fixture overfitting
The system SHALL provide evaluation coverage that distinguishes generic compound-name ranking improvements from tuning to known `demo-do30-1c` answers.

#### Scenario: Holdout dataset is collected separately
- **WHEN** compound-name ranking is evaluated
- **THEN** the evaluation SHALL include a committed holdout dataset separate from the original `demo-do30-1c` 30-query scenario dataset
- **AND** each holdout query SHALL include an identifier, query text, strict expected path prefixes, optional acceptable path prefixes, and a failure or control class
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
- **AND** it SHALL meet the holdout strict and negative-control thresholds documented in the change verification

#### Scenario: Existing small demo acceptance still runs
- **WHEN** compound-name ranking is validated
- **THEN** the existing `examples/demo-1c` relevance workflow SHALL still run with explicit `rankingProfile=one-c`
- **AND** it SHALL preserve the current accepted threshold and backend correctness checks
- **AND** any small-demo regression SHALL be listed before the change is accepted
