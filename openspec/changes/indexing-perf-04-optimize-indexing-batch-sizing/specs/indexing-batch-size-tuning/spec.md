## ADDED Requirements

### Requirement: Embedding And Insert Batch Sizes Are Separately Tunable
The system SHALL support independent tuning of embedding request batch size and vector insert batch size when the pipeline stages require different grouping.

#### Scenario: Embedding batch size is configured
- **WHEN** an embedding batch size is configured
- **THEN** the embedding scheduler SHALL group chunks up to that configured limit before submitting embedding work

#### Scenario: Insert batch size differs
- **WHEN** an insert batch size differs from the embedding batch size
- **THEN** the insert scheduler MAY split or coalesce embedded documents while preserving document metadata and write safety

### Requirement: Batch Size Metrics Are Captured
Benchmark artifacts SHALL capture batch-size inputs and outcomes.

#### Scenario: Benchmark sample is written
- **WHEN** a benchmark monitor records an indexing sample
- **THEN** the sample SHALL include embedding batch size, insert batch size, chunks per batch, token estimate per batch when available, retry counts, and insert latency

#### Scenario: Benchmark summary is written
- **WHEN** a benchmark run finishes or is stopped
- **THEN** the summary SHALL include wall-clock, total chunks, submitted/completed batches, retry rate, and configured batch sizes

### Requirement: Default Batch Size Changes Require Evidence
The project SHALL only change default indexing batch sizes when verification artifacts show a throughput or stability improvement.

#### Scenario: Default change is proposed
- **WHEN** a default batch-size change is implemented
- **THEN** verification SHALL include before/after benchmark evidence on at least one small and one larger repository

#### Scenario: Candidate regresses stability
- **WHEN** a candidate batch size increases failed or retried batches beyond the accepted threshold
- **THEN** it SHALL NOT become the default

## MODIFIED Requirements

### Requirement: Scheduler progress is exposed in accelerator status
The system SHALL expose scheduler state and batch-size context in accelerator snapshots so clients can distinguish queued, embedding, insert, completed, failed, retried, and backpressure states.

#### Scenario: Status reports batch-size context
- **WHEN** accelerated indexing has submitted batches
- **THEN** accelerator status SHALL include configured embedding and insert batch sizes in addition to scheduler counters
