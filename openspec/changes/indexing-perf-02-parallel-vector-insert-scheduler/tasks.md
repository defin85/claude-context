## 1. Insert Scheduler Core

- [ ] 1.1 Add a bounded insert scheduler abstraction with configurable concurrency and queue capacity.
- [ ] 1.2 Route accelerated embedded batches through the insert scheduler.
- [ ] 1.3 Ensure final indexing completion waits for insert scheduler drain.
- [ ] 1.4 Preserve sequential insert behavior when insert concurrency is `1`.

## 2. Vector Write Safety

- [ ] 2.1 Audit Milvus adapter write semantics for insert versus upsert support.
- [ ] 2.2 Use idempotent upsert for accelerated BGE-M3 writes where supported.
- [ ] 2.3 Fail ambiguous plain-insert failures instead of retrying unsafely.
- [ ] 2.4 Add tests for stable document IDs under out-of-order insert completion.

## 3. Status and Configuration

- [ ] 3.1 Add insert scheduler config for concurrency and queue capacity.
- [ ] 3.2 Expose insert queue depth, running inserts, completed inserts, failed inserts, and insert timing in accelerator status.
- [ ] 3.3 Update benchmark summary to record insert scheduler metrics.
- [ ] 3.4 Document default-safe insert concurrency and operator override.

## 4. Verification

- [ ] 4.1 Run unit tests for insert scheduler concurrency, drain, cancellation, and failure behavior.
- [ ] 4.2 Run mocked-vector-db tests for out-of-order insert completion and idempotent writes.
- [ ] 4.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [ ] 4.4 Benchmark `examples/demo-1c` and `examples/demo-do30-1c` with insert concurrency `1` and higher candidate values.
- [ ] 4.5 Run `pnpm exec openspec validate indexing-perf-02-parallel-vector-insert-scheduler --strict`.
