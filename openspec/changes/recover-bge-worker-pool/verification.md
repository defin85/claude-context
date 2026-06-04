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
