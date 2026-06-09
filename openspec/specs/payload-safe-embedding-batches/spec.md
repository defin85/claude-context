# payload-safe-embedding-batches Specification

## Purpose
TBD - created by archiving change indexing-perf-07-payload-safe-embedding-batches. Update Purpose after archive.
## Requirements
### Requirement: Payload-Aware Embedding Batch Limits
The system SHALL bound embedding batches by payload-risk limits in addition to configured chunk-count limits.

#### Scenario: Next chunk would exceed content character limit
- **WHEN** adding the next chunk would make the embedding batch exceed the configured content character limit
- **THEN** the system SHALL submit the current non-empty embedding batch before adding the next chunk

#### Scenario: Next chunk would exceed estimated token limit
- **WHEN** adding the next chunk would make the embedding batch exceed the configured estimated token limit
- **THEN** the system SHALL submit the current non-empty embedding batch before adding the next chunk

#### Scenario: Single chunk exceeds payload limit
- **WHEN** a single chunk exceeds a payload-risk limit
- **THEN** the system SHALL submit that chunk as a single-chunk embedding batch and record that the limit was exceeded by an individual chunk

### Requirement: BGE-M3 Full Uses Payload-Safe Effective Limits
The system SHALL apply payload-safe effective embedding limits for BGE-M3 full retrieval so dense, sparse, and ColBERT response payloads do not rely only on chunk count.

#### Scenario: BGE-M3 full mode is active
- **WHEN** indexing uses BGE-M3 full retrieval
- **THEN** the effective embedding batch boundaries SHALL include content character and estimated token limits appropriate for BGE-M3 full payload size

#### Scenario: Dense-only provider is active
- **WHEN** indexing uses a provider without ColBERT response payloads
- **THEN** payload-safe limits SHALL NOT reduce the configured chunk-count batch size unless explicit payload limit configuration requires it

### Requirement: Payload-Size Embedding Failures Are Retried With Smaller Sub-Batches
The system SHALL retry recognized payload-size embedding failures by splitting the failed logical embedding batch into smaller provider sub-batches while preserving output order.

#### Scenario: Multi-chunk embedding batch fails with string-size error
- **WHEN** an embedding provider call for a multi-chunk batch fails with a recognized string-size or payload-size error
- **THEN** the system SHALL retry the same logical batch by splitting it into smaller embedding sub-batches

#### Scenario: Split retry succeeds
- **WHEN** split embedding sub-batches complete successfully
- **THEN** the system SHALL concatenate embedding results in original chunk order and continue indexing the original logical batch

#### Scenario: Single-chunk retry still fails
- **WHEN** a single-chunk embedding batch fails with a recognized payload-size error
- **THEN** the system SHALL fail the indexing batch with diagnostics including file path, chunk index, content character count, estimated tokens, and provider mode

### Requirement: Payload Split Diagnostics Are Captured
The system SHALL expose payload-aware batch diagnostics in accelerator status and benchmark artifacts.

#### Scenario: Status includes payload-aware batch metadata
- **WHEN** accelerator status includes batch history
- **THEN** each batch snapshot with available data SHALL include content character count, estimated token count, and payload split reason

#### Scenario: Payload retry split occurs
- **WHEN** a payload-size embedding failure is retried by splitting the batch
- **THEN** accelerator status and benchmark summaries SHALL include the payload retry split count

#### Scenario: Benchmark summary is written
- **WHEN** a benchmark run finishes or is cancelled
- **THEN** the summary SHALL include maximum content characters per batch, maximum estimated tokens per batch, payload split count, and whether any payload-size failures reached single-chunk fatal state

