## 1. Scheduler Failure Containment

- [ ] 1.1 Add terminal insert-failure state to `EmbeddingBatchScheduler` that records the first insert error.
- [ ] 1.2 Stop `scheduleEmbedding()` and `scheduleInsert()` from starting new work once terminal insert failure is set.
- [ ] 1.3 Reject queued embedding batches and queued insert batches with the first insert error.
- [ ] 1.4 Preserve existing cancellation behavior for external aborts and explicit scheduler cancellation.

## 2. Drain and Error Reporting

- [ ] 2.1 Ensure `drain()` waits for already running insert operations to settle after first insert failure.
- [ ] 2.2 Ensure the indexing job rejects with the first insert-stage error and batch context.
- [ ] 2.3 Ensure later running-insert failures do not replace the primary caller-facing error.
- [ ] 2.4 Keep accelerator counters and batch states coherent for failed, rejected, and completed batches.

## 3. Tests

- [ ] 3.1 Add scheduler test where one insert fails while another insert is running and queued inserts must not start.
- [ ] 3.2 Add scheduler test where queued embedding batches are rejected after first insert failure.
- [ ] 3.3 Add context-level mocked-vector-db test proving the job fails with the first insert-stage error and waits for running inserts.
- [ ] 3.4 Add no-unhandled-rejection coverage for fail-fast insert failure races.

## 4. Verification

- [ ] 4.1 Run focused core tests for `embedding-batch-scheduler.test.ts` and `context.accelerator.test.ts`.
- [ ] 4.2 Run `pnpm exec openspec validate indexing-perf-06-fail-fast-vector-insert-failures --strict`.
- [ ] 4.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [ ] 4.4 Document verification results in `openspec/changes/indexing-perf-06-fail-fast-vector-insert-failures/verification.md`.
