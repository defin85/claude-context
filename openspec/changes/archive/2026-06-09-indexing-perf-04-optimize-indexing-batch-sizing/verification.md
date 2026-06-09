## Verification Summary

Implementation keeps the runtime default at the legacy behavior:

- `INDEX_EMBEDDING_BATCH_SIZE` defaults to `EMBEDDING_BATCH_SIZE` or `100`.
- `INDEX_INSERT_BATCH_SIZE` defaults to the effective embedding batch size.
- Values above `10000` are clamped by core config parsing.

The benchmark evidence does not justify a default change. The live BGE-M3
sidecar rejected `100/100` and `200/100` candidates with embedding-stage
`Cannot create a string longer than 0x1fffffe8 characters` failures on
`examples/demo-1c`. Candidate `50/50` completed `examples/demo-1c`, but the
larger `examples/demo-do30-1c` run was bounded and cancelled on timeout, so it is
not full larger-repository proof.

## Benchmark Candidates

All runs used:

- `INDEX_ACCELERATOR_MODE=auto`
- `INDEX_EMBEDDING_CONCURRENCY=4`
- `INDEX_INSERT_CONCURRENCY=1`
- `INDEX_INSERT_QUEUE_CAPACITY=2`
- `INDEX_ADAPTIVE_BACKPRESSURE=true`

| Codebase | Batch candidate | Artifact | Status | Cancelled | Wall ms | Submitted | Completed | Failed | Retried | Retry rate | Insert ms |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `examples/demo-1c` | `100/100` | `2026-06-08T18-26-25-599Z-auto-embbatch100-insertbatch100-insert1-adaptivetrue` | `indexfailed` | no | 78767 | 9 | 3 | 3 | 3 | 0.333 | 7354 |
| `examples/demo-1c` | `200/100` | `2026-06-08T18-27-51-148Z-auto-embbatch200-insertbatch100-insert1-adaptivetrue` | `indexfailed` | no | 61437 | 5 | 0 | 5 | 4 | 0.800 | 0 |
| `examples/demo-1c` | `50/50` | `2026-06-08T18-34-05-842Z-auto-embbatch50-insertbatch50-insert1-adaptivetrue` | `indexed` | no | 61473 | 18 | 18 | 0 | 0 | 0.000 | 26151 |
| `examples/demo-do30-1c` | `100/100` | `2026-06-08T18-29-00-237Z-auto-embbatch100-insertbatch100-insert1-adaptivetrue` | `indexing` | yes | 122097 | 675 | 3 | 672 | 6 | 0.009 | 4624 |
| `examples/demo-do30-1c` | `200/100` | `2026-06-08T18-31-09-119Z-auto-embbatch200-insertbatch100-insert1-adaptivetrue` | `indexing` | yes | 136790 | 316 | 0 | 308 | 4 | 0.013 | 0 |
| `examples/demo-do30-1c` | `50/50` | `2026-06-08T18-35-13-588Z-auto-embbatch50-insertbatch50-insert1-adaptivetrue` | `indexing` | yes | 134592 | 38 | 30 | 0 | 6 | 0.158 | 41079 |

## Interpretation

- `200/100` is rejected: it increases failed/retried embedding batches and does
  not reach insert work in either benchmark.
- `100/100` is retained only as the legacy default, not promoted as a measured
  improvement. The live run failed in the current sidecar environment.
- `50/50` is the only candidate that completed `examples/demo-1c`, and it made
  forward progress on `examples/demo-do30-1c` without failed batches before the
  bounded timeout. It is not selected as a new default because the larger run was
  intentionally bounded and retry rate was non-zero.
- Memory pressure was captured through accelerator adaptive pressure signals
  (`memoryFreePercent`). VRAM pressure was not present in these artifacts because
  managed BGE-M3 worker VRAM measurement was not enabled for the runs.

## Command Evidence

```bash
node scripts/measure-indexing-baseline.js --self-test-compact-output
pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts indexing-accelerator.test.ts embedding-batch-scheduler.test.ts
pnpm build:core
pnpm build:mcp
```
