## ADDED Requirements

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
