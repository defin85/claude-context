## ADDED Requirements

### Requirement: Payload-Safe Logical Batch Identity
The scheduler SHALL preserve logical batch identity when an embedding provider call is split into payload-safe sub-batches.

#### Scenario: Provider sub-batches complete
- **WHEN** one logical embedding batch is embedded through multiple provider sub-batches
- **THEN** scheduler progress SHALL continue to report the original logical batch as one submitted batch

#### Scenario: Provider sub-batch fails after payload retry
- **WHEN** a payload-retried provider sub-batch fails
- **THEN** the scheduler SHALL report failure against the original logical batch and include the original batch context

### Requirement: Payload-Aware Queue Admission
The scheduler SHALL accept embedding batches that have already been bounded by payload-aware limits and SHALL expose their payload metadata without changing scheduler concurrency semantics.

#### Scenario: Payload-bounded batch is submitted
- **WHEN** the file producer submits a payload-bounded embedding batch
- **THEN** the scheduler SHALL queue and run it using the configured embedding concurrency and queue capacity

#### Scenario: Payload metadata is present
- **WHEN** a submitted batch includes content character and estimated token metadata
- **THEN** the scheduler SHALL preserve that metadata in accelerator batch snapshots

## MODIFIED Requirements

### Requirement: Scheduler progress is exposed in accelerator status
The system SHALL expose scheduler state and payload-aware batch context in accelerator snapshots so clients can distinguish queued, embedding, insert, completed, failed, retried, backpressure, and payload-split states.

#### Scenario: Status reports queued and running work
- **WHEN** accelerated indexing has submitted batches that are queued or running
- **THEN** accelerator status includes counts for queued batches, running embedding batches, running insert batches, submitted batches, completed batches, and failed batches

#### Scenario: Status reports payload-safe batch context
- **WHEN** accelerated indexing has submitted payload-bounded embedding batches
- **THEN** accelerator status includes configured embedding batch size, effective payload limits, content character counts, estimated token counts, and payload retry split counts when available

#### Scenario: Final progress waits for scheduler drain
- **WHEN** the file producer has reached the last file but queued or running batches remain
- **THEN** indexing progress remains below 100 percent until all scheduler batches have completed or failed
