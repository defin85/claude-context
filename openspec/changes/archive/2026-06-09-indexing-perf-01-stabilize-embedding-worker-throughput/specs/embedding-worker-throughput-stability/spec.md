## ADDED Requirements

### Requirement: Worker Failure Classification
The system SHALL classify BGE-M3 worker failures during accelerated indexing by stage and retry safety.

#### Scenario: Embedding request times out
- **WHEN** a BGE-M3 worker times out before returning an embedding response
- **THEN** the failure SHALL be counted as an embedding timeout and the batch MAY be retried on a healthy worker within the retry budget

#### Scenario: Metadata validation fails
- **WHEN** a worker returns metadata incompatible with the active embedding profile
- **THEN** the worker SHALL be rejected with a metadata failure reason and SHALL NOT receive batches

#### Scenario: Cancellation interrupts a batch
- **WHEN** an indexing workload is cancelled while a worker request is active
- **THEN** the failure SHALL be classified as cancellation and SHALL NOT be counted as worker instability

### Requirement: Worker Recovery Is Bounded
Rejected BGE-M3 workers SHALL only return to active use after cooldown and health validation.

#### Scenario: Rejected worker passes validation
- **WHEN** a rejected worker cooldown expires and health plus metadata validation succeeds
- **THEN** the worker MAY be returned to the accepted worker pool

#### Scenario: Rejected worker remains unhealthy
- **WHEN** a rejected worker fails recovery validation
- **THEN** it SHALL remain rejected and the failure SHALL be counted without blocking healthy workers

### Requirement: Retry Cost Is Observable
Accelerator status SHALL expose retry and rejection summaries sufficient to evaluate throughput loss.

#### Scenario: Status is requested during accelerated indexing
- **WHEN** `get_indexing_status` is called during an accelerated BGE-M3 run
- **THEN** structured content SHALL include active workers, rejected workers, retried batches, failed batches, and retry counts by reason

#### Scenario: Benchmark sample is written
- **WHEN** the benchmark monitor records an indexing sample
- **THEN** the sample SHALL include compact retry and worker summaries and SHALL NOT duplicate the full batch history

### Requirement: Retry Budgets Are Enforced
The system SHALL enforce a bounded retry budget for accelerated embedding batches.

#### Scenario: Retry budget remains
- **WHEN** a safe embedding failure occurs and retry attempts remain
- **THEN** the batch SHALL be retried on a healthy compatible worker

#### Scenario: Retry budget is exhausted
- **WHEN** a batch exceeds its retry budget
- **THEN** the indexing job SHALL fail with the failed stage, retry count, and worker context

## MODIFIED Requirements

### Requirement: BGE-M3 worker dispatch ownership is preserved
The scheduler SHALL NOT assign embedding batches to specific BGE-M3 sidecar endpoints. BGE-M3 worker selection, retry, rejection, and recovery SHALL remain owned by the BGE-M3 embedding provider.

#### Scenario: Rejected worker does not stop scheduling
- **WHEN** one BGE-M3 worker is rejected during an accelerated indexing run and healthy workers remain
- **THEN** the scheduler continues scheduling embedding batches and the provider routes work to healthy workers while reporting the rejected worker summary
