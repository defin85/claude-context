## Why

The first dashboard version exposes basic status and actions, but it still makes operators infer active indexing state from sparse cards or MCP status JSON. A dedicated indexing operations view will make current work, queued work, progress, and destructive actions visible without reading logs.

## What Changes

- Add an indexing operations view to the dashboard.
- Show active and queued indexing/search workloads with path, type, position, status, and duration when available.
- Show selected-codebase indexing progress: phase, percentage, current/total file counts, indexed files, chunks, and last update.
- Surface accelerator batch counters that explain whether indexing is moving: submitted, completed, failed, retried, queued, running embedding, and running insert batches.
- Add contextual cancel actions for active and queued indexing jobs.
- Keep operations scoped to existing dashboard API behavior and access policy.
- Non-goals:
  - Do not add a new scheduler or workload model.
  - Do not change MCP tool response contracts.
  - Do not change vector schemas or require re-indexing existing collections.
  - Do not add remote multi-user operations.

## Capabilities

### New Capabilities
- `dashboard-indexing-operations`: Defines dashboard indexing workload visibility, progress rendering, queue display, and cancel controls.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/web-dashboard`: indexing operations layout, polling, progress and queue rendering, cancel actions.
  - `packages/mcp`: API shaping only if current dashboard status payloads do not expose enough workload fields.
  - `openspec/changes/add-web-dashboard`: may remain a baseline dependency during implementation review, but this change should not mutate that completed change.
- Runtime impact:
  - Dashboard remains opt-in and local.
  - Existing MCP clients are unchanged.
  - Existing indexed collections are compatible.
