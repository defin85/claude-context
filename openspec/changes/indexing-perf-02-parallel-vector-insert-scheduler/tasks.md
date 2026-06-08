## 1. Insert Scheduler Core

- [x] 1.1 Add a bounded insert scheduler abstraction with configurable concurrency and queue capacity.
- [x] 1.2 Route accelerated embedded batches through the insert scheduler.
- [x] 1.3 Ensure final indexing completion waits for insert scheduler drain.
- [x] 1.4 Preserve sequential insert behavior when insert concurrency is `1`.

## 2. Vector Write Safety

- [x] 2.1 Audit Milvus adapter write semantics for insert versus upsert support.
- [x] 2.2 Use idempotent upsert for accelerated BGE-M3 writes where supported.
- [x] 2.3 Fail ambiguous plain-insert failures instead of retrying unsafely.
- [x] 2.4 Add tests for stable document IDs under out-of-order insert completion.

## 3. Status and Configuration

- [x] 3.1 Add insert scheduler config for concurrency and queue capacity.
- [x] 3.2 Expose insert queue depth, running inserts, completed inserts, failed inserts, and insert timing in accelerator status.
- [x] 3.3 Update benchmark summary to record insert scheduler metrics.
- [x] 3.4 Document default-safe insert concurrency and operator override.

## 4. Verification

- [x] 4.1 Run unit tests for insert scheduler concurrency, drain, cancellation, and failure behavior.
- [x] 4.2 Run mocked-vector-db tests for out-of-order insert completion and idempotent writes.
- [x] 4.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 4.4 Benchmark `examples/demo-1c` and `examples/demo-do30-1c` with insert concurrency `1` and higher candidate values.
- [x] 4.5 Run `pnpm exec openspec validate indexing-perf-02-parallel-vector-insert-scheduler --strict`.
