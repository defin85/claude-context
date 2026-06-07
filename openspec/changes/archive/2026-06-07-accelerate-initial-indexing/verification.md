# Verification Notes

Date: 2026-06-05
Host timezone: Europe/Moscow

## Benchmark Scope

The representative large-repository baseline on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` was cancelled earlier after it proved impractical for an interactive verification run. That task remains open until a separate large run is explicitly approved.

The repair and comparison benchmark used the smaller repository requested for this pass:

`/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context`

The small benchmark repo currently produces 192 indexed files, 3648 chunks, and 114 embedding batches. The count increased from the earlier 191/3627 run because this fix and its tests changed the worktree before the final reruns.

## Root Cause

The accelerated BGE-M3 path used deterministic document IDs derived from `(relativePath, startLine, endLine, content)`. The AST splitter can emit identical chunks for a large file, so multiple chunks can legitimately have the same tuple.

Reproduction evidence before the fix:

- `scripts/verify-upstream-merge.ts` produced 365 chunks.
- Those chunks contained 364 unique generated IDs.
- Duplicate ID observed: `chunk_c091386e5682ad86` for two chunks with the same `startLine=1289`, `endLine=1346`, and content.
- In accelerated mode, identical chunks could land in the same Milvus `upsertBgeM3` request, causing `duplicate primary keys are not allowed in the same batch`.

## Fix

The indexing path now prepares each chunk before batching:

- preserve the existing deterministic ID for the first occurrence of a `(relativePath, startLine, endLine, content)` tuple;
- assign deterministic tie-breaker IDs to subsequent identical chunks using a duplicate ordinal;
- preserve all chunks instead of silently deduplicating them;
- store stable run-level `chunkIndex`;
- include `duplicateOrdinal` in stored metadata only for duplicate chunks.

## Tests

Commands run after the fix:

```bash
pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core typecheck
pnpm --filter @zilliz/claude-context-core lint
pnpm --filter @zilliz/claude-context-core build
pnpm --filter @zilliz/claude-context-mcp build
```

Results:

- `context.accelerator.test.ts`: 13/13 passing.
- Core typecheck: passed.
- Core lint: passed with existing warnings, no errors.
- Core build: passed.
- MCP build: passed.

Relevant test coverage:

- stable document IDs when accelerated batches complete out of order;
- BGE-M3 full metadata under reordered batch completion;
- duplicate identical chunks from one large file spanning 5 accelerated upsert batches;
- per-upsert primary key uniqueness;
- all duplicate chunks preserved with stable `chunkIndex`.

## Benchmark Runs

| Run | Configuration | Result |
| --- | --- | --- |
| Baseline | `INDEX_ACCELERATOR_MODE=off`, `INDEX_EMBEDDING_CONCURRENCY=2`, `INDEX_INSERT_CONCURRENCY=1`, `BGE_M3_ACCELERATOR_MAX_WORKERS=4`, managed workers enabled in env but accelerator disabled | Completed successfully: `indexed`, 192 files, 3648 chunks, 114/114 batches completed, 0 failed, 0 retried. Journal stats: `scanMs=34`, `splitMs=889`, `embeddingMs=0`, `insertMs=62497`. |
| Parallel batches, one worker | `INDEX_ACCELERATOR_MODE=auto`, `INDEX_EMBEDDING_CONCURRENCY=2`, `INDEX_INSERT_CONCURRENCY=1`, `BGE_M3_ACCELERATOR_MAX_WORKERS=1`, `BGE_M3_ACCELERATOR_MANAGED_WORKERS=false` | Completed successfully: `indexed`, 192 files, 3648 chunks, 114/114 batches completed, 0 failed, 0 retried. Journal stats: `scanMs=127`, `splitMs=811`, `embeddingMs=450401`, `insertMs=112048`. No `duplicate primary` or accelerated insert failure was observed. |
| Additional managed BGE-M3 workers | `INDEX_ACCELERATOR_MODE=auto`, `INDEX_INSERT_CONCURRENCY=1`, `BGE_M3_ACCELERATOR_MAX_WORKERS=4`, `BGE_M3_ACCELERATOR_MANAGED_WORKERS=true`, worker lifecycle `systemd` | Completed successfully: `indexed`, 192 files, 3648 chunks, 114/114 batches completed, 0 failed, 3 retried. Runtime status reached 4 active accepted workers (`8000-8003`) during the run. One worker was later rejected with `fetch failed`, and retry handling drained the workload successfully. Journal stats: `scanMs=155`, `splitMs=955`, `embeddingMs=482119`, `insertMs=161381`. No `duplicate primary` or accelerated insert failure was observed. |

## Large Baseline Evidence

Task 1.4 is now closed based on the later representative 1C baseline run requested for comparison work:

- Codebase: `/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-do30-1c`
- Artifact directory: `.artifacts/indexing-baselines/2026-06-07T12-50-21-375Z-off-demo-do30`
- Configuration: `INDEX_ACCELERATOR_MODE=off`, `activeWorkers=1`
- Last normal progress sample before user-requested cancellation: `688/6595` files, `18%`, elapsed `1746280ms` (`~29m06s`)
- Final cancelled sample: `indexfailed` by explicit stop, elapsed `1751287ms` (`~29m11s`), `submittedBatches=445`, `completedBatches=445`, `failedBatches=0`, `retriedBatches=0`, `backpressureWaitMs=0`
- Working interpretation for comparison: off-mode baseline is approximately `20%` in `30 minutes` on this larger 1C sample.

The earlier `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` baseline remains a useful stress-run artifact but was too long for interactive completion. Its stopped artifact is `.artifacts/indexing-baselines/2026-06-06T17-06-21-298Z-off/`.

Managed-worker journal check since daemon restart showed only transient worker `fetch failed` warnings plus:

- `Accelerator stats: submitted=114, completed=114, failed=0, ...`
- `Codebase indexing completed! Processed 192 files in total, generated 3648 code chunks`

## Runtime Restoration

Runtime configuration was restored to the normal accelerated setting:

- `INDEX_ACCELERATOR_MODE=auto`
- `INDEX_EMBEDDING_CONCURRENCY=2`
- `INDEX_INSERT_CONCURRENCY=1`
- `BGE_M3_ACCELERATOR_MAX_WORKERS=4`
- `BGE_M3_ACCELERATOR_MANAGED_WORKERS=true`
- `BGE_M3_ACCELERATOR_WORKER_LIFECYCLE=systemd`

The daemon was restarted after restoring the env, and the small benchmark repo is `indexed`.

## Remaining Open Item

None for this change. The large disabled-accelerator baseline was captured as a stopped baseline artifact and is sufficient for this change's performance comparison scope.
