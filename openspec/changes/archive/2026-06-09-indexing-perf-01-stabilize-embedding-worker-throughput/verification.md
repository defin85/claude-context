# Verification

## Automated Checks

- `pnpm --filter @zilliz/claude-context-core test -- bge-m3-embedding.test.ts embedding-batch-scheduler.test.ts --runInBand`
  - Result: passed, 22 tests.
  - Includes regression coverage for primary metadata rejection, bounded no-healthy-worker handling, and retry-budget exhausted worker context.
- `pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts --runInBand`
  - Result: passed, 15 tests.
- `pnpm --filter @zilliz/claude-context-core typecheck`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/worker-planning-policy.test.ts`
  - Result: passed, 8 tests.
- `node scripts/measure-indexing-baseline.js --self-test-compact-output`
  - Result: passed.
  - Closure update 2026-06-08: self-test now covers accelerator status samples that already omit full `batches`; compact `retrySummary` and `workerSummary` are still persisted, while `batchesSummary` remains conditional on real batch history.
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
  - Result: passed after rebuilding core declarations.
- `pnpm lint`
  - Result: passed with existing warnings in core, chrome extension, and VS Code extension packages.
- `pnpm build`
  - Result: passed.
- `pnpm typecheck`
  - Result: passed after `pnpm build`.
  - Note: an earlier parallel run overlapped with `pnpm build` cleaning `packages/core/dist`, causing transient TS6305 errors in the VS Code extension.
- `pnpm exec openspec validate indexing-perf-01-stabilize-embedding-worker-throughput --strict`
  - Result: passed.

## Review Closure

Closed gaps from implementation review:

- Primary BGE-M3 metadata incompatibility now rejects the primary worker before worker-pool batch dispatch.
- When all workers are rejected, the provider no longer revives the primary worker without cooldown and health plus metadata validation.
- Retry-budget exhaustion now reports retry attempt count and last worker failure context.
- Initialization and recovery validation classify `/health` and `/metadata` failures by the failing stage instead of collapsing both into one catch path.
- Benchmark compacting now adds retry and worker summaries even when live status has already omitted full batch history.

## Live Daemon Restart

Command:

```bash
node packages/mcp/dist/index.js --daemon-restart
```

Result:

- restarted daemon runtime: `cfb5a351-1233-4f97-a9f5-05969ed8d82e`
- pid: `421637`
- endpoint: `http://127.0.0.1:39393/mcp`

The restart also cleaned stale daemon runtime artifacts and removed one no-longer-existing codebase path during snapshot post-load migration.

## Small Accelerated Benchmark: demo-1c

Target:

- `/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c`

Artifact:

- `.artifacts/indexing-perf-01/2026-06-07T19-04-42Z-demo-1c/final-status.json`
- `.artifacts/indexing-perf-01/2026-06-07T19-04-42Z-demo-1c/summary.json`

Result:

- final status: `indexed`
- indexed files: `129`
- total chunks: `893`
- accelerator active: `true`
- active workers: `4`
- rejected workers: `0`
- submitted batches: `28`
- completed batches: `28`
- retried batches: `1`
- retry reasons: `embedding_error=1`
- retry-safe failures: `1`

This confirms retry/rejection summaries are visible in live structured status.

## Accelerated Sample: demo-do30-1c

Target:

- `/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-do30-1c`

Artifact:

- `.artifacts/indexing-perf-01/2026-06-07T19-05-02Z-demo-do30/samples.jsonl`
- `.artifacts/indexing-perf-01/2026-06-07T19-05-02Z-demo-do30/latest.json`
- `.artifacts/indexing-perf-01/2026-06-07T19-05-02Z-demo-do30/summary.json`

Result:

- monitored sample count: `5`
- reached `11%` before operator-requested stop window
- final status after explicit cancel: `indexfailed`
- submitted batches: `125`
- completed batches: `99`
- failed batches: `4`
- retried batches: `7`
- retry reasons: `embedding_error=7`
- retry-safe failures: `7`
- retry-unsafe failures: `0`
- active workers: `4`
- rejected workers: `0`
- backpressure wait: `95098ms`

The run was intentionally stopped at the requested 10-15% window instead of continuing toward the previous 25%/14.5m observation.
