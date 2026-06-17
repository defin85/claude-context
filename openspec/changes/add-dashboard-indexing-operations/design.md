## Context

The dashboard already polls daemon status and codebase status. Those payloads include workload counts, known codebases, indexing progress, accelerator counters, and cancellation endpoints, but the UI currently compresses this into a few summary cards and generic buttons.

## Goals / Non-Goals

Goals:
- Make active and queued work obvious at first glance.
- Let operators cancel the intended indexing job without confusing queued and active jobs.
- Show enough progress and batch counters to distinguish real movement from stalls.
- Avoid full-page rebuilds during polling.

Non-goals:
- Replacing daemon scheduling.
- Adding persistent dashboard-owned job history.
- Changing MCP JSON-RPC contracts.

## Decisions

### Decision: Add an operations-first status section

Create a dedicated dashboard section above search with:
- active indexing jobs;
- queued indexing jobs;
- selected-codebase progress;
- accelerator batch counters.

Rationale: Operators usually need to answer "what is running, what is waiting, and is it moving" before searching.

### Decision: Render queued and active jobs separately

Display queued jobs separately from active jobs, and make cancellation labels explicit.

Rationale: This matches the daemon cancellation semantics and prevents repeating the queued-cancel worker-stop regression.

### Decision: Reuse polling and dashboard API

Use existing dashboard status and cancel API first. Only add server fields if the payload lacks job duration or queue position.

Rationale: The dashboard should remain a presentation layer over daemon state.

## Risks / Trade-offs

- Workload snapshots may be large. Keep the list compact and cap rendered rows if needed.
- Job duration may not be present in current payloads. If unavailable, omit rather than inventing client-local timing.
- Progress fields differ by codebase state. Render absent values as quiet empty states, not as zero.

## Migration Plan

No storage migration. Existing indexes and daemon state remain compatible. Users get the improved view after rebuilding and serving the dashboard assets.
