## Why

Multiple agents can submit indexing work to the same MCP daemon and GPU host, but the daemon status currently exposes worker state without an explicit machine-readable policy that tells agents who owns BGE-M3 worker planning. A new agent should not have to infer that it must submit indexing workloads and avoid starting sidecars or systemd worker units itself.

## What Changes

- Add an explicit MCP worker planning policy contract to daemon status.
- Make the contract available in structured content so agents can parse it reliably.
- Add a short human-readable daemon status line that states daemon ownership of managed worker planning.
- Point agents to the relevant runtime fields for queue state, accelerator workers, managed worker snapshots, and VRAM planning telemetry.
- Define the agent directive for indexing workflows: submit workloads through MCP tools, poll MCP status, and report daemon fallback/stop reasons instead of overriding worker policy.

Non-goals:

- Do not change indexing, search, embedding, or worker startup behavior.
- Do not add a new tool for worker control.
- Do not expose daemon tokens, environment secrets, or credentials.
- Do not migrate or rewrite existing indexed collections.

## Capabilities

### New Capabilities

- `mcp-agent-worker-policy-contract`: Defines the daemon-owned worker planning contract that MCP status exposes to agents and operators.

### Modified Capabilities

- None.

## Impact

- Affected package: `packages/mcp`.
- Affected tool output: `get_daemon_status` structured content and text content.
- Affected tests: MCP daemon status/tool output coverage.
- Existing indexed collections are not migrated and remain valid because this change only adds status metadata.
