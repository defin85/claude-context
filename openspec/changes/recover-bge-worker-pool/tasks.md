## 1. Worker Rejection Diagnostics

- [ ] 1.1 Add tests that simulate an extra BGE-M3 worker failing one `/embed_batch` request while remaining healthy by `/health` and `/metadata`.
- [ ] 1.2 Extend BGE-M3 worker snapshot data with endpoint, health state, in-flight count, rejection reason, last failure time, last success time, and recovery-attempt count.
- [ ] 1.3 Log worker rejection and recovery events with endpoint and reason without logging request payload contents.

## 2. Worker Recovery

- [ ] 2.1 Add bounded cooldown-based revalidation for rejected non-primary BGE-M3 workers.
- [ ] 2.2 Revalidate rejected workers through `/health` and `/metadata` before returning them to the healthy worker set.
- [ ] 2.3 Preserve strict full BGE-M3 profile equivalence checks for model, mode, outputs, dense dimension, precision, max tokens, and preprocessing profile.
- [ ] 2.4 Ensure a recovered worker receives embedding batches again during the same long indexing job.

## 3. Accelerator Status Integration

- [ ] 3.1 Include detailed worker diagnostics in accelerator/indexing status while preserving backward-compatible aggregate `activeWorkers` and `rejectedWorkers`.
- [ ] 3.2 Ensure status distinguishes managed sidecar process state from embedding worker-pool acceptance state.
- [ ] 3.3 Add focused tests for active/rejected/recovered worker status snapshots.

## 4. Chunk Limit Observability

- [ ] 4.1 Surface the configured `CODE_CHUNK_LIMIT` in indexing start logs and indexing status.
- [ ] 4.2 Report `limit_reached` completion with chunk count, processed file count, configured limit, and incomplete-result warning.
- [ ] 4.3 Document that raising `CODE_CHUNK_LIMIT` requires a new force reindex to include chunks skipped by a previous lower-limit run.
- [ ] 4.4 Add tests for valid, invalid, default, and limit-reached `CODE_CHUNK_LIMIT` behavior.

## 5. Verification

- [ ] 5.1 Run focused core tests for BGE-M3 embedding worker pool and context chunk-limit behavior.
- [ ] 5.2 Run `pnpm --filter @zilliz/claude-context-core typecheck` and build validation.
- [ ] 5.3 Run `pnpm --filter @zilliz/claude-context-mcp typecheck` and build validation if status payloads change in MCP.
- [ ] 5.4 Run a small live smoke where an extra sidecar is temporarily rejected and then recovered.
- [ ] 5.5 Run or document a large-repo force indexing retry with raised `CODE_CHUNK_LIMIT` and verify the configured limit is visible in status.
