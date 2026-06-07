## 1. Failure Classification

- [ ] 1.1 Add typed BGE-M3 worker failure reasons for startup, health, metadata, embedding timeout, embedding error, cancellation, and unknown failures.
- [ ] 1.2 Thread failure reason and retry safety through worker-pool batch results.
- [ ] 1.3 Ensure cancellation failures do not inflate instability counters.
- [ ] 1.4 Add unit tests for failure classification and retry-safe versus non-retry-safe errors.

## 2. Recovery and Retry Policy

- [ ] 2.1 Add explicit worker cooldown and recovery validation before rejected workers can become active again.
- [ ] 2.2 Enforce retry budget per batch and surface exhausted budget errors.
- [ ] 2.3 Keep healthy workers accepting work while rejected workers recover.
- [ ] 2.4 Add tests for rejected worker recovery, permanent rejection, and retry-budget exhaustion.

## 3. Status and Benchmark Output

- [ ] 3.1 Extend accelerator status with retry counts by reason and worker rejection/recovery summaries.
- [ ] 3.2 Update daemon/indexing status text to summarize retry overhead without dumping batch history.
- [ ] 3.3 Update `scripts/measure-indexing-baseline.js` to persist compact retry/rejection summaries.
- [ ] 3.4 Add tests or fixture checks for compact benchmark output.

## 4. Verification

- [ ] 4.1 Run targeted BGE-M3 worker pool and accelerator scheduler tests.
- [ ] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [ ] 4.3 Run a small accelerated benchmark on `examples/demo-1c` and confirm retries/rejections are visible.
- [ ] 4.4 Run an accelerated sample on `examples/demo-do30-1c` long enough to compare retry overhead with the previous 25%/14.5m observation.
- [ ] 4.5 Run `pnpm exec openspec validate indexing-perf-01-stabilize-embedding-worker-throughput --strict`.
