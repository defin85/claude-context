## ADDED Requirements

### Requirement: Production ranking remains independent from universal evaluation labels
The production retrieval and ranking pipeline SHALL NOT use universal 1C evaluation metadata as routing, filtering, boosting, or ranking input.

#### Scenario: Universal query metadata is evaluation-only
- **WHEN** `search_code` processes any query
- **THEN** it SHALL NOT inspect universal query IDs, domains, intents, target statuses, expected path prefixes, acceptable path prefixes, notes, or negative-control labels
- **AND** those fields SHALL be loaded only by evaluation, validation, and reporting workflows

#### Scenario: Fixture identity does not select production weights
- **WHEN** `search_code` ranks results for `rankingProfile=one-c`
- **THEN** it SHALL NOT choose production ranking weights based on fixture names such as `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, or `demo-unf-1c`
- **AND** ranking signals SHALL remain based on query text, path shape, metadata kind, code content, lexical evidence, semantic evidence, symbol/provider evidence, and score diagnostics

#### Scenario: Universal acceptance does not require reindexing
- **WHEN** universal evaluation support is added
- **THEN** existing indexed collections SHALL remain searchable without reindexing
- **AND** any later ranking-only changes validated by the universal matrix SHALL document when reindexing is not required

### Requirement: One-C ranking changes are evaluated for portability
Future `one-c` ranking changes SHALL be validated against generic 1C intent behavior across multiple configurations when they claim cross-configuration quality improvements.

#### Scenario: Generic 1C intent evidence is required
- **WHEN** a ranking change boosts a 1C object kind, metadata name, module kind, form kind, command kind, or domain intent
- **THEN** the change SHALL include evidence that the signal is based on generic query, path, content, semantic, lexical, symbol, provider, or score evidence
- **AND** it SHALL NOT rely on a single fixture's expected answer paths as production behavior

#### Scenario: Multi-configuration regressions are reviewed
- **WHEN** a ranking change is evaluated with the universal matrix
- **THEN** the report SHALL show per-fixture and per-domain regressions
- **AND** regressions in one fixture SHALL be reviewed explicitly before aggregate gains are accepted

#### Scenario: Negative-control behavior protects broad search
- **WHEN** a ranking change increases exact-looking metadata-name, object-kind, form-kind, or module-kind support
- **THEN** universal negative controls SHALL verify that broad conceptual queries still keep better-supported broad or semantic results eligible
- **AND** exact-symbol or provider-backed results SHALL NOT be suppressed solely to satisfy a universal positive label
