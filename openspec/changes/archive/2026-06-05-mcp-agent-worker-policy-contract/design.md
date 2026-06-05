## Context

The MCP daemon already owns shared runtime state for indexing workloads, daemon discovery, accelerator snapshots, and managed BGE-M3 workers. The `vram-aware-worker-planning` change added request-time VRAM-aware worker planning and exposes `managedBgeM3Workers.vramPlanning`, but a new agent still has to infer the operating rule: submit indexing work through the daemon and do not start BGE-M3 sidecars directly.

This matters most on a shared GPU host where several agents can work on different repositories. Repository size affects indexing duration and chunk volume, but worker VRAM capacity is host/profile scoped: model, BGE-M3 mode, fp16/fp32, device, and worker lifecycle. The contract must therefore be visible in MCP runtime status rather than only in repo docs or local instructions.

## Goals / Non-Goals

**Goals:**

- Expose a machine-readable worker planning policy in `get_daemon_status`.
- Tell agents that BGE-M3 worker planning is daemon-owned.
- Tell agents to submit indexing workloads and poll MCP status instead of launching workers directly.
- Point agents to the status fields that explain queue state, worker state, VRAM planning, and fallback/stop reasons.
- Keep the contract stable enough for agents to consume without parsing natural language.

**Non-Goals:**

- No changes to indexing, search, embedding, or reranking behavior.
- No changes to dense-only BGE-M3 or full BGE-M3 dense+sparse+ColBERT retrieval semantics.
- No collection migration, storage layout change, or Milvus schema change.
- No new external dependency.
- No new worker control API for agents.

## Decisions

### Add a structured policy snapshot to daemon status

`get_daemon_status` will include a `workerPlanningPolicy` object in `structuredContent`. The policy will use explicit boolean and enum-like fields such as `owner: 'daemon'`, `agentDirective: 'submit_indexing_workloads_only'`, and `doNotStartWorkersDirectly: true`.

Alternative considered: only add text to the status output. That is easier to implement but forces agents to parse prose and makes the contract less reliable. The structured object is the source of truth; text is a convenience for operators.

### Centralize policy construction

The policy object, canonical field paths, and recommended agent flow will be built by a small typed helper rather than assembled inline in `handleGetDaemonStatusTool`. The daemon status handler, text status, tool-list description, and tests should reference the same constants or helper outputs where practical.

Alternative considered: assemble the policy object directly in the status handler. That is shorter initially, but it increases drift risk between structured content, text content, tool descriptions, and tests.

### Keep the policy descriptive, not imperative runtime state

The policy will describe what the agent should do and where to look, while existing fields continue to describe current runtime state:

- queue state: `runtimes[].workload`
- active/rejected embedding workers: `accelerator.workers`
- managed worker runtime: `managedBgeM3Workers`
- VRAM planning: `managedBgeM3Workers.vramPlanning`

Alternative considered: duplicate current queue and worker counters inside the policy. That would make the payload redundant and easier to drift. The policy should reference canonical fields instead.

### Use host/profile calibration language

The policy will say that worker planning scope is `host_gpu` and calibration scope is `host_profile`. It will list profile key fields: model, mode, precision, device, lifecycle. This makes clear that repositories and agents share calibration for the same model/runtime profile.

Alternative considered: include repository-specific calibration. That does not match BGE-M3 worker memory behavior; repo size affects workload duration and chunk count, not model residency in VRAM.

### Surface policy in both structured and text status

The text status will include a concise line: daemon-owned worker planning, submit workloads only, do not start BGE-M3 workers directly. This helps humans and models that skim text, while structured content remains the deterministic contract.

### Advertise policy discovery in the tool description

The `get_daemon_status` tool description will mention that the tool exposes the agent worker planning policy. This matters because a fresh agent may first see the tool list before it has called daemon status; the description should point it to the policy contract without requiring repo docs or prior conversation context.

Alternative considered: rely on existing tool description and status output only. That still leaves a discovery gap for agents deciding which MCP tool to call.

## Risks / Trade-offs

- Agent ignores structured content -> Include the same directive as a short text line.
- Agent never calls daemon status -> Mention worker planning policy in the `get_daemon_status` tool description.
- Policy references drift from actual field names -> Centralize policy construction in a typed helper and add tests that assert `statusFields` includes the canonical field paths.
- Operators mistake policy for live capacity -> Keep live counters in existing runtime fields and use descriptive names for the policy.
- Extra status payload size -> The policy is small fixed metadata and does not add meaningful latency.
- Storage impact -> None for indexed collections; only status metadata changes.
- BGE-M3 full retrieval latency impact -> None directly; this does not change dense, sparse, ColBERT generation, reranking, batching, or worker startup behavior.

## Migration Plan

Deploy by rebuilding and restarting the MCP daemon. Existing clients that ignore unknown structured fields continue to work. Rollback removes the extra policy fields from status output without touching indexed collections or worker state.

## Open Questions

None for the initial contract. Future changes can add per-workload admission decisions if multi-agent scheduling needs more detail than current queue and managed worker telemetry.
