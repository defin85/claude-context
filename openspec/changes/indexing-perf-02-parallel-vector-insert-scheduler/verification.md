## Verification

Date: 2026-06-08

## Unit and Integration Tests

Commands run:

```bash
pnpm --filter @zilliz/claude-context-core test -- embedding-batch-scheduler.test.ts context.accelerator.test.ts indexing-accelerator.test.ts bge-m3-embedding.test.ts --runInBand
node scripts/measure-indexing-baseline.js --self-test-compact-output
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/worker-planning-policy.test.ts
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/snapshot-progress.test.ts
pnpm exec openspec validate indexing-perf-02-parallel-vector-insert-scheduler --strict
pnpm lint && pnpm typecheck && pnpm build
```

Results:

- Core focused tests: 47 passed.
- Benchmark compact-output self-test: passed.
- MCP worker planning policy test: 8 passed.
- MCP snapshot progress test: 1 passed.
- OpenSpec strict validation: passed.
- `pnpm lint`: passed with existing warnings, 0 errors.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; Chrome extension webpack still reports existing asset-size warnings.

## Write Semantics Audit

- SDK Milvus adapter:
  - `packages/core/src/vectordb/milvus-vectordb.ts`
  - `insertBgeM3()` uses `client.insert()` and `flushSync()`.
  - `upsertBgeM3()` uses SDK `client.upsert()` when available and `flushSync()`.
- REST Milvus adapter:
  - `packages/core/src/vectordb/milvus-restful-vectordb.ts`
  - `insertBgeM3()` calls `/entities/insert`.
  - `upsertBgeM3()` calls `/entities/upsert`.
- Accelerated BGE-M3 context path:
  - `packages/core/src/context.ts`
  - `prepareChunkBatchInsert()` sets `useBgeM3Upsert` only when accelerator is active and the vector DB exposes `upsertBgeM3`.
  - Plain insert errors are wrapped as `Indexing batch <id> failed during insert: ...` and are not retried by the insert scheduler.

## Live Benchmark Evidence

Artifact root:

- `.artifacts/indexing-perf-02`

Runs:

| Codebase | Insert concurrency | Artifact | Final status | Window | Completed inserts | Failed inserts | Insert ms | Backpressure ms |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `examples/demo-1c` | 1 | `2026-06-08T08-39-39-233Z-auto-insert1` | `indexed` | 67.5s | 27 | 0 | 30044 | 47065 |
| `examples/demo-1c` | 2 | `2026-06-08T08-41-33-791Z-auto-insert2` | `indexed` | 66.1s | 26 | 0 | 29127 | 46504 |
| `examples/demo-do30-1c` | 1 | `2026-06-08T08-43-40-378Z-auto-insert1` | `indexing`, cancelled on timeout | 100.9s | 39 | 0 | 43342 | 82537 |
| `examples/demo-do30-1c` | 2 | `2026-06-08T08-45-41-508Z-auto-insert2` | `indexing`, cancelled on timeout | 99.6s | 36 | 0 | 38976 | 78828 |

Notes:

- `demo-1c` completed in both candidate runs.
- `demo-do30-1c` was intentionally bounded and cancelled at about 10% progress in both candidate runs to avoid a long full benchmark.
- `summary.json` stores top-level `insertSummary` and `lastAcceleratorStructuredContent`; samples are filtered to the measured codebase so daemon background-sync accelerator snapshots do not replace target benchmark metrics.
