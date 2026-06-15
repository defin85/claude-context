# bge-m3-fetch-failure-diagnostics Specification

## Purpose
TBD - created by archiving change investigate-bge-m3-fetch-failures. Update Purpose after archive.
## Requirements
### Requirement: BGE-M3 fetch failures include sanitized client-side cause evidence
The system SHALL record sanitized client-side diagnostic evidence for BGE-M3 embedding request failures without storing raw source text or embedding vectors.

#### Scenario: Fetch failure records low-level cause
- **WHEN** a BGE-M3 `/embed_batch` request fails before a usable embedding response is parsed
- **THEN** the failure evidence SHALL include worker endpoint, request duration, retry attempt, normalized error name/message, low-level cause name/code/message when available, and whether the failure was retry-safe
- **AND** the evidence SHALL NOT include raw source text, credentials, or embedding vector values

#### Scenario: Failure records request shape
- **WHEN** a BGE-M3 embedding request fails for a payload-bounded batch
- **THEN** the failure evidence SHALL include chunk count, content-character count, estimated-token count, retrieval mode, configured payload limits, and logical batch identifier when available

### Requirement: BGE-M3 sidecar exposes embed request outcome evidence
The BGE-M3 sidecar SHALL emit structured request outcome evidence for `/embed_batch` requests so client fetch failures can be correlated with sidecar execution.

#### Scenario: Successful sidecar request records timing
- **WHEN** the sidecar completes an `/embed_batch` request successfully
- **THEN** the sidecar evidence SHALL include request id, worker endpoint or port, request shape, duration, and success status

#### Scenario: Failed sidecar request records failure phase
- **WHEN** the sidecar fails while handling an `/embed_batch` request
- **THEN** the sidecar evidence SHALL include request id, failure phase, exception class, sanitized exception message, duration, and request shape
- **AND** the evidence SHALL NOT include raw source text or embedding vector values

### Requirement: Diagnostic benchmark artifacts classify BGE-M3 fetch failure cause
The diagnostic run artifacts SHALL classify the dominant cause category for observed BGE-M3 fetch failures before any default tuning is promoted.

#### Scenario: Diagnostic run summarizes failure categories
- **WHEN** a diagnostic indexing run completes or is cancelled after a bounded window
- **THEN** its artifact summary SHALL include counts by client error cause, sidecar failure phase, worker endpoint, payload-size bucket, retry-safe status, and recovery outcome

#### Scenario: Root cause remains unknown
- **WHEN** diagnostic artifacts do not contain enough evidence to classify the dominant cause
- **THEN** the change SHALL record the missing evidence explicitly and SHALL NOT promote a new worker, payload, retry, or scheduler default

### Requirement: Diagnostic matrix isolates embedding pressure variables
The investigation SHALL compare bounded BGE-M3 full indexing runs that isolate worker count and payload-size effects on transient fetch failures.

#### Scenario: Worker-count matrix is captured
- **WHEN** the investigation runs `examples/demo-do30-1c`
- **THEN** artifacts SHALL include comparable runs for at least one-worker, two-worker, and four-worker BGE-M3 full configurations using the same vector backend and bounded window

#### Scenario: Payload-size matrix is captured
- **WHEN** the investigation evaluates payload-size sensitivity
- **THEN** artifacts SHALL include the current `20000/5000` payload cap and at least one smaller payload cap while holding worker count and vector backend constant

#### Scenario: Dense-only comparison is marked diagnostic
- **WHEN** a dense-only BGE-M3 comparison is run
- **THEN** it SHALL be marked diagnostic only and SHALL NOT be used as acceptance evidence for full dense+sparse+ColBERT indexing behavior

