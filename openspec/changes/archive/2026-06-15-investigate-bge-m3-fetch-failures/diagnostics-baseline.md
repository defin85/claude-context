## Baseline Evidence

Source change: `openspec/changes/indexing-perf-08-write-coalescing-and-backpressure-tuning`.

### Qdrant insert concurrency 2

Artifact:
`benchmark-artifacts/2026-06-14T10-39-32-917Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert2-adaptivetrue/`

- Bounded window: `604926ms`, cancelled on timeout.
- Retrieval mode: BGE-M3 full; 1C scope profile: `full`.
- Payload caps: `INDEX_EMBEDDING_MAX_CONTENT_CHARS=20000`, `INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS=5000`.
- Workers: `maxBgeM3Workers=4`.
- Qdrant write policy: configured/effective insert concurrency `2/2`, coalescing enabled.
- Insert evidence: `completedInsertBatches=301`, `failedInsertBatches=0`, final insert backlog `0`.
- Retry evidence: `retriedBatches=24`, all `retryReasons.embedding_error`, `retrySafeFailures=24`, `retryUnsafeFailures=0`.
- Final pressure: `adaptiveThrottleReason=retry_rate`, throttle time `405709ms`.
- Worker evidence: all workers were accepted in the final sample, but each worker had `lastFailureAt` and `recoveryAttempts`:
  - `8000`: `recoveryAttempts=6`
  - `8001`: `recoveryAttempts=6`
  - `8002`: `recoveryAttempts=7`
  - `8003`: `recoveryAttempts=5`

### Qdrant insert concurrency 4

Artifact:
`benchmark-artifacts/2026-06-14T10-49-58-441Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert4-adaptivetrue/`

- Bounded window: `607710ms`, cancelled on timeout.
- Retrieval mode: BGE-M3 full; 1C scope profile: `full`.
- Payload caps: `INDEX_EMBEDDING_MAX_CONTENT_CHARS=20000`, `INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS=5000`.
- Workers: `maxBgeM3Workers=4`.
- Qdrant write policy: configured/effective insert concurrency `4/4`, coalescing enabled.
- Insert evidence: `completedInsertBatches=291`, `failedInsertBatches=0`, final insert backlog `0`.
- Retry evidence: `retriedBatches=22`, all `retryReasons.embedding_error`, `retrySafeFailures=22`, `retryUnsafeFailures=0`.
- Final pressure: `adaptiveThrottleReason=retry_rate`, throttle time `402823ms`.
- Worker evidence: all workers were accepted in the final sample, but each worker had `lastFailureAt` and `recoveryAttempts`:
  - `8000`: `recoveryAttempts=3`
  - `8001`: `recoveryAttempts=4`
  - `8002`: `recoveryAttempts=8`
  - `8003`: `recoveryAttempts=7`

### Journal excerpts

`journalctl --user-unit claude-context-mcp-daemon --since '2026-06-14 13:35:00' --until '2026-06-14 14:05:00'`
showed repeated pairs like:

- `[WARN] [BGE-M3] Rejected worker http://127.0.0.1:8001: embedding_error fetch failed`
- `[LOG] [BGE-M3] Worker http://127.0.0.1:8001 recovered and returned to the embedding pool.`

The same pattern appeared for workers `8000`, `8001`, `8002`, and `8003`.

## Current Lost Client-Side Fields

Current fetch path before this change:

- `packages/core/src/embedding/bge-m3-embedding.ts`
- `embedMultiBatchWithWorkerPool()` calls `withWorkerRetry()`.
- `withWorkerRetry()` calls `post(worker, '/embed_batch', ...)`.
- `post()` calls `fetchImpl()`, throws a generic HTTP error for non-OK responses, and lets low-level fetch errors bubble up.
- `classifyFailure()` reduces the result to `EmbeddingWorkerFailureReason`, `retrySafe`, and `message`.

Fields unavailable before this change:

- low-level `error.cause.name`, `error.cause.code`, and `error.cause.message`;
- request id for correlating TypeScript client and Python sidecar;
- request duration;
- retry attempt;
- logical batch id;
- chunk count, content character count, estimated token count, and payload byte size;
- retrieval mode and payload limits attached to the failed request;
- failure category such as `fetch_failed`, `http_error`, `timeout`, `cancellation`, or `parse_error`;
- per-worker last failed request reference after recovery.

## Current Lost Sidecar Fields

Current sidecar path before this change:

- `python/bge_m3_sidecar.py`
- FastAPI `/embed_batch` calls `get_service().embed_batch(request.inputs, mode=request.mode)`.
- failures are returned as `HTTPException(status_code=500, detail=str(exc))`.

Fields unavailable before this change:

- sidecar request id;
- request duration;
- sanitized request shape;
- success/failure status for `/embed_batch`;
- failure phase;
- Python exception class and sanitized message in structured logs;
- correlation with TypeScript fetch-failure evidence.
