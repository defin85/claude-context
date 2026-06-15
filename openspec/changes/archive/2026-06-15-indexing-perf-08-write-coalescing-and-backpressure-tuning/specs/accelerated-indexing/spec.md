## ADDED Requirements

### Requirement: Backend-aware throughput changes require bounded benchmark evidence
The system SHALL validate backend-aware write policy and coalescing changes with bounded benchmark evidence before promoting defaults.

#### Scenario: demo-do30-1c bounded run reports comparable throughput
- **WHEN** a candidate write policy is benchmarked on `examples/demo-do30-1c`
- **THEN** the benchmark summary SHALL record codebase path, 1C scope profile, retrieval mode, payload limits, vector backend, configured and effective insert concurrency, worker count, wall-clock time, progress percentage, processed file count, completed insert batches, failed insert batches, retry counts, and backpressure wait time

#### Scenario: Candidate does not regress write safety
- **WHEN** a candidate write policy is compared with the capped baseline
- **THEN** it SHALL have zero failed insert batches in the bounded acceptance run unless the change is explicitly rejected

#### Scenario: Candidate must improve throughput or explain the bottleneck
- **WHEN** a candidate write policy does not materially increase bounded progress or reduce wall-clock time
- **THEN** the benchmark evidence SHALL identify the remaining dominant pressure source before the policy can be promoted as a default

### Requirement: Backend-specific unsafe write modes fail closed
The system SHALL prevent known unsafe backend write modes from running as promoted defaults.

#### Scenario: Local single-writer backend rejects parallel table writes
- **WHEN** a local vector backend is known to fail or corrupt state with concurrent writes to one collection
- **THEN** auto mode SHALL NOT issue concurrent writes to that collection

#### Scenario: Parallel backend remains eligible
- **WHEN** a backend demonstrates parallel writes without failed insert batches in bounded acceptance runs
- **THEN** auto mode MAY use backend-specific effective insert concurrency greater than one
