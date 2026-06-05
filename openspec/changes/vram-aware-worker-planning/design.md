## Context

Managed BGE-M3 workers are started by the MCP daemon when initial indexing needs the full BGE-M3 retrieval pipeline. Full BGE-M3 is more expensive than dense-only embedding because each worker produces dense vectors, model sparse weights, and ColBERT token vectors. The current manager has a static endpoint plan bounded by `BGE_M3_ACCELERATOR_MAX_WORKERS`; it checks VRAM before and after each worker, but it does not estimate how many workers can fit in the configured VRAM budget before starting them.

Observed local behavior shows one BGE-M3 full worker using about 1.8 GiB VRAM, while the configured 75% budget on a 16 GiB GPU leaves enough room for more than the two currently configured workers. The daemon needs a planning layer that turns current VRAM availability and measured worker cost into a bounded worker count.

## Goals / Non-Goals

**Goals:**

- Plan managed BGE-M3 worker count from current VRAM usage, total VRAM, configured limit percent, maximum worker count, and safety margin.
- Calibrate worker VRAM cost by measuring before and after each successful worker startup.
- Reuse calibration for future runs with the same model, mode, fp16 setting, device, and lifecycle-relevant configuration.
- Expose planning decisions in daemon/operator status for diagnostics.
- Keep the runtime pressure monitor as a hard safety guard after workers start.

**Non-Goals:**

- Do not change dense-only BGE-M3, full BGE-M3 output semantics, Milvus schema, or retrieval ranking.
- Do not change embedding batch size or implement dynamic batch-size autotuning.
- Do not make background sync use accelerated workers unless existing config enables it.
- Do not require a GPU when VRAM metrics are unavailable and unmeasured VRAM is disallowed.

## Decisions

### Use a sequential measured planner

The manager will compute an initial worker plan before startup:

`budgetMiB = floor(totalMiB * limitPercent / 100)`

`freeBudgetMiB = budgetMiB - usedMiB - safetyMarginMiB`

`managedWorkerLimit = max(0, maxWorkers - 1 - configuredWorkerEndpoints.length)`

`plannedWorkers = min(managedWorkerLimit, floor(freeBudgetMiB / estimatedWorkerMiB))`

The primary `BGE_M3_ENDPOINT` and manually configured `BGE_M3_WORKER_ENDPOINTS` count against `BGE_M3_ACCELERATOR_MAX_WORKERS`. VRAM planning only controls additional managed workers.

Workers will still start sequentially. After each healthy worker, the manager reads VRAM again, computes actual delta, updates the estimate, and recomputes whether another worker can fit. This avoids overcommitting when the estimate is stale.

Alternative considered: start workers until VRAM crosses the limit and then stop the last one. That gives simpler code but creates avoidable pressure spikes and noisy failures.

### Plan at indexing start, not daemon startup

The manager will defer VRAM planning until `ensureStarted()` is called for an initial or force indexing workload. Daemon startup may create the manager and validate static preconditions, but it must not permanently decide the managed worker count from startup VRAM. This keeps the baseline tied to the actual indexing request.

The current `BgeM3Embedding` constructor receives worker endpoints once, so implementation must also update the embedding worker pool after managed workers start. Add an explicit method on `BgeM3Embedding` to register managed worker endpoints after startup, for example `registerWorkerEndpoints(endpoints: string[]): void`. The method must normalize endpoints, preserve the primary endpoint, deduplicate existing endpoints, and initialize new workers as pending health-check candidates. Do not recreate the whole MCP `Context` for this, because that would unnecessarily disturb codebase sessions and vector database state.

Alternative considered: append planned endpoints to config during daemon startup. That is the current static approach and would preserve stale VRAM decisions, so it does not satisfy this change.

### Store lightweight calibration by worker profile

The calibration key will include model, BGE-M3 mode, fp16 flag, device, and worker lifecycle. The value will store the latest measured worker delta and enough metadata to debug staleness. The first run will use a conservative default estimate when no calibration exists. Persist calibration under `~/.context/mcp/bge-m3-worker-vram.json` so it survives daemon restarts without being tied to one runtime pid.

Alternative considered: no persisted calibration. That is safer from stale data but wastes every cold run on overly conservative defaults.

### Keep explicit maximum worker count

`BGE_M3_ACCELERATOR_MAX_WORKERS` remains the upper bound. VRAM planning chooses up to this limit; it does not override operator intent.

Alternative considered: derive max solely from VRAM. That risks saturating GPU compute or overloading downstream insert throughput on machines where memory is not the bottleneck.

### Expose planning telemetry

Managed worker snapshots will include total VRAM, used VRAM before planning, budget, safety margin, estimated worker MiB, planned workers, started workers, calibration source, and rejection/fallback reason. This lets `get_daemon_status` and debugging output explain why more workers were or were not started.

### Use a fixed conservative safety margin

The default safety margin will be 1024 MiB, with an optional environment override. This is large enough to absorb CUDA allocator noise and desktop GPU usage on the observed 16 GiB local GPU while still allowing additional workers when budget is clearly available.

### Preserve current runtime pressure behavior

Planning is predictive, not authoritative. The existing pressure monitor remains the final guard and stops managed workers if actual runtime usage exceeds the configured limit.

## Risks / Trade-offs

- [Risk] Worker VRAM cost can vary with model mode, fp16, CUDA allocator behavior, and process startup timing. -> Mitigation: measure after every worker startup, update calibration, and keep a safety margin.
- [Risk] More workers can increase GPU utilization but expose another bottleneck such as file splitting, Milvus inserts, or CPU scheduling. -> Mitigation: keep `BGE_M3_ACCELERATOR_MAX_WORKERS`, embedding concurrency, and insert concurrency as explicit caps.
- [Risk] Persisted calibration can become stale after model or environment changes. -> Mitigation: use a profile key that includes model/mode/fp16/device and allow the next measured startup to replace the estimate.
- [Risk] VRAM telemetry can be unavailable on non-NVIDIA systems or misconfigured hosts. -> Mitigation: preserve existing fail-closed behavior unless `BGE_M3_ACCELERATOR_ALLOW_UNMEASURED_VRAM=true`.

## Migration Plan

No indexed collection migration is required. Deploy by rebuilding MCP/core packages and restarting the daemon. Existing operators can keep their current environment variables; the planner will use existing max-worker and VRAM-limit settings, with any new safety-margin setting defaulting conservatively.

Rollback is to disable managed workers or revert to the previous static endpoint planning behavior. Existing indexes remain compatible either way.

## Open Questions

None.
