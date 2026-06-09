## 1. Config and Payload Limits

- [ ] 1.1 Audit current embedding batch construction, BGE-M3 full provider calls, and accelerator batch metadata paths.
- [ ] 1.2 Add payload-aware config fields for max content characters and max estimated tokens per embedding batch.
- [ ] 1.3 Define provider-sensitive effective limits so BGE-M3 full can use conservative payload-safe limits without changing dense-only provider behavior.
- [ ] 1.4 Validate invalid, zero, and excessively large payload limit values with documented fallback or clamping.
- [ ] 1.5 Add config tests for default, override, BGE-M3 full, dense-only, and invalid limit behavior.

## 2. Payload-Aware Batch Construction

- [ ] 2.1 Replace chunk-count-only embedding batch accumulation with an accumulator that tracks chunk count, content characters, and estimated tokens.
- [ ] 2.2 Flush the current batch before adding a chunk that would exceed payload limits.
- [ ] 2.3 Handle single chunks that exceed payload limits without dropping or splitting the chunk.
- [ ] 2.4 Preserve deterministic chunk order, document IDs, and metadata through payload-bounded batches.
- [ ] 2.5 Add default indexing path tests for content-char and estimated-token flush behavior.

## 3. Payload Failure Retry

- [ ] 3.1 Add detection for recognized payload-size/string-size embedding failures, including `Cannot create a string longer than`.
- [ ] 3.2 Implement ordered recursive split retry for multi-chunk embedding batches.
- [ ] 3.3 Preserve original logical batch ID, progress accounting, and batch failure context during provider sub-batch retries.
- [ ] 3.4 Fail single-chunk payload-size errors with file path, chunk index, content characters, estimated tokens, and provider mode.
- [ ] 3.5 Add tests covering successful split retry, repeated split retry, non-payload errors, and single-chunk fatal diagnostics.

## 4. Metrics, Status, and Benchmarks

- [ ] 4.1 Extend accelerator batch metadata with content character counts, effective payload limits, split reason, and payload retry split counts.
- [ ] 4.2 Extend MCP/status formatting and benchmark compact samples with payload-aware batch fields.
- [ ] 4.3 Extend benchmark summaries with max content characters per batch, max estimated tokens per batch, payload split count, and single-chunk fatal flag.
- [ ] 4.4 Update docs and `.env.example` with payload limit variables and BGE-M3 full operational guidance.

## 5. Benchmark Evidence

- [ ] 5.1 Reproduce the failing BGE-M3 full case or add a deterministic local test harness that simulates the V8 string-size failure.
- [ ] 5.2 Benchmark `examples/demo-1c` with previous failing candidates and the payload-safe candidate.
- [ ] 5.3 Run a bounded `examples/demo-do30-1c` comparison and clearly mark it as bounded if it is cancelled.
- [ ] 5.4 Document selected defaults, rejected candidates, retry/failure rates, insert latency, memory/VRAM notes, and limitations in `verification.md`.

## 6. Verification

- [ ] 6.1 Run focused core tests for payload-aware batching, retry split, scheduler metadata, and BGE-M3 full paths.
- [ ] 6.2 Run `node scripts/measure-indexing-baseline.js --self-test-compact-output`.
- [ ] 6.3 Run `pnpm exec openspec validate indexing-perf-07-payload-safe-embedding-batches --strict`.
- [ ] 6.4 Run `pnpm build:core && pnpm typecheck`.
- [ ] 6.5 Run `pnpm lint`.
- [ ] 6.6 Run `pnpm build`.
