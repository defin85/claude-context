## Why

After payload-safe BGE-M3 batching and alternative vector backends, `examples/demo-do30-1c` still reaches only about `16%` in a ten-minute `full` run. The latest LanceDB and Qdrant measurements show that failed writes are no longer the dominant problem; the remaining bottleneck is excessive scheduler backpressure caused by many small payload-safe batches, backend-specific write behavior, and conservative pressure handling.

## What Changes

- Add backend-aware vector write capabilities so the indexing scheduler can distinguish parallel-safe backends such as Qdrant from single-writer local backends such as LanceDB.
- Add write coalescing for small payload-safe embedding batches before vector insertion, reducing the number of vector database write calls without increasing BGE-M3 embedding payload size.
- Tune adaptive backpressure so insert backlog, insert latency, retry rate, rejected workers, host memory, and VRAM pressure are reported and acted on independently instead of collapsing into one long producer wait.
- Add benchmark evidence for `examples/demo-do30-1c` comparing the current capped baseline with write coalescing and backend-aware insert settings.
- Keep cancellation, progress, stable document IDs, and fail-fast ambiguous-write behavior intact.
- Non-goals:
  - Do not increase BGE-M3 embedding payload limits to chase throughput.
  - Do not make LanceDB perform concurrent `table.add` calls into one table.
  - Do not change retrieval quality or ranking behavior.
  - Do not require users to switch away from Milvus.
  - Do not claim a new default until benchmark artifacts show lower wall-clock or materially higher progress in the same bounded window.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `embedding-batch-scheduling`: Add backend-aware insert scheduling, write coalescing, and insert pressure diagnostics for payload-safe accelerated indexing.
- `accelerated-indexing`: Add acceptance expectations for bounded throughput evidence and backend-specific insert policy selection.

## Impact

- Affected code:
  - `packages/core/src/indexing-accelerator.ts`: insert queue, pressure signals, coalescing metadata, and scheduler drain behavior.
  - `packages/core/src/context.ts`: prepared insert batching, vector database insert capability discovery, and progress/status metadata.
  - `packages/core/src/vectordb/*`: backend capability declarations for Milvus, Qdrant, LanceDB, and test fakes.
  - `packages/mcp/src/config.ts` and status formatting if new knobs or diagnostics are exposed.
  - `scripts/measure-indexing-baseline.js`: benchmark summaries for coalescing, write calls, flush sizes, backend policy, and backpressure attribution.
- API impact:
  - No required `search_code` or `index_codebase` request shape change.
  - Optional accelerator diagnostics may gain fields such as `vectorWritePolicy`, `coalescedInsertBatches`, `coalescedInsertDocuments`, `writeFlushReason`, `backendParallelWritesSupported`, or separated pressure signals.
- Migration impact:
  - No collection migration is required. Existing indexed collections remain valid.
  - New behavior affects future indexing runs only.
  - Backends that do not advertise parallel-safe writes should remain correct by using single-writer or coalesced writes.
