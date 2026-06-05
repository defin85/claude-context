## Why

Large initial indexes can currently submit embedding work through a simple limiter that allows the file producer to enqueue many promises ahead of the GPU workers. This makes memory pressure, cancellation, and progress reporting harder to reason about as BGE-M3 worker pools grow beyond two workers.

We need an explicit bounded embedding batch scheduler so indexing can keep all healthy embedding workers busy without letting read/split production run unbounded ahead of embedding and insert stages.

## What Changes

- Introduce a bounded embedding batch scheduler for indexing pipelines.
- Keep project traversal and file splitting as a single producer, but apply backpressure when embedding work is already saturated.
- Run embedding and vector insert through separate bounded stages so insert latency does not hold an embedding slot longer than necessary.
- Keep BGE-M3 worker selection inside the embedding provider using the existing healthy-worker and least-in-flight policy.
- Surface scheduler queue, in-flight, retry, and backpressure metrics in accelerator progress snapshots.
- Preserve existing behavior when acceleration is disabled.
- Non-goals:
  - Do not shard projects or file ranges across BGE-M3 workers.
  - Do not change Milvus collection schemas or require reindex migration.
  - Do not replace the BGE-M3 worker pool lifecycle or VRAM planning policy.
  - Do not parallelize AST splitting in this change.

## Capabilities

### New Capabilities
- `embedding-batch-scheduling`: Defines bounded scheduling, backpressure, progress, cancellation, and worker-pool interaction for embedding batch pipelines.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/core/src/context.ts`
  - `packages/core/src/indexing-accelerator.ts`
  - BGE-M3 embedding integration in `packages/core/src/embedding/bge-m3-embedding.ts`
  - Accelerator status exposure through `packages/mcp`
- Tests:
  - Add scheduler unit coverage for backpressure, drain, cancellation, and insert-slot separation.
  - Extend context accelerator tests for bounded batch submission and progress semantics.
  - Extend BGE-M3 worker-pool tests only where dispatch/retry observations are needed.
- APIs:
  - No breaking public API change is expected.
  - Runtime status may gain new optional accelerator fields such as queued batch count and backpressure wait time.
- Migration impact:
  - Existing indexed collections remain valid.
  - No collection rebuild is required solely because of this change.
