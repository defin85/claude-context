## Purpose

Define recoverable BGE-M3 worker-pool health, rejection diagnostics, recovery, and strict worker profile equivalence.
## Requirements
### Requirement: Recover rejected BGE-M3 workers
The system SHALL revalidate rejected non-primary BGE-M3 workers during long indexing jobs and return them to the worker pool when they pass health, metadata, and profile-equivalence checks.

#### Scenario: Healthy rejected worker returns to service
- **WHEN** an extra BGE-M3 worker is marked rejected after a transient embedding request failure
- **THEN** the system rechecks `/health` and `/metadata` after a bounded cooldown and marks the worker healthy again if its profile still matches the primary worker

#### Scenario: Mismatched worker remains rejected
- **WHEN** a rejected extra worker responds to health but its metadata no longer matches the primary worker profile
- **THEN** the system keeps the worker rejected and records the mismatch reason

### Requirement: Worker rejection diagnostics
The system SHALL expose per-worker diagnostics for active, rejected, and recovering BGE-M3 workers.

#### Scenario: Status shows rejection reason
- **WHEN** an extra BGE-M3 worker is rejected
- **THEN** indexing or accelerator status includes that worker endpoint, rejection reason, last failure time, and recovery-attempt count

#### Scenario: Status shows successful recovery
- **WHEN** a rejected extra BGE-M3 worker recovers
- **THEN** indexing or accelerator status includes the worker as healthy and updates its last successful request time

### Requirement: Strict full-mode profile equivalence
The system SHALL require equivalent model, mode, precision, max token policy, preprocessing profile, dense dimension, and full-mode outputs before using an extra BGE-M3 worker for full BGE-M3 indexing.

#### Scenario: Full-mode output mismatch is rejected
- **WHEN** an extra BGE-M3 worker metadata omits dense, sparse, or ColBERT output in full mode
- **THEN** the worker is rejected before receiving embedding batches

#### Scenario: Matching full-mode worker is accepted
- **WHEN** an extra BGE-M3 worker metadata matches the primary worker full-mode profile
- **THEN** the worker is eligible to receive embedding batches

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

