## Verification

Date: 2026-06-05

### Targeted Checks

- `pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts embedding-batch-scheduler.test.ts --runInBand`
  - Passed: 20 tests.
  - Covers bounded scheduler behavior, insert-slot separation, cancellation, retry/status metrics, BGE-M3 worker capacity, rejected worker scheduling, duplicate document ids, and cancellation without unhandled batch rejections.
- `pnpm --filter @zilliz/claude-context-core typecheck`
  - Passed.
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
  - Passed.
- `pnpm --filter @zilliz/claude-context-core build && pnpm --filter @zilliz/claude-context-mcp build`
  - Passed.
- `pnpm --filter @zilliz/claude-context-core lint`
  - Passed with existing warnings only: 86 warnings, 0 errors.
- `pnpm exec openspec validate parallel-embedding-batch-scheduler --strict`
  - Passed.
- `git diff --check`
  - Passed.

### Large 1C Cold Smoke

Target: `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd`

Setup:

- Cleared existing codebase index with `clear_index`.
- Started cold indexing through the MCP daemon with `index_codebase`.
- The daemon started 3 managed BGE-M3 workers in addition to the primary endpoint.
- VRAM planning snapshot before worker start: total `16311MiB`, used `3958MiB`, budget `12233MiB`, planned workers `3`, started workers `3`.

Observed accelerator snapshot during the smoke:

- `active=true`
- `embeddingConcurrency=4`
- `insertConcurrency=1`
- `queuedBatches=4`
- `runningEmbeddingBatches=4`
- `runningInsertBatches=1`
- `submittedBatches=81`
- `completedBatches=48`
- `failedBatches=0`
- `retriedBatches=5`
- `activeWorkers=2`
- `rejectedWorkers=2`
- `backpressureWaitMs=94556`
- Progress reached `12%`, `421/18686` files.
- Pre-index completed with `18686` selected and hashed files.
- GPU memory during active embedding was about `9250MiB / 16311MiB`.

Worker observations:

- Worker endpoints `8001`, `8002`, and `8003` were managed by systemd.
- Worker `8000` and later `8002` were rejected with `fetch failed`.
- Scheduling continued on healthy workers while retry accounting increased.
- Worker `8001` recovered during the run.

The smoke was intentionally stopped after collecting scheduler evidence. The pre-fix cancellation path exposed an unhandled `WorkloadCancelledError` that restarted the daemon. This was fixed by attaching immediate handlers to accelerated batch completions and rethrowing captured batch errors only after drain. A regression test now verifies cancellation without unhandled batch rejections.

Runtime after fix:

- Rebuilt `@zilliz/claude-context-core` and `@zilliz/claude-context-mcp`.
- Restarted `claude-context-mcp.service`.
- Fresh daemon PID after restart: `1259741`.

### Insert Concurrency Lever

Date: 2026-06-06

Target: `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd`

Setup:

- Restarted the daemon with `INDEX_INSERT_CONCURRENCY=2`.
- Cleared the target codebase index.
- Started a fresh cold indexing run through the MCP daemon.
- Managed BGE-M3 sidecars were active on ports `8001`, `8002`, and `8003`.

Observed live snapshot during the run:

- `insertConcurrency=2`
- `submittedBatches=490`
- `completedBatches=480`
- `failedBatches=0`
- `retriedBatches=38`
- `queuedBatches=4`
- `runningEmbeddingBatches=4`
- `runningInsertBatches=2`
- `activeWorkers=4`
- `rejectedWorkers=0`
- `backpressureWaitMs=593192`
- Managed workers running: `3`
- GPU: `10014MiB / 16311MiB`, utilization `99%`

Warmed sample comparison:

- With `INDEX_INSERT_CONCURRENCY=2`, completed batches increased from `271` to `364` over about `121s`, roughly `0.77` batch/s.
- The previous `insertConcurrency=1` warmed sample completed about `55` batches over about `122s`, roughly `0.45` batch/s.
- Insert lane time increased by about `181s` over the `121s` sample window, so insert parallelism was used but did not stay at both lanes continuously.
- Embedding lane time increased by about `486s` over the same `121s`, which matches four saturated embedding workers.

Conclusion:

- Two insert lanes improved warmed throughput on the large 1C smoke by about `70%` versus the previous single-insert-lane sample.
- The next bottleneck shifted back toward embedding worker throughput rather than Milvus insert serialization.
- Auto mode now defaults `INDEX_INSERT_CONCURRENCY` to `2`; non-auto mode keeps the conservative default of `1`.
