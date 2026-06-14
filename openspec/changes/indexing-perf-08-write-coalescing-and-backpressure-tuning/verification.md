# Verification

Date: 2026-06-11

## Local Proof

- `pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts embedding-batch-scheduler.test.ts indexing-accelerator.test.ts vectordb/qdrant-vectordb.test.ts vectordb/lancedb-vectordb.test.ts --runInBand`
  - Pass: 5 suites, 73 tests.
- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/worker-planning-policy.test.ts`
  - Pass: 9 tests.
- `node scripts/measure-indexing-baseline.js --self-test-compact-output`
  - Pass: compact benchmark output self-test passed.
- `pnpm build:core && pnpm typecheck && pnpm build`
  - Pass. `pnpm build` emitted existing Chrome extension webpack asset-size warnings for icon files.
- `pnpm --filter @zilliz/claude-context-core typecheck`
  - Pass.
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
  - Pass.
- `pnpm exec openspec validate indexing-perf-08-write-coalescing-and-backpressure-tuning --strict`
  - Pass: change is valid.

## LanceDB Live Evidence

All accepted LanceDB runs used `examples/demo-do30-1c`, full 1C scope, 4 managed BGE-M3 workers, payload caps `20000/5000`, `INDEX_INSERT_CONCURRENCY=1`, `INDEX_INSERT_QUEUE_CAPACITY=2`, and a bounded ten-minute window with `--cancel-on-timeout`.

### Baseline: Existing Insert Scheduler

Run directory:

`benchmark-artifacts/2026-06-11T15-11-49-224Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert1-adaptivetrue`

- `INDEX_WRITE_COALESCING=false` in `daemon-prepared.json`.
- Final status: `indexing`, cancelled by timeout after `609223ms`.
- Write policy: LanceDB, effective insert concurrency `1`, `coalescingEnabled=false`.
- Completed insert batches: `509`.
- Coalesced insert batches/documents: `0` / `0`.
- Failed insert batches: `0`.
- Insert time: `69679ms`.
- Batch summary: `10570` total chunks, `509` completed batches, `0` failed batches.
- Dominant final pressure: `insert_backlog`; final insert backlog `1`, retry rate `0.0811`, throttle time `281313ms`.

### Candidate: LanceDB Single-Writer Coalescing

Run directory:

`benchmark-artifacts/2026-06-11T15-38-07-606Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert1-adaptivetrue`

- `INDEX_WRITE_COALESCING=true` in `daemon-prepared.json`.
- Final status: `indexing`, cancelled by timeout after `607233ms`.
- Write policy: LanceDB, effective insert concurrency `1`, `coalescingEnabled=true`.
- Completed insert batches: `313`.
- Coalesced insert batches/documents: `165` / `6589`.
- Failed insert batches: `0`.
- Insert time: `33982ms`.
- Batch summary: `9892` total chunks, `478` completed batches, `0` failed batches.
- Dominant final pressure: `retry_rate`; final insert backlog `0`, coalescing queue depth `23`, retry rate `0.0493`, throttle time `381201ms`.

### Decision

LanceDB coalescing is implemented and safe as an explicit candidate: it preserved single-writer behavior, kept failed insert batches at `0`, and reduced vector write count and insert time. It did not improve bounded progress or backpressure in this run. Therefore it is not promoted as the default; `INDEX_WRITE_COALESCING` defaults to `false` and must be set to `true` for candidate runs.

## Diagnostic Runs Not Used As Acceptance Evidence

- `2026-06-11T14-33-10-775Z...`: pre-fix run. It exposed incorrect pressure attribution where `queuedCoalescedDocuments` was counted as `insertBacklog`.
- `2026-06-11T14-50-09-439Z...` and `2026-06-11T15-01-07-755Z...`: no-coalescing env was not effective against the old built daemon code; these are configuration diagnostics, not baseline evidence.
- `2026-06-11T15-22-21-361Z...`: inherited `INDEX_WRITE_COALESCING=false`, so it is a second no-coalescing control, not a coalescing candidate.
- `2026-06-11T15-33-05-408Z...`: coalescing was enabled, but the run failed early with `Indexing batch 146 failed during embedding: BGE-M3 worker retry budget exhausted... fetch failed`. This drove the retry-pressure tuning from `0.5` to `0.1`.

## Missing Live Evidence

- Qdrant live runs for `INDEX_INSERT_CONCURRENCY=2` and `4` were not executed. Local `http://127.0.0.1:6333/collections` returned connection failure, and no `QDRANT_URL` was present in the environment.
- Because Qdrant live evidence is missing, Qdrant backend-aware concurrency remains covered by adapter/unit tests only in this change.
