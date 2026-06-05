## Context

Indexing currently runs one file producer inside `Context.processFileList()`. The producer reads files, splits them into chunks, builds embedding batches, and submits each batch through `AsyncLimiter`. In accelerated mode this creates parallel embedding work, but queued batches are represented as promises and the producer can continue reading and splitting while embedding workers are already saturated.

The BGE-M3 full path uses dense vectors, model-generated sparse lexical weights, and ColBERT token vectors. It is materially heavier than dense-only BGE-M3 and uses GPU-backed sidecars that are planned by the daemon. The daemon owns worker count and lifecycle, while the embedding provider owns per-batch worker dispatch with healthy-worker and least-in-flight selection.

The design must keep this ownership split: indexing schedules batches, BGE-M3 embedding selects sidecars, and vector database insertion remains a separate bounded resource.

## Goals / Non-Goals

**Goals:**
- Keep healthy embedding workers saturated with bounded embedding batch concurrency.
- Apply producer backpressure when queued plus running embedding work reaches a configured bound.
- Separate embedding-slot concurrency from insert-slot concurrency so vector DB latency does not occupy GPU embedding slots.
- Preserve BGE-M3 full metadata and retry behavior for dense, sparse, and ColBERT vectors.
- Improve accelerator progress snapshots with queue depth, running embedding batches, running insert batches, and backpressure time.
- Keep cancellation deterministic for queued and running batches.

**Non-Goals:**
- Do not shard files or path ranges across BGE-M3 workers.
- Do not parallelize file reading or AST splitting in this change.
- Do not replace daemon VRAM-aware worker planning or managed worker lifecycle.
- Do not change Milvus collection schemas, BGE-M3 retrieval schemas, or require reindex migration.
- Do not introduce external queueing dependencies.

## Decisions

### Decision: Add a bounded in-process embedding batch scheduler

Introduce an internal scheduler used by `Context.processFileList()` for accelerated indexing. The scheduler accepts batch metadata and a task that performs embedding plus insertion. It limits:
- running embedding tasks to effective embedding concurrency;
- queued batches to a bounded `maxQueuedBatches`;
- running insert tasks to configured insert concurrency.

Alternative considered: keep `AsyncLimiter` and add queue length checks around it. This would preserve the current shape but keep queue state implicit and make cancellation, progress, and backpressure metrics harder to expose.

### Decision: Keep BGE-M3 worker dispatch inside the embedding provider

The scheduler MUST NOT assign a batch to a specific sidecar. It invokes `embedMultiBatchWithWorkerPool()` and lets `BgeM3Embedding.selectWorker()` choose the healthy worker with the lowest `inFlight` count. This keeps retries and recovery local to the embedding provider.

Alternative considered: assign batches to worker endpoints in the scheduler. That would duplicate health/retry logic and make worker recovery harder to keep consistent with search-time embedding behavior.

### Decision: Separate embedding and insert slots

An embedding slot is held only while model embedding is running. After embedding returns vectors, insertion uses a separate insert limiter. This prevents vector DB insert latency from reducing GPU utilization.

Alternative considered: keep the slot through embed plus insert. This is simpler but risks GPU idle time when Milvus insert latency or backpressure grows.

### Decision: Use bounded backpressure rather than unlimited submitted promises

The producer waits before submitting another batch when queued plus running scheduler work reaches capacity. The default queue bound should be derived from effective embedding concurrency, such as `embeddingConcurrency * 2` or `embeddingConcurrency * 4`, with a conservative floor.

Alternative considered: add a fixed global queue size. A concurrency-derived bound scales with worker count and avoids another mandatory configuration knob.

### Decision: Record progress from scheduler state

Accelerator snapshots should include submitted, queued, running embedding, running insert, completed, failed, retried, and backpressure wait metrics. Progress MUST reach 100% only after the scheduler drains, not when the file producer reaches the last file.

Alternative considered: keep existing progress events from promise completion only. That would not show queue pressure and could still misrepresent work remaining.

### Decision: Keep adaptive worker changes conservative

The first implementation should use the effective embedding concurrency computed at indexing start, while worker health changes are reflected by provider dispatch and retry. If concurrency is later made adaptive during a run, increases should be debounced and decreases should not cancel active batches.

Alternative considered: continuously resize scheduler concurrency from every worker snapshot. This may oscillate when workers are rejected and recovered quickly.

## Risks / Trade-offs

- [Risk] Insert latency occupies embedding capacity if stages are not separated -> Mitigation: release embedding slots immediately after embedding and run vector inserts through a separate limiter.
- [Risk] Queue growth increases memory pressure on large 1C configurations -> Mitigation: enforce a bounded queue and make producer wait when scheduler capacity is saturated.
- [Risk] Worker rejection/recovery causes concurrency oscillation -> Mitigation: keep per-batch dispatch in the provider and defer adaptive concurrency increases until stable health windows are available.
- [Risk] Progress reaches completion before queued batches drain -> Mitigation: drive final progress from `scheduler.drain()` and scheduler state, not only file traversal completion.
- [Risk] Cancellation leaves queued batches unresolved -> Mitigation: scheduler cancellation must reject queued submissions and wait for active batches to settle before returning.
- [Risk] Dense-only providers have lower latency and may not need the same queue depth -> Mitigation: derive default queue bounds from effective concurrency and preserve sequential behavior when acceleration is disabled.
- [Risk] Additional scheduler state adds implementation complexity -> Mitigation: isolate scheduler logic in a focused core module with unit tests before wiring it into `Context`.

## Migration Plan

1. Add scheduler types and unit tests in `packages/core`.
2. Wire accelerated indexing through the scheduler while leaving disabled acceleration on the existing sequential path.
3. Extend accelerator snapshots and MCP status with optional scheduler fields.
4. Run targeted accelerator and BGE-M3 worker-pool tests.
5. Run a cold indexing smoke test on a large 1C configuration and verify bounded queue, in-flight counts, and completion progress.

Rollback is to switch `processFileList()` back to the existing `AsyncLimiter` submission path. No collection migration or data cleanup is required.

## Open Questions

- Should `maxQueuedBatches` be a new environment variable or remain derived from embedding concurrency only?
- Should adaptive concurrency be implemented in this change or deferred until rejected/recovered worker behavior is more stable under load?
- What default queue multiplier gives the best balance between GPU utilization and memory on the largest local 1C configurations?
