## ADDED Requirements

### Requirement: Bounded embedding batch queue
The system SHALL schedule accelerated indexing embedding batches through a bounded in-process queue instead of allowing unbounded submitted batch promises.

#### Scenario: Producer waits when scheduler is full
- **WHEN** accelerated indexing has reached the configured maximum of queued and running embedding batches
- **THEN** the file producer waits for scheduler capacity before submitting another embedding batch

#### Scenario: Disabled acceleration remains sequential
- **WHEN** indexing acceleration is disabled
- **THEN** the system processes embedding batches sequentially without using the accelerated scheduler queue

### Requirement: Worker-capacity-based embedding concurrency
The system SHALL use effective embedding concurrency derived from the active indexing accelerator configuration and BGE-M3 worker capacity for BGE-M3 full retrieval.

#### Scenario: BGE-M3 full uses worker capacity
- **WHEN** BGE-M3 full retrieval has four accepted workers and the configured embedding concurrency is lower than four
- **THEN** the scheduler allows up to four concurrent embedding batches

#### Scenario: Non-BGE providers keep configured concurrency
- **WHEN** accelerated indexing uses a provider other than BGE-M3 full retrieval
- **THEN** the scheduler uses the configured embedding concurrency without applying BGE-M3 worker capacity rules

### Requirement: Embedding and insert stages are independently bounded
The system SHALL release embedding capacity after model embedding completes and SHALL run vector database insertion through a separate insert concurrency limit.

#### Scenario: Insert latency does not hold embedding slot
- **WHEN** an embedding batch has completed model embedding and is waiting for vector insertion capacity
- **THEN** the scheduler makes its embedding slot available for another embedding batch

#### Scenario: Insert concurrency is enforced
- **WHEN** multiple embedded batches are ready to insert into the vector database
- **THEN** no more than the configured insert concurrency run insert operations at the same time

### Requirement: BGE-M3 worker dispatch ownership is preserved
The scheduler SHALL NOT assign embedding batches to specific BGE-M3 sidecar endpoints. BGE-M3 worker selection, retry, rejection, and recovery SHALL remain owned by the BGE-M3 embedding provider.

#### Scenario: Scheduler submits provider-level embedding batch
- **WHEN** the scheduler runs a BGE-M3 full embedding batch
- **THEN** it calls the provider worker-pool embedding API and does not choose a worker endpoint itself

#### Scenario: Rejected worker does not stop scheduling
- **WHEN** one BGE-M3 worker is rejected during an accelerated indexing run and healthy workers remain
- **THEN** the scheduler continues scheduling embedding batches and the provider routes work to healthy workers

### Requirement: Scheduler progress is exposed in accelerator status
The system SHALL expose scheduler state in accelerator snapshots so clients can distinguish queued, embedding, insert, completed, failed, retried, and backpressure states.

#### Scenario: Status reports queued and running work
- **WHEN** accelerated indexing has submitted batches that are queued or running
- **THEN** accelerator status includes counts for queued batches, running embedding batches, running insert batches, submitted batches, completed batches, and failed batches

#### Scenario: Final progress waits for scheduler drain
- **WHEN** the file producer has reached the last file but queued or running batches remain
- **THEN** indexing progress remains below 100 percent until all scheduler batches have completed or failed

### Requirement: Scheduler cancellation is deterministic
The scheduler SHALL reject queued batches and wait for active batches to settle when an indexing workload is cancelled.

#### Scenario: Queued batches are cancelled
- **WHEN** an indexing workload is cancelled while batches are queued
- **THEN** queued batches are rejected with the cancellation reason and are not started

#### Scenario: Active batches settle before cancellation returns
- **WHEN** an indexing workload is cancelled while embedding or insert batches are active
- **THEN** the scheduler waits for active batch promises to settle before the indexing operation reports cancellation completion

### Requirement: Batch ordering metadata is preserved
The scheduler SHALL preserve stable batch metadata and document metadata even when batches complete out of order.

#### Scenario: Out-of-order batch completion keeps file metadata
- **WHEN** later embedding batches complete before earlier batches
- **THEN** inserted vector documents retain the correct file path, chunk metadata, and retrieval metadata for each original chunk

#### Scenario: BGE-M3 full metadata is retained
- **WHEN** BGE-M3 full retrieval indexes chunks through the scheduler
- **THEN** inserted documents retain dense, sparse, and ColBERT metadata required by BGE-M3 full search and reranking
