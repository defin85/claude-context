## Why

The accelerated indexer now benefits from multiple BGE-M3 workers, but local benchmark runs show meaningful retry and rejection overhead. In the `examples/demo-do30-1c` auto run, indexing reached roughly 25% in 14.5 minutes with 4 workers, but accumulated 70 retried batches and transient worker rejection.

Before increasing downstream concurrency, the worker pool needs clearer failure classification, faster recovery, and benchmark-visible retry cost. Otherwise later throughput work can hide instability behind higher parallelism.

## What Changes

- Classify BGE-M3 worker failures by stage and retry safety.
- Track worker rejection, recovery, retry latency, and retry reason in accelerator status.
- Make retry budgets and worker cooldown behavior explicit and testable.
- Add benchmark samples that preserve retry/rejection summaries without storing full batch arrays.
- Keep successful search/index semantics unchanged.

Non-goals:

- Do not increase Milvus insert concurrency.
- Do not change BGE-M3 ranking or retrieval profile behavior.
- Do not introduce new worker lifecycle backends beyond the existing managed sidecar model.

## Capabilities

### New Capabilities

- `embedding-worker-throughput-stability`: Covers worker retry classification, rejection recovery, retry observability, and stability verification for accelerated indexing.

### Modified Capabilities

- `embedding-batch-scheduling`: Uses the improved worker health signal but keeps scheduling ownership boundaries unchanged.

## Impact

- Affected code:
  - `packages/core`: BGE-M3 worker pool, accelerator batch status, retry handling, tests.
  - `packages/mcp`: indexing status and daemon status structured content.
  - `scripts/measure-indexing-baseline.js`: benchmark summary fields for retry/rejection cost.
- Affected runtime:
  - Managed BGE-M3 sidecars on loopback ports.
  - Accelerator status samples and benchmark artifacts.
- Sequence:
  - This is step 1 of the indexing throughput series and should land before insert parallelism or adaptive backpressure.
