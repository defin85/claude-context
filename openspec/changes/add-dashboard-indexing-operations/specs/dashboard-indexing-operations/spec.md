## ADDED Requirements

### Requirement: Indexing Operations View
The dashboard SHALL provide an operator-facing view of active and queued indexing work.

#### Scenario: Active indexing is visible
- **WHEN** daemon status includes an active indexing workload
- **THEN** the dashboard SHALL display the codebase path, workload type, active state, and available progress details.

#### Scenario: Queued indexing is visible
- **WHEN** daemon status includes queued indexing workloads
- **THEN** the dashboard SHALL display queued jobs separately from active jobs and include queue position when available.

#### Scenario: No indexing work is active
- **WHEN** there are no active or queued indexing jobs
- **THEN** the dashboard SHALL show a stable empty state without layout flicker during polling.

### Requirement: Indexing Progress Details
The dashboard SHALL render selected-codebase indexing progress and accelerator counters when available.

#### Scenario: Progress details are available
- **WHEN** selected-codebase status includes phase, percentage, current count, or total count
- **THEN** the dashboard SHALL display those fields as a compact progress summary.

#### Scenario: Batch counters are available
- **WHEN** accelerator counters are available
- **THEN** the dashboard SHALL display submitted, completed, failed, retried, queued, running embedding, and running insert batch counts.

#### Scenario: Progress fields are absent
- **WHEN** progress or accelerator fields are absent
- **THEN** the dashboard SHALL omit unavailable counters or render them as unavailable, not as misleading zero values.

### Requirement: Contextual Cancellation
The dashboard SHALL let operators cancel indexing work from the operations view.

#### Scenario: Active job cancellation
- **WHEN** an active indexing job is displayed
- **THEN** the dashboard SHALL provide a cancel action that targets that codebase and confirms the affected active job.

#### Scenario: Queued job cancellation
- **WHEN** a queued indexing job is displayed
- **THEN** the dashboard SHALL provide a cancel action that targets that queued codebase without implying worker shutdown.
