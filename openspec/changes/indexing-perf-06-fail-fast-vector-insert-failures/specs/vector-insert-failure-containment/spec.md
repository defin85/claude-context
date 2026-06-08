## ADDED Requirements

### Requirement: Insert Failure Stops Queued Scheduler Work
The system SHALL stop starting new scheduled embedding or vector insert work after the first insert-stage failure in an accelerated indexing run.

#### Scenario: Insert failure occurs while insert work is queued
- **WHEN** an accelerated indexing run has queued insert batches and one running insert batch fails
- **THEN** the scheduler SHALL reject queued insert batches without starting their vector database write operations

#### Scenario: Insert failure occurs while embedding work is queued
- **WHEN** an accelerated indexing run has queued embedding batches and one insert batch fails
- **THEN** the scheduler SHALL reject queued embedding batches without starting their embedding operations

### Requirement: Insert Failure Waits For Running Inserts
The system SHALL wait for already running insert operations to settle before returning the failed indexing result.

#### Scenario: Another insert is already running
- **WHEN** one insert batch fails while another insert batch is already running
- **THEN** the indexing job SHALL remain pending until the already running insert batch resolves or rejects

#### Scenario: Running insert settles after first failure
- **WHEN** already running insert work settles after the first insert failure
- **THEN** the indexing job SHALL fail with the first insert-stage error and batch context

### Requirement: Insert Failure Does Not Hide Partial Write Semantics
The system SHALL treat fail-fast insert containment as bounded partial-write mitigation rather than transactional rollback.

#### Scenario: In-flight vector database request cannot be cancelled
- **WHEN** an insert request has already been sent to the vector database adapter
- **THEN** the scheduler SHALL NOT report that the request was rolled back or prevented from reaching the vector database

#### Scenario: Failed run is reported to callers
- **WHEN** insert failure containment completes
- **THEN** callers SHALL receive a failed indexing result instead of a successful or partially successful indexing result
