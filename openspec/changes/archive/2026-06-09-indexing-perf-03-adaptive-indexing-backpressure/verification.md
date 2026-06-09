## Verification

Date: 2026-06-08

## Unit and Build Gates

Commands run:

```bash
pnpm --filter @zilliz/claude-context-core test -- embedding-batch-scheduler.test.ts indexing-accelerator.test.ts context.accelerator.test.ts
node scripts/measure-indexing-baseline.js --self-test-compact-output
pnpm build
pnpm build:core && pnpm typecheck
pnpm lint
pnpm exec openspec validate indexing-perf-03-adaptive-indexing-backpressure --strict
```

Results:

- Core focused scheduler/config/context tests: 39 passed.
- Benchmark compact-output self-test: passed.
- `pnpm build`: passed. Chrome extension webpack still reports existing asset-size warnings for icon PNGs.
- `pnpm build:core && pnpm typecheck`: passed. The core declaration refresh is
  needed because the MCP package typechecks against the built core package
  declarations.
- `pnpm lint`: passed with existing warnings, 0 errors.
- OpenSpec strict validation: passed.

Additional closure evidence:

- Focused tests now cover measured VRAM pressure propagation into adaptive
  pressure signals and the default `Context` indexing path.

## Live Benchmark Evidence

Artifact root:

- `.artifacts/indexing-perf-03`

Common profile:

- `INDEX_ACCELERATOR_MODE=auto`
- `INDEX_EMBEDDING_CONCURRENCY=4`
- `INDEX_INSERT_CONCURRENCY=1`
- `INDEX_INSERT_QUEUE_CAPACITY=2`
- `BGE_M3_ACCELERATOR_MANAGED_WORKERS=true`
- `BGE_M3_ACCELERATOR_MAX_WORKERS=4`
- Static runs use `INDEX_ADAPTIVE_BACKPRESSURE=false`.
- Adaptive runs use `INDEX_ADAPTIVE_BACKPRESSURE=true`.

### `examples/demo-1c`

`demo-1c` completed in all runs. Adaptive mode did not throttle this small run
after warmup tuning (`effectiveMin=4`, `throttleEvents=0`), which avoids
wall-clock regression while keeping backpressure comparable.

| Mode | Artifact | Status | Wall ms | Retries | Backpressure ms | Effective min/max | Throttle events |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| static | `2026-06-08T14-46-00-184Z-auto-insert1-adaptivefalse` | `indexed` | 73001 | 1 | 23767 | 4/4 | 0 |
| static | `2026-06-08T15-07-01-968Z-auto-insert1-adaptivefalse` | `indexed` | 72634 | 2 | 24054 | 4/4 | 0 |
| adaptive | `2026-06-08T15-01-23-112Z-auto-insert1-adaptivetrue` | `indexed` | 73747 | 1 | 23682 | 4/4 | 0 |
| adaptive | `2026-06-08T15-05-23-252Z-auto-insert1-adaptivetrue` | `indexed` | 71724 | 2 | 23904 | 4/4 | 0 |

Two-sample averages:

| Mode | Avg wall ms | Avg retries | Avg backpressure ms |
| --- | ---: | ---: | ---: |
| static | 72818 | 2 | 23911 |
| adaptive | 72736 | 2 | 23793 |

### `examples/demo-do30-1c`

`demo-do30-1c` was intentionally bounded and cancelled on timeout to avoid a
long full benchmark. The adaptive sample exercised insert-backlog throttling and
recorded effective concurrency range and throttle time in the summary.

| Mode | Artifact | Status | Cancelled | Wall ms | Completed batches | Retries | Backpressure ms | Insert ms | Effective min/max | Throttle |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| static | `2026-06-08T14-48-49-997Z-auto-insert1-adaptivefalse` | `indexing` | yes | 130375 | 50 | 1 | 78188 | 73765 | 4/4 | none |
| adaptive | `2026-06-08T15-02-44-788Z-auto-insert1-adaptivetrue` | `indexing` | yes | 130458 | 46 | 1 | 79540 | 64182 | 1/4 | `insert_backlog`, 34282ms |

Notes:

- `demo-do30-1c` confirms adaptive benchmark summaries persist throttle reason,
  throttle time, and effective concurrency range.
- In this bounded sample, insert time improved and wall-clock stayed effectively
  flat. The sample does not prove reduced backpressure or retry churn:
  `backpressureWaitMs` was higher in the adaptive run, retries were equal, and
  completed batches were lower in the adaptive timeout window. Treat this run as
  throttle-observability and insert-backlog evidence, not as a completed
  throughput win.
