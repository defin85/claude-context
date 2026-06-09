## Verification

Date: 2026-06-09

### Focused tests

- `pnpm --filter @zilliz/claude-context-core test -- indexing-accelerator.test.ts --runInBand` - passed.
- `pnpm --filter @zilliz/claude-context-core test -- context.accelerator.test.ts --runInBand` - passed.
- `node scripts/measure-indexing-baseline.js --self-test-compact-output` - passed.
- `pnpm build:core && pnpm build:mcp` - passed before daemon benchmarks.
- `pnpm exec openspec validate indexing-perf-07-payload-safe-embedding-batches --strict` - passed.
- `pnpm build:core && pnpm typecheck` - passed.
- `pnpm lint` - passed with existing warnings.
- `pnpm build` - passed with existing Chrome extension asset-size warnings.

### Deterministic payload failure harness

`context.accelerator.test.ts` includes a local embedding provider that throws
`Cannot create a string longer than 0x1fffffe8 characters`. Covered outcomes:

- successful ordered recursive split retry from 4 chunks to 2+2,
- repeated split retry from 4 chunks to 2+1+1+2+1+1,
- non-payload embedding errors are not retried as payload splits,
- single-chunk payload failure reports file path, chunk index, content chars,
  estimated tokens, retrieval mode, and provider.

### Benchmark evidence

Artifact root: `.artifacts/indexing-perf-07`.

`examples/demo-1c`, developer scope, `100/100`, BGE-M3 full effective auto caps:

- Run: `2026-06-09T11-01-06-280Z-auto-scopedeveloper-embbatch100-insertbatch100-maxcharsauto-maxtokensauto-insert1-adaptivetrue`.
- Result: `indexfailed` after 115310 ms.
- Effective caps: content chars `1000000`, estimated tokens `250000`.
- Summary: 9 submitted batches, 5 completed, 3 failed, retry rate 0.
- Error: `Indexing batch 2 failed during embedding: fetch failed`.
- Limitation: this is a rejected candidate, but the failure was sidecar/transport, not a single-chunk payload diagnostic.

`examples/demo-1c`, developer scope, `100/100`, explicit payload-safe caps:

- Run: `2026-06-09T11-03-31-439Z-auto-scopedeveloper-embbatch100-insertbatch100-maxchars50000-maxtokens12500-insert1-adaptivetrue`.
- Result: `indexed` after 104660 ms.
- Effective caps: content chars `50000`, estimated tokens `12500`.
- Summary: 14 submitted batches, 14 completed, 0 failed, retry rate 0.
- Payload split summary: 14 `content_chars` splits, max batch content chars 49866, max estimated tokens 12489.
- Insert summary: 14 completed insert batches, insertMs 15079.

`examples/demo-1c`, developer scope, `200/100`, BGE-M3 full effective auto caps:

- Run: `2026-06-09T11-05-33-985Z-auto-scopedeveloper-embbatch200-insertbatch100-maxcharsauto-maxtokensauto-insert1-adaptivetrue`.
- Result: bounded/cancelled after 136227 ms.
- Effective caps: content chars `1000000`, estimated tokens `250000`.
- Summary at cancellation: 3 submitted batches, 0 completed, 2 failed, one running.
- Payload retry split counts: failed batches recorded `payloadRetrySplitCount=2`.
- Limitation: cancelled before terminal indexing status; do not use for throughput claims.

`examples/demo-do30-1c`, developer scope, `100/100`, explicit payload-safe caps:

- Run: `2026-06-09T11-08-09-030Z-auto-scopedeveloper-embbatch100-insertbatch100-maxchars50000-maxtokens12500-insert1-adaptivetrue`.
- Result: bounded/cancelled after 129296 ms.
- Effective caps: content chars `50000`, estimated tokens `12500`.
- Summary at cancellation: 17 submitted batches, 16 completed, 0 failed, one running.
- Payload split summary: 12 `content_chars` splits and 5 `estimated_tokens` splits.
- Insert summary: 16 completed insert batches, insertMs 15889.
- Limitation: bounded run only; it supports safety/no-failure evidence but not final throughput.

### Selected defaults and rejected candidates

- Generic dense-only providers keep `INDEX_EMBEDDING_MAX_CONTENT_CHARS=auto` and
  `INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS=auto`, preserving legacy chunk-count
  behavior unless an operator sets explicit caps.
- BGE-M3 full effective auto defaults remain conservative but broad:
  content chars `1000000`, estimated tokens `250000`.
- The measured payload-safe operational candidate for local BGE-M3 full is
  content chars `50000`, estimated tokens `12500`; it indexed `examples/demo-1c`
  successfully and kept bounded `demo-do30-1c` failure-free until cancellation.
- Rejected candidates: `100/100 auto` failed with sidecar fetch failure on
  `demo-1c`; `200/100 auto` accumulated failed logical batches and was cancelled
  before completion.

### Resource notes and limitations

- Benchmarks used `INDEX_EMBEDDING_CONCURRENCY=1`,
  `INDEX_INSERT_CONCURRENCY=1`, and managed workers disabled.
- Adaptive backpressure was effectively disabled because concurrency was 1.
- No VRAM measurements were captured in these summaries.
- Bounded/cancelled runs are safety evidence only and must not be interpreted as
  wall-clock throughput wins.
