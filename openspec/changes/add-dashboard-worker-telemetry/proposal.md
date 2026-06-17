## Why

Managed BGE-M3 workers, VRAM planning, and accelerator health are central to indexing performance, but the first dashboard version only exposes a small summary. Operators need a clear worker telemetry panel to see whether the daemon has planned, started, accepted, rejected, or stopped workers.

## What Changes

- Add a dashboard worker and VRAM telemetry panel.
- Show primary, configured, planned, managed, running, and total BGE-M3 endpoints.
- Show endpoint health, in-flight counts, rejection counts, recovery attempts, and pool state when available.
- Show VRAM budget, used/free budget, safety margin, estimated worker memory, calibration source, planned workers, started workers, and stop/fallback reasons.
- Highlight degraded states such as rejected workers, fallback mode, failed recovery, and missing VRAM metrics.
- Non-goals:
  - Do not start or stop workers directly from the dashboard.
  - Do not edit worker lifecycle settings in the UI.
  - Do not change VRAM planning policy or calibration storage.
  - Do not expose secrets or raw environment dumps.

## Capabilities

### New Capabilities
- `dashboard-worker-telemetry`: Defines dashboard visibility for BGE-M3 worker health, VRAM planning, fallback reasons, and accelerator worker state.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/web-dashboard`: telemetry panel, degraded-state styling, responsive layout.
  - `packages/mcp`: sanitized status shaping only if existing `managedBgeM3Workers` or accelerator payloads need a frontend-friendly envelope.
- Runtime impact:
  - Display-only change. No index migration and no worker lifecycle changes.
