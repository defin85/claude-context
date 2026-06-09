## Why

After embedding batch parallelism, the write path becomes the next visible bottleneck. Current accelerator status still shows a single insert lane (`runningInsertBatches: 1`) while embedding workers continue producing completed batches. This creates backpressure and limits the speedup from four BGE-M3 workers.

## What Changes

- Introduce a bounded vector insert scheduler separate from embedding scheduling.
- Allow configurable insert concurrency when the vector database and write semantics support it.
- Preserve idempotent document identity and fail ambiguous write failures conservatively.
- Expose insert queue depth, insert concurrency, insert latency, and write retry/failure counters.
- Benchmark insert concurrency on representative 1C repositories.

Non-goals:

- Do not change embedding worker dispatch.
- Do not change retrieval schema or ranking.
- Do not make parallel insert the default without safety validation.

## Capabilities

### New Capabilities

- `parallel-vector-insert-scheduler`: Covers bounded concurrent vector database insertion, write safety, insert status, and benchmark validation.

### Modified Capabilities

- `embedding-batch-scheduling`: Separates embedded-batch handoff from vector write completion.

## Impact

- Affected code:
  - `packages/core`: vector database abstraction, Milvus insert/upsert path, accelerator pipeline, tests.
  - `packages/mcp`: status fields and configuration parsing if insert concurrency is daemon-scoped.
  - `scripts/measure-indexing-baseline.js`: insert scheduler metrics in samples and summaries.
- Runtime impact:
  - Higher concurrent load on Milvus.
  - Potentially lower backpressure if Milvus accepts parallel writes.
- Sequence:
  - Step 2 of the throughput series. Should follow worker stability so write benchmarks are not dominated by embedding retries.
