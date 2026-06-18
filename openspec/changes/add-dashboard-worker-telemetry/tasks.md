## 1. Status Contract

- [x] 1.1 Inspect managed worker and accelerator status payloads used by the dashboard.
- [x] 1.2 Add frontend types for worker pool, endpoint health, and VRAM planning fields.
- [x] 1.3 Add API or fixture tests for unavailable, healthy, and degraded worker snapshots.

## 2. Worker Telemetry UI

- [x] 2.1 Add a worker telemetry panel to the dashboard.
- [x] 2.2 Render pool summary fields.
- [x] 2.3 Render endpoint health rows.
- [x] 2.4 Render VRAM planning fields with units.
- [x] 2.5 Highlight fallback, stop, rejected, and unhealthy states.
- [x] 2.6 Ensure the panel is read-only and has no direct worker lifecycle controls.

## 3. Validation

- [x] 3.1 Run frontend typecheck and build.
- [x] 3.2 Run MCP dashboard status tests.
- [x] 3.3 Smoke-test against a daemon with managed worker planning data.
- [x] 3.4 Run `pnpm exec openspec validate add-dashboard-worker-telemetry --strict`.
