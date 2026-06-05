# preindex-traversal-observability Specification

## Purpose
TBD - created by archiving change profile-preindex-traversal-hotspots. Update Purpose after archive.
## Requirements
### Requirement: Structured traversal diagnostics
The system SHALL produce structured diagnostics for the pre-index traversal pass when diagnostics are enabled.

#### Scenario: Diagnostics include traversal counters
- **WHEN** pre-index traversal diagnostics are enabled for an indexing run
- **THEN** the diagnostic output includes directory entries visited, files seen, unsupported files by extension, ignored directories, ignored files, selected files, hashed files, hash bytes, effective concurrency, and elapsed timing fields

#### Scenario: Unsupported entries are visible
- **WHEN** a repository contains unsupported file extensions that are not selected for indexing
- **THEN** the diagnostic output counts those files by normalized extension without changing whether they are indexed

### Requirement: Benchmark uses effective indexing configuration
The system SHALL provide a diagnostic benchmark path that can use the same effective ignore patterns, supported extensions, and traversal settings as normal indexing for a target codebase path.

#### Scenario: Benchmark matches normal selection
- **WHEN** the benchmark is run with effective indexing configuration for a codebase path
- **THEN** it reports the same selected-file count and selected-path fingerprint as normal pre-index traversal for that path

#### Scenario: Concurrency comparisons are repeatable
- **WHEN** the benchmark is run for multiple traversal concurrency values
- **THEN** each result records the requested concurrency, effective concurrency, elapsed timings, selected-file count, and selected-path fingerprint

### Requirement: Diagnostics preserve traversal behavior
Diagnostic collection MUST NOT change the selected file set, selected file order, file hashes, embedding work, or vector database writes.

#### Scenario: Diagnostics are behavior-neutral
- **WHEN** the same codebase is indexed once with diagnostics disabled and once with diagnostics enabled
- **THEN** both runs select the same ordered paths and compute the same file hashes for those paths

### Requirement: Diagnostics are machine-readable
The system SHALL expose pre-index traversal diagnostics in a machine-readable JSON or NDJSON format.

#### Scenario: Diagnostic output can be compared
- **WHEN** a diagnostic benchmark run completes
- **THEN** the output can be parsed as JSON or NDJSON and contains enough fields to compare elapsed time, scan time, matcher work, hash work, selected-file count, and unsupported-file counts across runs

