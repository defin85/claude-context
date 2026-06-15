## Purpose

Define bounded scheduling, backpressure, progress, cancellation, and worker-pool interaction for accelerated embedding batch indexing.
## Requirements
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

### Requirement: Insert scheduling uses vector backend write capabilities
The system SHALL derive effective insert scheduling behavior from vector database write capabilities and the configured insert limits.

#### Scenario: Parallel-safe backend uses configured insert concurrency
- **WHEN** a vector backend reports that parallel writes to the same collection are safe and the operator configures insert concurrency greater than one
- **THEN** the accelerated scheduler SHALL allow insert operations up to the configured limit while preserving queue bounds and failure containment

#### Scenario: Single-writer backend clamps effective insert concurrency
- **WHEN** a vector backend reports that writes to the same collection require a single writer
- **THEN** the accelerated scheduler SHALL clamp effective insert concurrency for that collection to one
- **AND** status SHALL report both configured insert concurrency and effective insert concurrency

#### Scenario: Backend capability is unknown
- **WHEN** a vector backend does not report write capabilities
- **THEN** the accelerated scheduler SHALL use the existing conservative insert behavior

### Requirement: Embedded batches can be coalesced before vector insertion
The system SHALL support coalescing multiple completed embedding batches into fewer vector database write calls without increasing embedding request payload size.

#### Scenario: Small completed embedding batches are coalesced
- **WHEN** payload-safe embedding produces several completed batches below the backend target write size
- **THEN** the scheduler MAY combine their vector documents into one insert flush before calling the vector database
- **AND** the coalesced flush SHALL preserve every document id, relative path, line range, retrieval metadata, and original chunk order within each source batch

#### Scenario: Coalescing does not change BGE-M3 payload limits
- **WHEN** embedding batches are coalesced for insertion
- **THEN** the system SHALL NOT increase the content-character or estimated-token limits used for BGE-M3 embedding requests

#### Scenario: Coalescing drains on cancellation
- **WHEN** an indexing workload is cancelled while coalesced documents are buffered
- **THEN** the scheduler SHALL either flush or fail the buffered documents deterministically before reporting cancellation completion

#### Scenario: Coalescing diagnostics are exposed
- **WHEN** accelerated indexing uses write coalescing
- **THEN** accelerator status SHALL report coalesced write counts, coalesced document counts, flush reasons, and configured/effective coalescing limits

### Requirement: Backpressure attribution separates pressure sources
The system SHALL expose and act on insert backlog, insert latency, retry rate, rejected workers, host memory, and VRAM pressure as separate scheduler signals.

#### Scenario: Insert backlog is reported separately
- **WHEN** embedded batches wait because the insert queue or coalescing queue is full
- **THEN** accelerator status SHALL report insert backlog pressure separately from VRAM and worker pressure

#### Scenario: VRAM pressure does not hide write health
- **WHEN** VRAM pressure is the selected throttle reason while vector writes continue succeeding
- **THEN** accelerator status SHALL still report completed insert counts, failed insert counts, insert latency, and write queue depth

#### Scenario: Effective throttling reason is stable
- **WHEN** multiple pressure signals are present
- **THEN** accelerator status SHALL identify the selected throttle reason and include the raw pressure signals used to choose it

