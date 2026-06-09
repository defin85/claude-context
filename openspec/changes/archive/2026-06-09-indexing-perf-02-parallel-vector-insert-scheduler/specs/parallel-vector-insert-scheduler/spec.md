## ADDED Requirements

### Requirement: Bounded Insert Scheduler
The system SHALL schedule vector database writes through a bounded insert scheduler when accelerated indexing is active.

#### Scenario: Insert concurrency is configured
- **WHEN** accelerated indexing has multiple embedded batches ready to write
- **THEN** no more than the configured insert concurrency SHALL execute vector database write operations concurrently

#### Scenario: Insert queue is full
- **WHEN** embedded batches exceed insert scheduler capacity
- **THEN** upstream scheduling SHALL apply backpressure instead of growing an unbounded insert queue

### Requirement: Insert Writes Are Idempotent Or Conservative
Parallel vector writes SHALL preserve document identity and avoid unsafe duplicate writes.

#### Scenario: Upsert is supported
- **WHEN** the active vector database adapter supports idempotent upsert
- **THEN** accelerated insert retries MAY use upsert for the affected batch

#### Scenario: Plain insert failure is ambiguous
- **WHEN** a plain insert operation may have reached the vector database before failing
- **THEN** the system SHALL fail the indexing job rather than retrying the batch as if no write occurred

### Requirement: Insert Status Is Observable
Indexing status SHALL expose insert scheduler state and timing.

#### Scenario: Status is requested during insert backlog
- **WHEN** embedded batches are waiting for vector database writes
- **THEN** accelerator status SHALL include queued insert batches, running insert batches, completed insert batches, failed insert batches, and accumulated insert time

#### Scenario: Benchmark summary is written
- **WHEN** a benchmark run finishes or is stopped
- **THEN** its summary SHALL include insert concurrency, insert time, insert failures, and insert backlog counters

### Requirement: Completion Waits For Inserts
The indexing job SHALL not report success until all scheduled insert operations have settled successfully.

#### Scenario: File scanning is complete but inserts remain
- **WHEN** all files have been scanned and split but insert tasks remain queued or running
- **THEN** indexing status SHALL remain in progress until inserts complete or fail

#### Scenario: Insert task fails
- **WHEN** any insert task fails without safe recovery
- **THEN** the indexing job SHALL fail with the failed insert stage and batch context

## MODIFIED Requirements

### Requirement: Embedding and insert stages are independently bounded
The system SHALL release embedding capacity after model embedding completes and SHALL run vector database insertion through a separate insert scheduler and insert concurrency limit.

#### Scenario: Insert latency does not hold embedding slot
- **WHEN** an embedding batch has completed model embedding and is waiting for vector insertion capacity
- **THEN** the scheduler makes its embedding slot available for another embedding batch while respecting bounded downstream capacity
