## Context

The current indexing path processes each codebase as a single sequential job. Inside that job, files are read and split one by one, chunks accumulate until `EMBEDDING_BATCH_SIZE`, one embedding batch is sent to the configured provider, the resulting documents are inserted into Milvus, and only then does the next batch proceed.

This is correct but underuses machines with spare RAM, VRAM, and GPU throughput during large initial or force indexing runs. BGE-M3 full retrieval is especially expensive because each chunk stores dense vectors, model-generated sparse weights, and compacted ColBERT token vectors. The storage and insert cost is higher than dense-only BGE-M3, and the acceleration design must preserve that full retrieval profile.

## Goals / Non-Goals

**Goals:**

- Reduce wall-clock time for large initial and force indexing runs without changing search semantics.
- Keep normal daemon operation responsive while indexing runs in the background.
- Use spare local GPU/VRAM capacity up to a configurable default-safe budget.
- Preserve current behavior when acceleration is disabled, unsupported, or unhealthy.
- Expose enough status to understand whether acceleration is active and where work is queued.

**Non-Goals:**

- No multi-model indexing for a single codebase.
- No change to dense-only, hybrid BM25, or BGE-M3 full scoring behavior.
- No automatic migration or mutation of already indexed collections.
- No requirement that users run a GPU or multiple sidecars.

## Decisions

### Decision: Limit acceleration to initial and force indexing by default

Initial and force indexing are the workloads with the highest wall-clock cost and the least need for interactive immediacy. Background sync and incremental reindexing SHALL remain conservative by default.

Alternative considered: accelerate every indexing path. This risks making normal daemon sync compete with search and user work, so it is not the default.

### Decision: Add intra-codebase batch parallelism before relying on extra workers

The indexer SHALL support multiple in-flight chunk batches for one codebase, controlled by a bounded concurrency setting. This uses existing workers more effectively and is cheaper than loading additional model copies.

Alternative considered: only increase `EMBEDDING_BATCH_SIZE`. Larger batches reduce request overhead but keep the pipeline sequential and can increase per-request latency and memory spikes.

### Decision: Use an adaptive BGE-M3 worker pool for additional throughput

When BGE-M3 full indexing runs in accelerator mode, the system MAY launch additional identical local sidecars and distribute embedding batches using least-in-flight scheduling. Every worker MUST pass health and metadata validation before it receives batches.

Workers are treated as equivalent only when metadata matches the configured embedding profile: model, mode, output types, dimension, and relevant preprocessing profile. The default resource policy targets a configurable VRAM ceiling, with `75%` as the intended local default for this workstation class.

Alternative considered: route through an external load balancer. A local managed pool keeps lifecycle, metadata validation, and fallback behavior under the daemon's control.

### Decision: Preserve deterministic document identity and idempotent writes

Batch completion order may change, but document IDs SHALL continue to derive from relative path, line range, and content. Accelerated writes SHALL be idempotent at the batch level. Prefer Milvus upsert for accelerated BGE-M3 writes when the configured Milvus client supports it; otherwise, only retry failures that happened before the write was submitted, and fail the indexing job instead of retrying an ambiguous insert failure.

Alternative considered: shard the codebase into separate logical indexes. That complicates search fan-out and progress reporting, and it changes how users address a codebase.

### Decision: Separate embedding concurrency from Milvus insert concurrency

Embedding workers and Milvus writes have different bottlenecks. The design SHALL expose separate limits so embedding can run at higher concurrency while inserts remain bounded.

Alternative considered: one global batch concurrency. This is simpler but makes it harder to protect Milvus and daemon responsiveness.

## Risks / Trade-offs

- Extra BGE-M3 workers increase VRAM and RAM use -> enforce a VRAM budget, validate after startup, and stop launching workers before the budget is exceeded.
- GPU OOM or worker crashes can interrupt batches -> mark workers unhealthy, retry affected batches on healthy workers only when the failed stage is safe to retry, and fall back to the primary worker.
- Parallel batches can make progress reporting less linear -> report submitted, completed, failed, and retried batch counts in addition to file progress.
- Multiple workers can hide version drift -> require matching metadata before a worker joins the pool.
- Insert throughput can become the bottleneck -> keep insert concurrency separately bounded and visible in daemon status.
- Full BGE-M3 storage is larger than dense-only indexing -> acceleration improves ingest time but does not reduce Milvus storage or search latency costs.

## Migration Plan

No existing indexed collection migration is required. The feature applies when a codebase is indexed or force reindexed under the same retrieval schema.

Rollout:

1. Add configuration with defaults that preserve current behavior unless acceleration is enabled.
2. Implement batch pipeline and status metrics with a single existing worker.
3. Add optional BGE-M3 worker pool lifecycle and metadata validation.
4. Enable `auto` mode for initial and force indexing only after tests and local benchmarks pass.

Rollback:

- Set accelerator mode to `off` or reduce concurrency to `1`.
- Stop any managed extra sidecars.
- Re-run indexing with force only if a failed run left the codebase in `indexfailed`.

## Open Questions

- Whether extra sidecars should be launched as child processes, systemd transient user services, or an external operator-managed pool.
- The first production-safe default for `INDEX_EMBEDDING_CONCURRENCY`; likely `2` for BGE-M3 full on a single GPU.
- Whether accelerated BGE-M3 writes should use Milvus SDK upsert directly or a vector database abstraction method that maps to upsert-capable clients.
