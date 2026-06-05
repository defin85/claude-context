## ADDED Requirements

### Requirement: Worker count planning from VRAM budget
The daemon SHALL plan the number of managed BGE-M3 workers for initial or force indexing from current GPU memory usage, total GPU memory, configured VRAM limit percent, configured maximum worker count, and a safety margin.

#### Scenario: Plans workers within available budget
- **WHEN** managed BGE-M3 workers are enabled, VRAM metrics are available, the current VRAM usage is below the configured limit, and the estimated worker cost fits within the remaining budget
- **THEN** the daemon starts no more than the number of workers that fit within the remaining budget and no more than `BGE_M3_ACCELERATOR_MAX_WORKERS`

#### Scenario: Counts primary and configured workers against maximum
- **WHEN** the daemon computes how many additional managed BGE-M3 workers can be started
- **THEN** it treats the primary `BGE_M3_ENDPOINT` and all manually configured `BGE_M3_WORKER_ENDPOINTS` as already consuming worker capacity under `BGE_M3_ACCELERATOR_MAX_WORKERS`

#### Scenario: Starts no additional worker when budget is exhausted
- **WHEN** managed BGE-M3 workers are enabled and current VRAM usage is at or above the configured VRAM limit
- **THEN** the daemon starts no additional managed BGE-M3 worker and records a fallback reason explaining that VRAM usage is at or above the limit

#### Scenario: Fails closed when VRAM is unmeasured
- **WHEN** managed BGE-M3 workers are enabled, VRAM metrics are unavailable, and unmeasured VRAM is not allowed
- **THEN** the daemon starts no managed BGE-M3 worker and records a fallback reason explaining that VRAM metrics are unavailable

### Requirement: Planning occurs at indexing start
The daemon SHALL perform VRAM-aware managed worker planning when an initial or force indexing workload requests managed workers, not as a permanent daemon-startup decision.

#### Scenario: Uses current VRAM at indexing request time
- **WHEN** an initial or force indexing workload calls managed worker startup
- **THEN** the daemon reads current VRAM before planning worker count for that workload

#### Scenario: Does not rely on startup-only planned endpoints
- **WHEN** daemon startup completes before any indexing workload is submitted
- **THEN** the daemon has not permanently fixed the managed worker count from startup-time VRAM

### Requirement: Started workers are registered with the embedding pool
The daemon SHALL make newly started managed BGE-M3 worker endpoints available to the BGE-M3 embedding provider used by the indexing workload by calling an explicit worker endpoint registration method on `BgeM3Embedding`.

#### Scenario: Embedding pool receives managed endpoints
- **WHEN** VRAM-aware planning starts one or more managed BGE-M3 workers for an indexing workload
- **THEN** subsequent accelerated BGE-M3 batch embedding for that workload can select those managed worker endpoints

#### Scenario: Registration method deduplicates endpoints
- **WHEN** the daemon registers managed worker endpoints that include an endpoint already present in the BGE-M3 embedding pool
- **THEN** `BgeM3Embedding` keeps a single worker entry for that endpoint and preserves the primary endpoint

#### Scenario: Static configured endpoints remain available
- **WHEN** static `BGE_M3_WORKER_ENDPOINTS` are configured and managed worker planning starts additional workers
- **THEN** the embedding pool includes the primary endpoint, static configured endpoints, and newly started managed endpoints without duplicate endpoint entries

### Requirement: Sequential worker calibration
The daemon SHALL start planned managed BGE-M3 workers sequentially and update the worker VRAM estimate from measured VRAM deltas after each healthy worker startup.

#### Scenario: Updates estimate after worker startup
- **WHEN** a managed BGE-M3 worker becomes healthy after startup and VRAM metrics are available before and after startup
- **THEN** the daemon records the measured VRAM delta for that worker profile and uses it to decide whether another worker can fit

#### Scenario: Stops before exceeding budget
- **WHEN** the updated measured worker cost indicates that the next worker would exceed the configured VRAM budget after applying the safety margin
- **THEN** the daemon does not start the next worker and records a planning reason for stopping

#### Scenario: Stops worker that exceeds limit after startup
- **WHEN** a newly started worker causes measured VRAM usage to exceed the configured VRAM limit
- **THEN** the daemon stops that worker and records a fallback reason explaining that worker startup exceeded the VRAM limit

### Requirement: Calibration profile reuse
The daemon SHALL reuse prior managed worker VRAM calibration for matching worker profiles and fall back to a conservative default estimate when no matching calibration exists.

#### Scenario: Uses matching calibration
- **WHEN** calibration exists for the current BGE-M3 model, mode, fp16 setting, device, and worker lifecycle
- **THEN** the daemon uses the calibrated worker VRAM estimate for initial planning before starting workers

#### Scenario: Uses default estimate without calibration
- **WHEN** no matching calibration exists for the current worker profile
- **THEN** the daemon uses a conservative default worker VRAM estimate and replaces it with measured calibration after worker startup

### Requirement: Worker planning telemetry
The daemon SHALL expose managed worker VRAM planning telemetry through operator status snapshots.

#### Scenario: Reports planning inputs and outputs
- **WHEN** managed BGE-M3 worker planning runs
- **THEN** daemon status includes total VRAM, used VRAM before planning, configured budget, safety margin, estimated worker cost, planned worker count, started worker count, calibration source, and fallback or stop reason when present

#### Scenario: Reports runtime pressure stop reason
- **WHEN** runtime VRAM pressure monitoring stops managed BGE-M3 workers because actual usage exceeds the configured limit
- **THEN** daemon status includes the pressure stop reason and the measured usage that triggered it
