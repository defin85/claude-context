## Why

Initial BGE-M3 indexing can leave available GPU memory unused because the daemon starts only a static maximum number of managed workers. On large cold indexing runs, the daemon should choose a worker count from the current VRAM budget and measured worker cost so the pipeline can scale without requiring manual tuning for each machine.

## What Changes

- Add VRAM-aware planning for managed BGE-M3 workers during initial and force indexing.
- Measure GPU memory before worker startup, estimate how many workers fit within `BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT`, and start only that many workers.
- Calibrate per-worker VRAM cost after each successful worker startup and reuse the estimate for future planning.
- Expose worker-planning telemetry in daemon/operator status so users can see the budget, estimate, planned worker count, started worker count, and stop reason.
- Keep runtime pressure monitoring as a guardrail that stops managed workers if actual VRAM usage crosses the configured limit.
- Non-goals:
  - Do not change BGE-M3 embedding semantics, retrieval schema, or indexed document format.
  - Do not require GPU-specific dependencies beyond the existing `nvidia-smi` probing path.
  - Do not auto-tune embedding batch size in this change.
  - Do not accelerate background sync unless explicitly enabled by existing configuration.

## Capabilities

### New Capabilities

- `vram-aware-worker-planning`: Managed BGE-M3 worker planning based on current VRAM budget, measured worker cost, and explicit safety margins.

### Modified Capabilities

None.

## Impact

- Affected code:
  - `packages/mcp/src/bge-m3-managed-workers.ts`
  - MCP daemon status/snapshot surfaces that expose managed worker state
  - BGE-M3 managed worker tests
- Configuration impact:
  - Reuses existing `BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT`, `BGE_M3_ACCELERATOR_MAX_WORKERS`, and managed worker lifecycle settings.
  - May add optional safety-margin and calibration-cache environment variables if needed.
- Migration impact for existing indexed collections:
  - No collection migration is required.
  - Existing indexes remain searchable because only worker startup planning changes.
  - A force reindex is needed only to observe the new planning behavior on a fresh initial indexing run.
