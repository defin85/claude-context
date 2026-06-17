## Context

Daemon status already includes accelerator snapshots and managed BGE-M3 worker snapshots. Those fields are rich enough for debugging VRAM pressure and worker pool health, but the current UI does not make them inspectable.

## Goals / Non-Goals

Goals:
- Make worker pool state visible without MCP calls.
- Explain VRAM planning decisions and fallback reasons.
- Distinguish accepted, rejected, recovered, and unavailable worker endpoints.

Non-goals:
- Manual worker controls.
- Editing environment settings.
- Rendering low-level batch details that belong in indexing operations.

## Decisions

### Decision: Display telemetry as grouped operational rows

Use groups for pool summary, endpoint health, VRAM plan, and degraded reasons.

Rationale: Worker data has different units and should be scannable rather than collapsed into one card.

### Decision: Treat fallback and stop reasons as first-class alerts

Render fallback reasons, stop reasons, rejected workers, and failed recoveries prominently.

Rationale: These fields are usually the answer to "why did performance drop".

### Decision: Keep the panel read-only

The dashboard will not start sidecars or override daemon worker policy.

Rationale: The daemon is the owner of worker lifecycle. UI controls would risk conflicting with planning policy.

## Risks / Trade-offs

- Worker snapshots can be stale after idle stop. Show last known state clearly and avoid implying workers are running when `runningWorkers` is empty.
- Endpoint lists can be long. Keep rows compact and cap width with wrapping.
- VRAM metrics may be absent. Render an explicit unavailable state.

## Migration Plan

No migration. Existing daemon status payloads remain compatible. Users see the panel after rebuilding dashboard assets.
