## ADDED Requirements

### Requirement: Worker recovery links transient fetch failures to request evidence
The system SHALL connect BGE-M3 worker rejection and recovery records to the embedding request failure that caused the rejection.

#### Scenario: Rejected worker references failed request
- **WHEN** a BGE-M3 worker is rejected because an embedding request failed
- **THEN** worker diagnostics SHALL include the failed request id or logical batch identifier, failure reason, retry-safe flag, last failure time, and recovery eligibility time

#### Scenario: Recovered worker preserves prior failure context
- **WHEN** a rejected BGE-M3 worker recovers and returns to the pool
- **THEN** worker diagnostics SHALL preserve the prior failure context in aggregate recovery evidence while reporting the worker as healthy for current scheduling

### Requirement: Retry pressure distinguishes worker rejection from batch retry
The system SHALL report whether embedding retry pressure came from worker rejection, request retry on a healthy worker, timeout, cancellation, or unknown embedding error.

#### Scenario: Retry summary separates fetch failures
- **WHEN** accelerated indexing reports retry pressure for BGE-M3 full embedding
- **THEN** accelerator status SHALL distinguish fetch failures from timeouts, cancellations, metadata failures, startup failures, and unknown embedding errors

#### Scenario: Recovery churn is visible
- **WHEN** BGE-M3 workers repeatedly reject and recover during one indexing workload
- **THEN** accelerator status SHALL include recovery attempt counts and rejection counts by failure category for each worker endpoint
