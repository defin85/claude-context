## Why

The accelerated indexer currently accumulates large backpressure when embedding workers and Milvus writes run at different speeds. In the stopped `examples/demo-do30-1c` auto run, backpressure reached roughly 800 seconds by 25% progress. Static concurrency limits are not enough when worker health, insert latency, and batch size vary across repositories.

## What Changes

- Add adaptive throttling based on insert backlog, insert latency, worker rejection, retry rate, and memory/VRAM health.
- Adjust effective embedding submission rate without changing configured hard limits.
- Expose adaptive decisions and throttle reasons in status and benchmark artifacts.
- Keep `INDEX_ACCELERATOR_MODE=off` and explicit low-concurrency settings deterministic.

Non-goals:

- Do not replace explicit maximum concurrency settings.
- Do not hide worker or insert failures.
- Do not introduce distributed scheduling.

## Capabilities

### New Capabilities

- `adaptive-indexing-backpressure`: Covers dynamic throttling, downstream pressure signals, status reporting, and benchmark validation.

### Modified Capabilities

- `embedding-batch-scheduling`: Uses adaptive effective concurrency when accelerator mode permits it.
- `parallel-vector-insert-scheduler`: Provides downstream pressure signals after that change lands.

## Impact

- Affected code:
  - `packages/core`: accelerator scheduler, pressure model, metrics, tests.
  - `packages/mcp`: status fields for adaptive state and throttle reasons.
  - Benchmark script and docs.
- Runtime impact:
  - Lower memory pressure and fewer retries during heavy runs.
  - May reduce peak embedding throughput to improve sustained throughput.
- Sequence:
  - Step 3 of the throughput series. Best implemented after insert scheduler exposes reliable downstream metrics.
