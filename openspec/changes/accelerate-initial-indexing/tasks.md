## 1. Baseline and Configuration

- [x] 1.1 Add accelerator configuration parsing for mode, embedding concurrency, insert concurrency, maximum BGE-M3 workers, VRAM budget, retry budget, and background-sync policy.
- [x] 1.2 Add startup/config summary logging that reports accelerator settings without exposing secrets.
- [x] 1.3 Add benchmark or diagnostic logging for scan/split time, embedding batch time, insert time, in-flight batch counts, and retry counts.
- [ ] 1.4 Capture a baseline indexing run on a representative large repository with acceleration disabled.

## 2. Parallel Batch Pipeline

- [x] 2.1 Refactor `processFileList` so chunk batches can be submitted to a bounded asynchronous embedding pipeline instead of awaited one at a time.
- [x] 2.2 Preserve sequential file scanning and splitter behavior while allowing embedding/insert work to drain concurrently.
- [x] 2.3 Add stable batch metadata for file ranges, chunk counts, retry attempts, and progress accounting.
- [x] 2.4 Keep sequential behavior when accelerator mode is off or embedding concurrency is `1`.
- [x] 2.5 Add cancellation handling that stops queued batches and waits for active batches to settle safely.

## 3. BGE-M3 Worker Pool

- [x] 3.1 Add a BGE-M3 worker abstraction that can call `/health`, `/metadata`, `/embed`, and `/embed_batch` on a specific endpoint.
- [x] 3.2 Extend sidecar metadata and validation so workers only join the pool when model, model revision when available, mode, outputs, dimension, precision setting, max token policy, and preprocessing profile match the primary worker.
- [x] 3.3 Add optional managed worker startup for additional local BGE-M3 sidecars on available loopback ports.
- [x] 3.4 Add VRAM budget checks before and after worker startup, with conservative fallback when GPU metrics are unavailable.
- [x] 3.5 Implement least-in-flight batch scheduling across healthy workers.
- [x] 3.6 Implement worker health transitions, failed-batch retry, unhealthy worker exclusion, and fallback to the primary worker.
- [x] 3.7 Start managed extra BGE-M3 workers on demand for interactive indexing and retire them when the indexing workload becomes idle, with idle timeout as fallback.

## 4. Milvus Insert Safety

- [x] 4.1 Add bounded insert concurrency separate from embedding concurrency.
- [x] 4.2 Add an idempotent accelerated BGE-M3 write path using Milvus upsert where supported, or fail ambiguous insert failures instead of retrying them with plain insert semantics.
- [x] 4.3 Verify reordered batch completion preserves stable document IDs and retrieval metadata.
- [x] 4.4 Validate that failed or retried batches do not mix embedding profiles or silently drop documents.
- [x] 4.5 Add error messages that identify failed stage and worker context without printing tokens or secrets.

## 5. MCP Status and Operations

- [x] 5.1 Extend daemon runtime status with accelerator mode, active workers, rejected workers, in-flight embedding batches, in-flight insert batches, retries, and fallback reason.
- [x] 5.2 Extend indexing status with scanning, embedding, insertion, and accelerator progress fields.
- [x] 5.3 Ensure `cancel_codebase_workload` cancels queued accelerated batches and retires managed extra workers safely.
- [x] 5.4 Keep search workload concurrency independent from accelerated indexing settings.
- [x] 5.5 Investigate and fix stale daemon workload `activeCount` after a cancelled indexing job has already transitioned the codebase snapshot to `indexfailed`.

## 6. Tests and Verification

- [x] 6.1 Add unit tests for accelerator configuration defaults, invalid values, and environment parsing.
- [x] 6.2 Add unit tests for batch pipeline concurrency, sequential fallback, cancellation, and progress accounting.
- [x] 6.3 Add unit tests for worker metadata mismatch, worker failure, retry, and fallback behavior.
- [x] 6.4 Add integration tests or mocked-vector-db tests proving stable document IDs and BGE-M3 full metadata under reordered batch completion.
- [x] 6.5 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 6.6 Run local benchmark comparisons for acceleration disabled, parallel batches with one worker, and parallel batches with additional BGE-M3 workers.
