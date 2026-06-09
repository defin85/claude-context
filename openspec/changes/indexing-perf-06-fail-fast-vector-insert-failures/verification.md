# Verification

Date: 2026-06-09

## Commands

- `pnpm --filter @zilliz/claude-context-core test -- embedding-batch-scheduler.test.ts`
  - Result: passed, 13 tests.
- `pnpm --filter @zilliz/claude-context-core test -- embedding-batch-scheduler.test.ts context.accelerator.test.ts`
  - Result: passed, 34 tests.
- `pnpm exec openspec validate indexing-perf-06-fail-fast-vector-insert-failures --strict`
  - Result: passed, change is valid.
- `pnpm lint`
  - Result: passed with existing warning-only lint findings.
- `pnpm typecheck`
  - Result: passed.
- `pnpm build`
  - Result: passed with existing webpack asset-size warnings for Chrome extension icons.

## Evidence Notes

- Scheduler tests cover terminal insert-failure state, queued insert rejection, queued embedding rejection, drain waiting for already running inserts, later running-insert failure preserving the first insert error, and existing cancellation behavior.
- Context accelerator test covers mocked vector DB failure propagation with `Indexing batch <id> failed during insert: ...`, waits for the already running insert before the indexing promise rejects, prevents queued vector insert calls from starting, and checks no `unhandledRejection` is emitted.
