## ADDED Requirements

### Requirement: Adaptive Effective Concurrency
The system SHALL derive effective indexing concurrency from configured limits and live pressure signals when adaptive backpressure is enabled.

#### Scenario: Insert backlog is high
- **WHEN** insert backlog or insert latency exceeds configured thresholds
- **THEN** the scheduler SHALL reduce effective embedding submission rate below the configured maximum

#### Scenario: Pressure subsides
- **WHEN** downstream backlog and retry pressure remain healthy for a sustained interval
- **THEN** the scheduler MAY gradually increase effective concurrency up to the configured maximum

### Requirement: Pressure Signals Are Explicit
The adaptive controller SHALL use explicit pressure signals rather than only elapsed wait time.

#### Scenario: Worker retries spike
- **WHEN** retry rate or rejected worker count exceeds configured thresholds
- **THEN** the adaptive controller SHALL include worker health pressure in its throttle decision

#### Scenario: Memory guardrail triggers
- **WHEN** available memory or VRAM falls below configured guardrails
- **THEN** the adaptive controller SHALL throttle new batch submission or prevent worker expansion

### Requirement: Adaptive Decisions Are Observable
Indexing status SHALL explain adaptive throttling.

#### Scenario: Status is requested while throttled
- **WHEN** adaptive backpressure has reduced effective concurrency
- **THEN** structured status SHALL include configured maximums, effective limits, pressure score, and dominant throttle reason

#### Scenario: Benchmark summary is written
- **WHEN** an adaptive benchmark finishes or is stopped
- **THEN** the summary SHALL include throttle time, dominant throttle reasons, and effective concurrency ranges

### Requirement: Deterministic Modes Remain Deterministic
Adaptive backpressure SHALL NOT alter explicitly sequential or disabled indexing modes.

#### Scenario: Accelerator is off
- **WHEN** `INDEX_ACCELERATOR_MODE=off`
- **THEN** indexing SHALL remain sequential and adaptive backpressure SHALL be inactive

#### Scenario: Adaptive backpressure is disabled
- **WHEN** acceleration is enabled but adaptive backpressure is disabled
- **THEN** the scheduler SHALL use configured static concurrency limits

## MODIFIED Requirements

### Requirement: Bounded embedding batch queue
The system SHALL schedule accelerated indexing embedding batches through a bounded in-process queue and MAY further throttle admission using adaptive backpressure.

#### Scenario: Producer waits when downstream pressure is high
- **WHEN** adaptive backpressure reduces effective queue capacity
- **THEN** the file producer waits for scheduler capacity before submitting another embedding batch
