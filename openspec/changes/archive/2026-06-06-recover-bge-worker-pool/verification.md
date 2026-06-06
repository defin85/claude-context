## Verification Notes

### Focused checks run

- `pnpm --filter @zilliz/claude-context-core test -- embedding/bge-m3-embedding.test.ts --runInBand`
  - Assertions passed: 8/8.
- `pnpm --filter @zilliz/claude-context-core test -- context.ignore-patterns.test.ts --runInBand`
  - Assertions passed: 10/10.
  - Process exited 129 after PASS with `free(): invalid pointer`, matching the existing native teardown issue seen in core context tests.
- `pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts --runInBand --forceExit`
  - Assertions passed: 9/9.
  - Process exited 129 after PASS with `free(): invalid pointer`, matching the existing native teardown issue seen in core context tests.
- `pnpm --filter @zilliz/claude-context-core typecheck`
- `pnpm --filter @zilliz/claude-context-core build`
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
- `pnpm --filter @zilliz/claude-context-mcp build`

### Large-repo CODE_CHUNK_LIMIT retry guidance

If a previous force indexing run completed with `status=limit_reached`, the indexed collection remains searchable but partial. Raising `CODE_CHUNK_LIMIT` only affects subsequent indexing runs; it does not add chunks skipped by the earlier lower-limit run.

Operational retry path:

1. Raise `CODE_CHUNK_LIMIT` to the intended cap.
2. Restart the MCP daemon or start a new runtime so the new environment value is used.
3. Run `index_codebase` with `force=true` for the target repository.
4. Watch indexing status for `accelerator.codeChunkLimit`, `accelerator.limitReached`, indexed chunk count, and final `indexStatus`.
5. Treat `indexStatus=limit_reached` as a partial but searchable result; raise the limit again and repeat force reindex if the skipped tail must be included.

### Live worker recovery smoke

`http://127.0.0.1:8000/health` is currently reachable, but `http://127.0.0.1:8001/health` is not. A live smoke that temporarily rejects and then recovers an extra BGE-M3 sidecar requires starting a second sidecar and intentionally interrupting one `/embed_batch` request. This was not run in this implementation pass.

### Follow-up live recovery evidence

Date: 2026-06-06

A later full indexing run on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` exercised the worker recovery path with the primary worker plus managed sidecars on `8001`, `8002`, and `8003`.

Observed `get_indexing_status` snapshot:

- `status=indexing`
- `progressPercentage=31`
- `progressDetails.current=4830`
- `progressDetails.total=18686`
- `failedBatches=0`
- `retriedBatches=134`
- `activeWorkers=4`
- `rejectedWorkers=0`
- `http://127.0.0.1:8001`: `poolState=accepted`, `healthy=true`, `lastFailureAt=2026-06-06T10:37:09.509Z`, `lastSuccessAt=2026-06-06T10:44:35.804Z`, `recoveryAttempts=32`
- `http://127.0.0.1:8002`: `poolState=accepted`, `healthy=true`, `lastFailureAt=2026-06-06T10:44:31.294Z`, `lastSuccessAt=2026-06-06T10:44:31.323Z`, `recoveryAttempts=33`
- `http://127.0.0.1:8003`: `poolState=accepted`, `healthy=true`, `lastFailureAt=2026-06-06T10:42:39.239Z`, `lastSuccessAt=2026-06-06T10:44:32.858Z`, `recoveryAttempts=36`

This confirms that extra sidecars were temporarily rejected after live request failures and then recovered into the accepted worker pool during the same long indexing job.
