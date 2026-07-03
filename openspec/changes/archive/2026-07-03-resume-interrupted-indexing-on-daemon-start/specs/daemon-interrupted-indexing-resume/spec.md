## ADDED Requirements

### Requirement: Daemon startup resumes interrupted indexing

When the daemon starts, it SHALL automatically enqueue safe resume attempts for indexing jobs that were interrupted by daemon shutdown or abandoned stale ownership.

#### Scenario: Shutdown-interrupted job is queued

- **WHEN** daemon startup sees a tracked codebase in `indexfailed`
- **AND** the failure message is the daemon shutdown interruption message
- **AND** the codebase path exists, is allowed, and has persisted per-codebase configuration
- **THEN** the daemon SHALL call the normal indexing request path for that codebase
- **AND** the request SHALL use `force=false`

#### Scenario: Stale-owner interruption is queued

- **WHEN** daemon startup sees a tracked codebase in `indexfailed`
- **AND** the failure message says indexing was interrupted or abandoned because previous ownership was stale
- **AND** the codebase path exists, is allowed, and has persisted per-codebase configuration
- **THEN** the daemon SHALL enqueue the normal indexing request path for that codebase

#### Scenario: Ordinary indexing failure is not retried

- **WHEN** daemon startup sees a tracked codebase in `indexfailed`
- **AND** the failure message is an indexing, embedding, configuration, collection, or manifest compatibility error rather than a daemon interruption
- **THEN** the daemon SHALL NOT automatically retry that codebase

### Requirement: Startup resume preserves codebase configuration

Startup resume SHALL use the persisted per-codebase session configuration instead of daemon defaults.

#### Scenario: Persisted settings are applied

- **WHEN** startup resume queues a codebase
- **AND** the persisted configuration includes custom extensions, ignore patterns, retrieval profile, or 1C scope profile
- **THEN** those settings SHALL be included in the normal indexing request

#### Scenario: Missing persisted configuration skips resume

- **WHEN** startup resume finds an interrupted codebase without persisted per-codebase configuration
- **THEN** the daemon SHALL skip automatic resume for that codebase
- **AND** it SHALL report that manual reindexing is required

### Requirement: Startup resume remains fail-closed

Startup resume SHALL not bypass access policy, manifest compatibility, ownership checks, or normal queue limits.

#### Scenario: Disallowed or missing path is skipped

- **WHEN** startup resume finds an interrupted codebase
- **AND** the path is outside the daemon allowlist or no longer exists
- **THEN** the daemon SHALL skip automatic resume for that codebase

#### Scenario: Compatible manifest decision stays in indexing path

- **WHEN** startup resume queues an interrupted codebase
- **THEN** manifest compatibility SHALL be decided by the existing indexing planner
- **AND** incompatible state SHALL remain a visible failure instead of triggering automatic force reindexing

#### Scenario: Duplicate startup work is not queued

- **WHEN** startup resume finds an interrupted codebase
- **AND** indexing work for the same codebase is already active or queued
- **THEN** the daemon SHALL skip the duplicate startup resume attempt

### Requirement: Startup resume is observable

The daemon SHALL report startup resume outcomes.

#### Scenario: Outcomes are logged

- **WHEN** daemon startup recovery runs
- **THEN** the daemon SHALL log the number of candidates and each queued, skipped, or failed attempt with a reason

#### Scenario: Daemon remains available after candidate error

- **WHEN** one startup resume candidate fails validation or queueing
- **THEN** the daemon SHALL continue startup and process remaining candidates

