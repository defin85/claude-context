## 1. Planning Model

- [x] 1.1 Add typed VRAM planning and calibration data structures to the managed BGE-M3 worker manager.
- [x] 1.2 Add a conservative default per-worker VRAM estimate and configurable safety margin.
- [x] 1.3 Implement worker profile keying by model, BGE-M3 mode, fp16 setting, device, and lifecycle.
- [x] 1.4 Make primary `BGE_M3_ENDPOINT` and static `BGE_M3_WORKER_ENDPOINTS` count against the managed worker budget.
- [x] 1.5 Add unit coverage for budget math, max-worker caps, exhausted budget, and unmeasured VRAM fail-closed behavior.

## 2. Calibration Persistence

- [x] 2.1 Implement lightweight calibration cache loading for matching worker profiles.
- [x] 2.2 Persist measured worker VRAM deltas after successful healthy worker startup.
- [x] 2.3 Add tests for matching calibration reuse, default estimate fallback, and stale-profile isolation.

## 3. Worker Startup Integration

- [x] 3.1 Defer VRAM-aware planning until `ensureStarted()` is called for an initial or force indexing workload.
- [x] 3.2 Replace daemon-startup static endpoint planning with request-time sequential planning bounded by `BGE_M3_ACCELERATOR_MAX_WORKERS`.
- [x] 3.3 Recompute remaining budget after each worker startup using measured VRAM deltas.
- [x] 3.4 Stop and reject a newly started worker when post-startup VRAM usage exceeds the configured limit.
- [x] 3.5 Add `BgeM3Embedding.registerWorkerEndpoints(endpoints: string[]): void` to normalize, deduplicate, and append newly started managed endpoints to the active worker pool.
- [x] 3.6 Call `registerWorkerEndpoints()` after request-time managed worker startup succeeds for an indexing workload.
- [x] 3.7 Preserve existing runtime pressure monitor behavior after workers are started.

## 4. Status and Diagnostics

- [x] 4.1 Extend managed worker snapshots with VRAM budget, baseline usage, estimate, calibration source, planned count, started count, and stop/fallback reason.
- [x] 4.2 Surface planning telemetry through daemon/operator status without exposing secrets or daemon tokens.
- [x] 4.3 Add log lines that explain why the manager started fewer workers than the configured maximum.
- [x] 4.4 Add tests proving `registerWorkerEndpoints()` preserves the primary endpoint, deduplicates endpoints, and makes managed endpoints visible to BGE-M3 batch embedding after request-time startup.

## 5. Verification

- [x] 5.1 Run focused MCP managed-worker tests and core accelerator tests.
- [x] 5.2 Run `pnpm build` and `pnpm typecheck`.
- [x] 5.3 Restart the daemon and run a fresh initial indexing smoke on a large repo to confirm worker planning and VRAM telemetry are visible.
