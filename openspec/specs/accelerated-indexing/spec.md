# accelerated-indexing Specification

## Purpose
Define resource-aware acceleration for initial and force indexing, including bounded batch scheduling, BGE-M3 worker pool behavior, fallback safety, and operational visibility.
## Requirements
### Requirement: Accelerated indexing scope
The system SHALL support acceleration for initial and force indexing jobs while keeping background sync and incremental reindexing conservative by default.

#### Scenario: Initial indexing can use acceleration
- **WHEN** a user starts `index_codebase` for a codebase that is not indexed and acceleration is enabled
- **THEN** the indexing job may use accelerated batch scheduling and eligible BGE-M3 workers

#### Scenario: Force indexing can use acceleration
- **WHEN** a user starts `index_codebase` with `force=true` and acceleration is enabled
- **THEN** the indexing job may use accelerated batch scheduling and eligible BGE-M3 workers

#### Scenario: Background sync remains conservative
- **WHEN** daemon background sync reindexes changed files
- **THEN** the system SHALL use conservative single-worker behavior unless background-sync acceleration is explicitly enabled

### Requirement: Bounded batch parallelism
The system SHALL provide bounded intra-codebase chunk batch parallelism without changing generated document identifiers or retrieval metadata.

#### Scenario: Multiple batches are in flight
- **WHEN** an accelerated indexing job has more ready chunk batches than the configured embedding concurrency
- **THEN** the system SHALL process no more than the configured number of embedding batches concurrently

#### Scenario: Batch order changes
- **WHEN** chunk batches complete in a different order than they were created
- **THEN** inserted documents SHALL retain stable IDs based on relative path, line range, and content

#### Scenario: Concurrency disabled
- **WHEN** embedding concurrency is configured as `1` or acceleration is off
- **THEN** batch processing SHALL behave like the existing sequential pipeline

### Requirement: Adaptive BGE-M3 worker pool
The system SHALL optionally use multiple equivalent BGE-M3 sidecar workers for BGE-M3 full indexing when resource and health checks pass.

#### Scenario: Worker metadata matches
- **WHEN** an additional BGE-M3 worker reports the same model, mode, outputs, dimension, and embedding profile as the primary worker
- **THEN** the system MAY schedule embedding batches to that worker

#### Scenario: Worker metadata differs
- **WHEN** an additional BGE-M3 worker reports different model, mode, outputs, dimension, or embedding profile metadata
- **THEN** the system SHALL reject that worker and SHALL NOT schedule batches to it

#### Scenario: VRAM budget would be exceeded
- **WHEN** starting another worker would exceed the configured VRAM budget
- **THEN** the system SHALL stop launching additional workers and continue with the healthy worker set

#### Scenario: Managed workers start on demand
- **WHEN** managed extra BGE-M3 workers are configured and no eligible interactive indexing job is running
- **THEN** the daemon SHALL expose their planned loopback endpoints without starting the heavy sidecar processes

#### Scenario: Indexing workload becomes idle
- **WHEN** all interactive indexing jobs have completed, failed, or been cancelled and no indexing jobs remain queued
- **THEN** the daemon SHALL retire managed extra BGE-M3 workers after a short debounce

#### Scenario: Lifecycle event is missed
- **WHEN** managed extra workers remain running after the indexing workload has become idle
- **THEN** the daemon SHALL use the configured idle timeout as a fallback retirement mechanism

### Requirement: Safe fallback and retry
The system SHALL preserve indexing progress safety when accelerated workers fail.

#### Scenario: Worker fails during a batch
- **WHEN** a worker returns a transport error, server error, or exits while processing a batch
- **THEN** the system SHALL mark the worker unhealthy and retry the affected batch on a healthy worker when retry policy allows

#### Scenario: Insert failure is ambiguous
- **WHEN** a batch write may have reached Milvus but the write result is unknown
- **THEN** the system SHALL NOT blindly retry with plain insert semantics and SHALL either use idempotent upsert semantics or fail the indexing job with an explicit ambiguous-write error

#### Scenario: All additional workers fail
- **WHEN** all additional accelerated workers become unhealthy
- **THEN** the indexing job SHALL continue on the primary worker when possible

#### Scenario: Retry budget is exhausted
- **WHEN** a batch fails beyond the configured retry budget
- **THEN** the indexing job SHALL fail with an error that identifies the failed batch stage and worker context without exposing secrets

### Requirement: Resource policy
The system SHALL enforce configurable resource limits for accelerated BGE-M3 indexing.

#### Scenario: Default VRAM ceiling
- **WHEN** BGE-M3 acceleration runs in auto mode
- **THEN** the system SHALL enforce the configured VRAM ceiling before adding extra workers

#### Scenario: Host cannot report VRAM
- **WHEN** VRAM usage cannot be measured
- **THEN** the system SHALL avoid launching additional local BGE-M3 workers unless explicitly configured to do so

#### Scenario: Runtime pressure increases
- **WHEN** resource usage rises above the configured ceiling during indexing
- **THEN** the system SHALL reduce scheduling to additional workers or retire them when safe

### Requirement: Equivalent embedding profile
The system SHALL only combine BGE-M3 worker outputs that share the same embedding profile.

#### Scenario: Worker profile is validated
- **WHEN** a BGE-M3 worker is considered for the accelerated pool
- **THEN** the system SHALL validate model name, model revision when available, mode, output types, dense dimension, precision setting, max token policy, and preprocessing profile before scheduling batches to that worker

#### Scenario: Worker profile is incomplete
- **WHEN** a worker cannot report enough metadata to prove profile equivalence
- **THEN** the system SHALL reject the worker unless strict validation is explicitly disabled

### Requirement: Operational visibility
The system SHALL expose accelerator state in daemon status and indexing status.

#### Scenario: Daemon status includes accelerator state
- **WHEN** `get_daemon_status` is called during an accelerated indexing run
- **THEN** the response SHALL include configured accelerator mode, active worker count, rejected worker count, and in-flight embedding and insert batch counts

#### Scenario: Indexing status includes accelerator progress
- **WHEN** `get_indexing_status` is called during an accelerated indexing run
- **THEN** the response SHALL include whether acceleration is active and enough batch progress information to distinguish scanning, embedding, and insertion bottlenecks

#### Scenario: Acceleration falls back
- **WHEN** an accelerated run falls back to conservative execution
- **THEN** indexing status SHALL report the fallback reason
