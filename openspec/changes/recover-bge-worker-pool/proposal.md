## Why

During a large BGE-M3 force indexing run, an extra managed sidecar continued running and serving health/metadata, but the embedding worker pool reported one rejected worker and stopped sending embedding batches to it after a transient failure. The same run also hit `CODE_CHUNK_LIMIT=450000`, which is configurable but not surfaced clearly enough as an expected limit-reached outcome.

## What Changes

- Add recoverable BGE-M3 worker-pool behavior: unhealthy extra workers are periodically revalidated with `/health` and `/metadata` and can return to service without restarting the whole MCP daemon.
- Log and expose per-worker rejection reason, last failure time, last successful request time, and recovery attempts in accelerator/indexing status.
- Keep strict worker equivalence validation for BGE-M3 full mode so recovered workers still match model, mode, precision, max token policy, and preprocessing profile.
- Treat `CODE_CHUNK_LIMIT` as a visible indexing configuration and completion status: report configured limit, whether it was reached, and how many chunks/files were indexed before stopping.
- Document and validate the existing `CODE_CHUNK_LIMIT` override path instead of changing retrieval behavior or silently raising default limits.
- Non-goals: no changes to BGE-M3 retrieval ranking, Milvus schema, vector contents, or collection migration; no automatic exclusion of 1C report/form files in this change; no native/Rust worker implementation.

## Capabilities

### New Capabilities

- `bge-worker-recovery`: Covers recoverable BGE-M3 worker-pool health, rejection diagnostics, and status visibility.
- `indexing-limit-observability`: Covers explicit reporting and validation of chunk-limit configuration and limit-reached indexing outcomes.

### Modified Capabilities

- None.

## Impact

- Affected code: `packages/core/src/embedding/bge-m3-embedding.ts`, accelerator snapshots/status in `packages/core/src/indexing-accelerator.ts` and `packages/core/src/context.ts`, MCP indexing status handlers, and config/logging for `CODE_CHUNK_LIMIT`.
- Affected APIs: MCP status payloads may gain additional optional diagnostic fields. Existing `index_codebase` and `search_code` request formats remain backward compatible.
- Migration impact: no migration for existing indexed collections or merkle snapshots. Existing partial indexes created with a lower chunk limit remain valid but may need force reindexing after raising `CODE_CHUNK_LIMIT` to include more chunks.
- Operational impact: extra BGE-M3 workers should recover from transient request failures during long indexing jobs, improving sustained embedding throughput. Chunk-limit hits should be obvious and configurable rather than looking like an unexpected stop.
