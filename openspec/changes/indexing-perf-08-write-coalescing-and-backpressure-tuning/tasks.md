## 1. Backend Write Capabilities

- [x] 1.1 Define a core-side vector write capability shape covering same-collection parallel write safety, idempotent upsert support, recommended insert concurrency, target coalesced document count, maximum coalesced document count, and ambiguous-write behavior.
- [x] 1.2 Add default conservative capabilities for existing vector database implementations and test fakes.
- [x] 1.3 Mark Qdrant as parallel-write-safe only after local adapter tests prove concurrent upserts into one collection succeed.
- [x] 1.4 Mark LanceDB as single-writer per collection and prevent concurrent `table.add` calls into one table.
- [x] 1.5 Keep Milvus conservative unless current benchmark evidence supports a safer backend-specific policy.

## 2. Write Coalescing

- [x] 2.1 Add a scheduler-side coalescing buffer for completed embedding batches before vector insertion.
- [x] 2.2 Flush coalesced writes by target document count, maximum document count, short timeout, scheduler drain, and cancellation.
- [x] 2.3 Preserve original batch metadata, document ids, relative paths, line ranges, retrieval metadata, and per-source-batch ordering through coalesced flushes.
- [x] 2.4 Ensure coalescing does not change BGE-M3 embedding content-character or estimated-token limits.
- [x] 2.5 Add single-writer coalescing behavior for LanceDB without issuing concurrent writes to one table.
- [x] 2.6 Add backend opt-out behavior so unsupported backends keep current insert scheduling.

## 3. Adaptive Backpressure

- [x] 3.1 Split adaptive pressure accounting into insert backlog, insert latency, retry rate, rejected workers, host memory, and VRAM signals.
- [x] 3.2 Report configured insert concurrency, effective insert concurrency, backend clamp reason, coalescing limits, queue depth, and selected throttle reason in accelerator snapshots.
- [x] 3.3 Adjust producer admission so insert backlog after coalescing slows production only when the write queue cannot drain.
- [x] 3.4 Keep VRAM pressure handling separate from write health so successful writes remain visible even when VRAM is the selected throttle reason.
- [x] 3.5 Preserve deterministic cancellation behavior for queued, embedding, coalesced, and inserting batches.

## 4. Tests

- [x] 4.1 Add core unit tests for capability-based effective insert concurrency selection.
- [x] 4.2 Add scheduler tests proving small completed embedding batches coalesce into fewer vector writes.
- [x] 4.3 Add tests proving coalescing drains on cancellation and does not lose or duplicate documents.
- [x] 4.4 Add LanceDB tests proving concurrent scheduler requests are serialized or coalesced into safe single-writer table writes.
- [x] 4.5 Add Qdrant adapter tests or local integration checks proving same-collection parallel upserts succeed without failed insert batches.
- [x] 4.6 Add status/benchmark compact-output tests for coalescing and separated pressure fields.

## 5. Benchmark Evidence

- [x] 5.1 Capture the current capped baseline on `examples/demo-do30-1c` with 4 BGE-M3 workers, payload caps `20000/5000`, and the existing insert scheduler.
- [x] 5.2 Run `examples/demo-do30-1c` with LanceDB single-writer coalescing and compare progress, write calls, failed inserts, insert time, and backpressure wait.
- [ ] 5.3 Run `examples/demo-do30-1c` with Qdrant backend-aware insert concurrency `2` and `4` plus coalescing.
- [x] 5.4 Compare candidates against the baseline using the same bounded ten-minute window and full 1C scope.
- [x] 5.5 Record whether the dominant remaining pressure source is insert backlog, insert latency, retry pressure, rejected workers, host memory, or VRAM.
- [x] 5.6 Do not promote a default unless the candidate has zero failed inserts and materially improves bounded progress or reduces wall-clock/backpressure.

## 6. Documentation and Verification

- [x] 6.1 Document backend write capability semantics and how configured insert concurrency differs from effective insert concurrency.
- [x] 6.2 Document write coalescing knobs and safe starting values for BGE-M3 full indexing.
- [x] 6.3 Update benchmark artifact summaries with backend policy, coalesced write counts, coalesced document counts, flush reasons, and pressure attribution.
- [x] 6.4 Run focused core scheduler and vector database tests.
- [x] 6.5 Run `node scripts/measure-indexing-baseline.js --self-test-compact-output`.
- [x] 6.6 Run `pnpm --filter @zilliz/claude-context-core typecheck` and `pnpm --filter @zilliz/claude-context-mcp typecheck`.
- [x] 6.7 Run `pnpm exec openspec validate indexing-perf-08-write-coalescing-and-backpressure-tuning --strict`.
