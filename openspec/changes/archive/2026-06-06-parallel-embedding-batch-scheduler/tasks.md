## 1. Scheduler Tests First

- [x] 1.1 Add focused unit tests for a bounded embedding batch scheduler queue, including producer wait when queued plus running batches reaches capacity.
- [x] 1.2 Add scheduler tests proving embedding slots are released before insert slots drain.
- [x] 1.3 Add scheduler tests for cancellation of queued batches and settling of active batches.
- [x] 1.4 Add scheduler snapshot tests for queued, running embedding, running insert, completed, failed, retried, and backpressure metrics.

## 2. Core Scheduler Implementation

- [x] 2.1 Implement an internal `EmbeddingBatchScheduler` module in `packages/core` with bounded submit, wait-for-capacity, drain, cancel, and snapshot APIs.
- [x] 2.2 Make scheduler queue capacity derive from effective embedding concurrency with a conservative default multiplier.
- [x] 2.3 Wire scheduler execution so embedding concurrency and insert concurrency are independently bounded.
- [x] 2.4 Ensure scheduler errors preserve batch id, stage, retry, and cancellation context used by existing indexing error handling.

## 3. Context Pipeline Wiring

- [x] 3.1 Replace accelerated `processFileList()` promise submission with scheduler submit and producer backpressure.
- [x] 3.2 Preserve sequential behavior when acceleration is inactive.
- [x] 3.3 Preserve stable document ids, file metadata, BGE-M3 dense/sparse/ColBERT metadata, and out-of-order batch completion behavior.
- [x] 3.4 Ensure final indexing progress is reported only after scheduler drain completes.

## 4. Worker Pool Interaction

- [x] 4.1 Keep BGE-M3 worker endpoint selection inside `BgeM3Embedding` and avoid assigning endpoints in the scheduler.
- [x] 4.2 Add or extend tests proving one rejected BGE-M3 worker does not stop scheduling while healthy workers remain.
- [x] 4.3 Verify retry accounting remains visible in accelerator snapshots when provider-level worker retry occurs.

## 5. Status and Monitoring

- [x] 5.1 Extend accelerator snapshots with queued batch count, running embedding count, running insert count, and backpressure wait time.
- [x] 5.2 Expose new optional scheduler fields through MCP `get_indexing_status` and `get_daemon_status`.
- [x] 5.3 Update progress callbacks so clients can distinguish file production, queued embedding, embedding, insert, and drain phases.

## 6. Validation

- [x] 6.1 Run targeted core tests for scheduler, context accelerator, and BGE-M3 worker pool behavior.
- [x] 6.2 Run `pnpm --filter @zilliz/claude-context-core typecheck` and `pnpm --filter @zilliz/claude-context-mcp typecheck`.
- [x] 6.3 Build `@zilliz/claude-context-core` and `@zilliz/claude-context-mcp` so daemon runtime uses updated `dist`.
- [x] 6.4 Run a cold indexing smoke on a large 1C configuration and capture scheduler queue, in-flight, retry, worker, progress, and VRAM observations.
