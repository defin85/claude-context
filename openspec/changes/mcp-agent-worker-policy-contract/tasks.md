## 1. Policy Contract Model

- [x] 1.1 Add a typed worker planning policy snapshot for daemon status structured content.
- [x] 1.2 Add a small typed helper or constants module that constructs the worker planning policy snapshot.
- [x] 1.3 Populate policy fields for daemon ownership, BGE-M3 provider, host GPU planning scope, host/profile calibration scope, and direct worker startup prohibition.
- [x] 1.4 Include profile key field names for model, mode, precision, device, and lifecycle.
- [x] 1.5 Include canonical status field paths for queue state, accelerator workers, managed workers, and VRAM planning telemetry.
- [x] 1.6 Include recommended agent flow steps for indexing, polling, queue handling, and fallback/stop reason reporting.
- [x] 1.7 Include canonical status field paths for fallback and stop reasons.

## 2. Daemon Status Integration

- [x] 2.1 Add `workerPlanningPolicy` to `get_daemon_status` structured content.
- [x] 2.2 Add a concise human-readable daemon status line that states worker planning is daemon-owned and agents must not start BGE-M3 workers directly.
- [x] 2.3 Update the `get_daemon_status` tool description to advertise that daemon status exposes the worker planning policy.
- [x] 2.4 Ensure the policy does not expose daemon tokens, environment secrets, credentials, raw process command lines, or private configuration values.
- [x] 2.5 Preserve existing `managedBgeM3Workers`, `accelerator`, workload, and sync status output shapes.

## 3. Tests

- [x] 3.1 Add MCP status coverage asserting `owner: daemon`, `managedWorkerProvider: BGE_M3`, and `doNotStartWorkersDirectly: true`.
- [x] 3.2 Add MCP status coverage asserting status field paths include queue, workers, managed workers, and VRAM planning.
- [x] 3.3 Add MCP status coverage asserting calibration scope and profile key fields are present.
- [x] 3.4 Add MCP status coverage asserting the human-readable text includes the daemon-owned worker planning directive.
- [x] 3.5 Add coverage that the policy payload does not include secret-bearing fields.
- [x] 3.6 Add coverage asserting policy helper output is used by daemon status structured content without reconstructing divergent inline values.
- [x] 3.7 Add MCP tool-list coverage asserting the `get_daemon_status` description advertises worker planning policy discovery.

## 4. Verification

- [x] 4.1 Run focused MCP tests for daemon status/tool output.
- [x] 4.2 Run `pnpm build` and `pnpm typecheck`.
- [x] 4.3 Run `openspec validate mcp-agent-worker-policy-contract --strict`.
