## 1. Config and Types

- [x] 1.1 Audit current batch-size configuration and identify where embedding and insert grouping are coupled.
- [x] 1.2 Add separate config fields for embedding batch size and insert batch size, preserving existing behavior by default.
- [x] 1.3 Validate invalid, zero, and excessively large values with clear errors or documented fallback.
- [x] 1.4 Add config tests for default and override behavior.

## 2. Pipeline Integration

- [x] 2.1 Apply embedding batch size to chunk grouping before embedding.
- [x] 2.2 Apply insert batch size in the insert scheduler without changing document identity.
- [x] 2.3 Ensure cancellation and failures report the correct original batch/chunk context.
- [x] 2.4 Add tests for split/coalesced insert batches.

## 3. Metrics and Benchmarks

- [x] 3.1 Extend status and benchmark samples with batch-size fields and batch distribution summaries.
- [x] 3.2 Define benchmark candidates for `examples/demo-1c` and `examples/demo-do30-1c`.
- [x] 3.3 Capture before/after wall-clock, retry rate, insert latency, and memory/VRAM notes.
- [x] 3.4 Document selected defaults and rejected candidates.

## 4. Verification

- [x] 4.1 Run targeted batching and scheduler tests.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 4.3 Run benchmark matrix for at least two batch-size candidates.
- [x] 4.4 Run `pnpm exec openspec validate indexing-perf-04-optimize-indexing-batch-sizing --strict`.
