## ADDED Requirements

### Requirement: Worker Pool Summary
The dashboard SHALL display managed BGE-M3 worker pool summary fields when daemon status provides them.

#### Scenario: Worker pool snapshot is available
- **WHEN** daemon status includes managed BGE-M3 worker data
- **THEN** the dashboard SHALL display primary endpoint, configured endpoints, planned endpoints, running workers, managed endpoints, and total pool endpoints.

#### Scenario: Worker pool snapshot is unavailable
- **WHEN** managed BGE-M3 worker data is unavailable
- **THEN** the dashboard SHALL show a quiet unavailable state rather than an empty or misleading healthy state.

### Requirement: Worker Endpoint Health
The dashboard SHALL display per-endpoint health and lifecycle state.

#### Scenario: Endpoint health exists
- **WHEN** accelerator worker entries include endpoint, health, in-flight count, rejection counts, recovery attempts, or pool state
- **THEN** the dashboard SHALL render those fields per endpoint.

#### Scenario: Worker degradation exists
- **WHEN** rejected workers, failed recovery, fallback reason, or unhealthy endpoint state is present
- **THEN** the dashboard SHALL highlight the degraded state.

### Requirement: VRAM Planning Visibility
The dashboard SHALL display VRAM planning information needed to explain worker count decisions.

#### Scenario: VRAM plan exists
- **WHEN** status includes VRAM planning data
- **THEN** the dashboard SHALL show budget, used-before, free budget, safety margin, estimated worker memory, calibration source, planned worker count, and started worker count.

#### Scenario: Worker stop or fallback reason exists
- **WHEN** VRAM planning includes stop reason or managed workers include fallback reason
- **THEN** the dashboard SHALL display that reason as an operator-visible alert.

### Requirement: Read-Only Worker Policy
The dashboard SHALL NOT expose controls that start, stop, or override managed workers directly.

#### Scenario: Operator views worker panel
- **WHEN** the worker telemetry panel is displayed
- **THEN** it SHALL provide status and diagnostics only, with no direct sidecar lifecycle controls.
