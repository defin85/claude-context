# preindex-traversal-performance Specification

## Purpose
TBD - created by archiving change optimize-preindex-traversal-engine. Update Purpose after archive.
## Requirements
### Requirement: Optimized traversal preserves indexed files
The optimized pre-index traversal engine MUST select the same files, in the same order, and compute the same file hashes as the baseline TypeScript traversal for the same effective configuration.

#### Scenario: Selected files match baseline
- **WHEN** optimized traversal runs on a codebase with the same ignore patterns and supported extensions as the baseline traversal
- **THEN** the optimized traversal reports the same ordered selected-path fingerprint and selected-file count as the baseline traversal

#### Scenario: Hashes match baseline
- **WHEN** optimized traversal hashes selected files
- **THEN** each selected path has the same content hash as the baseline traversal for that path

### Requirement: Traversal wall time is reduced
The system SHALL reduce pre-index traversal wall time on the large 1C acceptance repository compared with the profiled baseline from `profile-preindex-traversal-hotspots`.

#### Scenario: Large 1C repository benchmark improves
- **WHEN** the optimized traversal benchmark is run against `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` under the same effective indexing configuration as the baseline
- **THEN** median pre-index traversal wall time across comparable runs is at least 25 percent lower than the recorded baseline while preserving selected paths and hashes

### Requirement: Ignore semantics are preserved
The optimized traversal engine MUST preserve existing ignore semantics, including directory ignores, file ignores, root-anchored patterns, glob patterns, hidden paths, and supported negation behavior.

#### Scenario: Ignore pattern compatibility
- **WHEN** optimized traversal is run against fixture repositories covering directory ignores, file ignores, anchored patterns, glob patterns, hidden paths, and negated patterns
- **THEN** the selected paths match the baseline TypeScript traversal for every fixture

### Requirement: Traversal engine selection is explicit
The system SHALL report which traversal engine was used and SHALL provide a safe TypeScript fallback if a native engine is unavailable or fails.

#### Scenario: Engine is reported
- **WHEN** pre-index traversal completes
- **THEN** diagnostics or logs identify the traversal engine used for the run

#### Scenario: Native fallback is safe
- **WHEN** native traversal is selected in automatic mode but the native helper is unavailable or returns an error
- **THEN** the system falls back to TypeScript traversal and reports the fallback without changing indexing behavior

### Requirement: Optimization does not change downstream indexing
Traversal optimization MUST NOT change embedding inputs, vector database collection schemas, search behavior, or existing indexed collection migration requirements.

#### Scenario: Existing collections require no migration
- **WHEN** optimized traversal is enabled for a codebase that already has an indexed collection
- **THEN** no collection schema migration is required and unchanged selected files are treated as unchanged by the normal indexing pipeline

