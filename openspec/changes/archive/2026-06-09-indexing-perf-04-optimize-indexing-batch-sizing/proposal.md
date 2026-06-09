## Why

Current indexing batch sizes are static, but the optimal size differs between embedding requests and vector database inserts. Larger batches can reduce overhead, but oversized batches can increase latency, memory pressure, retries, and backpressure. After worker stability and insert scheduling are in place, batch sizing becomes a measurable tuning lever.

## What Changes

- Split embedding batch size and insert batch size configuration where needed.
- Add benchmark-backed profiles for small, medium, and large repositories.
- Record batch size, tokens per batch, chunks per batch, retry rate, insert latency, and wall-clock in benchmark artifacts.
- Keep existing defaults unless evidence supports changing them.

Non-goals:

- Do not change chunk splitting semantics.
- Do not select retrieval profiles automatically.
- Do not tune batch sizes per file type in the first version.

## Capabilities

### New Capabilities

- `indexing-batch-size-tuning`: Covers independent embedding/insert batch sizing, benchmark instrumentation, and default selection.

### Modified Capabilities

- `embedding-batch-scheduling`: Uses tuned batch sizes as scheduler input.
- `parallel-vector-insert-scheduler`: May use insert-specific batch sizing after that change lands.

## Impact

- Affected code:
  - `packages/core`: batching logic, config, metrics, tests.
  - `packages/mcp`: environment/config parsing and status exposure.
  - `scripts/measure-indexing-baseline.js`: batch-size benchmark metadata.
- Runtime impact:
  - Potential wall-clock and retry improvements without adding workers.
- Sequence:
  - Step 4 of the throughput series. Should follow insert scheduler and adaptive backpressure so tuning is measured against the intended pipeline.
