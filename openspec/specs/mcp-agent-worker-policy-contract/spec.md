# mcp-agent-worker-policy-contract Specification

## Purpose
TBD - created by archiving change mcp-agent-worker-policy-contract. Update Purpose after archive.
## Requirements
### Requirement: Daemon status exposes worker planning ownership

The MCP daemon SHALL expose a machine-readable worker planning policy in `get_daemon_status` structured content that identifies the daemon as the owner of managed BGE-M3 worker planning.

#### Scenario: Agent reads daemon ownership

- **WHEN** an agent calls `get_daemon_status`
- **THEN** the structured content includes `workerPlanningPolicy.owner` with value `daemon`
- **AND** includes `workerPlanningPolicy.managedWorkerProvider` with value `BGE_M3`

### Requirement: Daemon status tells agents not to start workers directly

The MCP daemon SHALL expose an explicit agent directive that instructs agents to submit indexing workloads through MCP and not start BGE-M3 sidecars, child processes, or systemd worker units directly.

#### Scenario: Agent reads worker launch directive

- **WHEN** an agent calls `get_daemon_status`
- **THEN** the structured content includes `workerPlanningPolicy.agentDirective` with value `submit_indexing_workloads_only`
- **AND** includes `workerPlanningPolicy.doNotStartWorkersDirectly` with value `true`

### Requirement: Worker planning policy points to runtime status fields

The MCP daemon SHALL expose canonical status field paths that agents can use to inspect queue state, accelerator workers, managed worker state, VRAM planning telemetry, and daemon fallback or stop reasons.

#### Scenario: Agent locates runtime worker planning evidence

- **WHEN** an agent calls `get_daemon_status`
- **THEN** the structured content includes `workerPlanningPolicy.statusFields.queue`
- **AND** includes `workerPlanningPolicy.statusFields.workers`
- **AND** includes `workerPlanningPolicy.statusFields.managedWorkers`
- **AND** includes `workerPlanningPolicy.statusFields.vramPlan`
- **AND** includes `workerPlanningPolicy.statusFields.fallbackReasons`

### Requirement: Worker planning policy provides recommended agent flow

The MCP daemon SHALL expose a recommended agent flow that tells agents to inspect daemon status, submit indexing workloads through MCP tools, poll MCP status, wait or report queue state, and report fallback or stop reasons instead of overriding daemon worker policy.

#### Scenario: Agent reads indexing workflow directive

- **WHEN** an agent calls `get_daemon_status`
- **THEN** the structured content includes `workerPlanningPolicy.recommendedAgentFlow`
- **AND** the flow includes calling `get_daemon_status` before indexing
- **AND** the flow includes calling `index_codebase` for allowed repo paths
- **AND** the flow includes polling `get_indexing_status` or `get_daemon_status`
- **AND** the flow includes not starting sidecars or systemd worker units directly
- **AND** the flow includes reporting fallback or stop reasons instead of overriding daemon policy

### Requirement: Worker planning policy explains calibration scope

The MCP daemon SHALL expose that managed worker calibration is scoped to the host GPU and worker profile rather than to an individual repository or agent.

#### Scenario: Agent reads calibration scope

- **WHEN** an agent calls `get_daemon_status`
- **THEN** the structured content includes `workerPlanningPolicy.planningScope` with value `host_gpu`
- **AND** includes `workerPlanningPolicy.calibrationScope` with value `host_profile`
- **AND** lists profile key fields for model, mode, precision, device, and lifecycle

### Requirement: Daemon status includes human-readable worker policy

The MCP daemon SHALL include a concise text status line that states worker planning is daemon-owned and agents must submit indexing workloads instead of starting BGE-M3 workers directly.

#### Scenario: Operator reads daemon status text

- **WHEN** an operator or text-oriented agent calls `get_daemon_status`
- **THEN** the text content includes a worker planning policy line with daemon ownership
- **AND** states that agents must not start BGE-M3 workers directly

### Requirement: Tool list advertises worker policy discovery

The MCP daemon SHALL describe `get_daemon_status` as the tool that exposes daemon runtime metadata and the agent worker planning policy.

#### Scenario: Agent discovers policy status tool

- **WHEN** an agent lists MCP tools in daemon mode
- **THEN** the `get_daemon_status` tool description states that it exposes the worker planning policy
- **AND** does not instruct agents to start workers directly

### Requirement: Worker planning policy avoids secret exposure

The MCP daemon SHALL NOT expose daemon tokens, environment secrets, credentials, or raw private configuration values through the worker planning policy.

#### Scenario: Agent reads policy without secrets

- **WHEN** an agent calls `get_daemon_status`
- **THEN** `workerPlanningPolicy` does not include daemon tokens, Milvus tokens, API keys, passwords, or process command lines

