## Verification

### Focused checks

- `pnpm --filter @zilliz/claude-context-core test -- --runTestsByPath src/embedding/bge-m3-embedding.test.ts src/indexing-accelerator.test.ts`
  - Result: passed, `35/35`.
  - Covers BGE-M3 failure cause normalization, sanitized request-shape evidence, worker recovery diagnostics, and accelerator failure category summaries.
- `.venv-bge-m3/bin/python -m unittest test_bge_m3_sidecar.py` from `python/`
  - Result: passed, `8` tests, `0` skipped.
  - Covers response normalization, direct sidecar diagnostic logger sanitization, FastAPI endpoint diagnostics, and redaction of exception messages that contain raw payload text.
  - Uses `httpx2` for `starlette.testclient`; the legacy `httpx` package is not installed in this venv.
- `node scripts/measure-indexing-baseline.js --self-test-compact-output`
  - Result: passed.
  - Covers compact benchmark artifact shaping, including `failureDiagnostics`.
- `pnpm build:core`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-core typecheck`
  - Result: passed.
- `pnpm build:mcp`
  - Result: passed.
- `pnpm exec openspec validate investigate-bge-m3-fetch-failures --strict`
  - Result: passed.

### Diagnostic matrix artifacts

Artifact root:
`openspec/changes/investigate-bge-m3-fetch-failures/diagnostic-artifacts/`

Aggregate summary:
`diagnostic-artifacts/diagnostic-matrix-summary.json`

Runs:

- `2026-06-14T17-59-10-673Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert4-adaptivetrue/`
  - BGE-M3 full, Qdrant, coalescing, insert concurrency `4`, workers `1`, payload caps `20000/5000`.
  - Result: `retriedBatches=0`, `failedInsertBatches=0`, final insert backlog `0`.
- `2026-06-14T18-04-29-492Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert4-adaptivetrue/`
  - BGE-M3 full, Qdrant, coalescing, insert concurrency `4`, workers `2`, payload caps `20000/5000`.
  - Result: `retriedBatches=0`, `failedInsertBatches=0`, final insert backlog `0`.
- `2026-06-14T18-09-51-228Z-auto-scopefull-embbatch100-insertbatch100-maxchars20000-maxtokens5000-insert4-adaptivetrue/`
  - BGE-M3 full, Qdrant, coalescing, insert concurrency `4`, workers `4`, payload caps `20000/5000`.
  - Result: `retriedBatches=10`, all `embedding_error`, all `fetch_failed`, all retry-safe, `failedInsertBatches=0`, final insert backlog `0`.
  - Captured cause: `TypeError: fetch failed`, `causeName=SocketError`, `causeCode=UND_ERR_SOCKET`, `causeMessage=other side closed`.
  - Captured request shape examples: payload bytes `36502`, `37377`, `36728`, `38113`; content chars near `19151..19887`; estimated tokens near `4791..4985`.
- `2026-06-14T18-15-09-984Z-auto-scopefull-embbatch100-insertbatch100-maxchars10000-maxtokens2500-insert4-adaptivetrue/`
  - BGE-M3 full, Qdrant, coalescing, insert concurrency `4`, workers `4`, smaller payload caps `10000/2500`.
  - Result: `retriedBatches=0`, `failedInsertBatches=0`, final insert backlog `0`.

No dense-only control was run; all acceptance evidence is full dense+sparse+ColBERT mode.

### Root-cause classification

Dominant cause category: client transport reset under combined worker-count and request-size pressure.

Evidence:

- Failures reproduced only in the `4` worker, current payload `20000/5000` run.
- Captured low-level cause was `UND_ERR_SOCKET` with `other side closed`, classified as `fetch_failed`.
- `1` and `2` worker runs with the same payload caps had zero retries.
- `4` workers with smaller `10000/2500` payload caps also had zero retries.
- Qdrant insert pressure is rejected: all four runs had `failedInsertBatches=0` and final insert backlog `0`.
- Timeout and cancellation paths are rejected: captured failures had `timeoutOrCancellationState=none`, and category counts for `timeout` and `cancellation` were zero.
- Metadata/startup mismatch is rejected: category counts for `metadata` and `startup` were zero.
- HTTP response error is rejected for the reproduced symptom: category count for `http_error` was zero; failures occurred before a usable HTTP response.

### Decision

No new worker count, payload cap, retry budget, scheduler, or Qdrant insert default is promoted by this change.

A follow-up implementation change is warranted. The likely fix space is to reduce or adapt BGE-M3 full request pressure before socket resets happen, for example by payload caps, worker-aware payload sizing, or a sidecar/client transport change. That should be proposed separately with this diagnostic evidence as input.

### Residual risks

- The current artifacts classify the transport reset at the Node fetch boundary. They do not prove whether the immediate close originates in Uvicorn/FastAPI response writing, model-side runtime pressure, CUDA memory behavior, or process-level transport handling.
- Live sidecar structured request outcome logging is implemented and unit-smoked, but the diagnostic matrix was run before enabling INFO logging by default. The captured matrix therefore relies on client-side cause evidence and journal rejection/recovery lines for live classification.
- FastAPI endpoint diagnostic tests pass in `python/.venv-bge-m3` with `httpx2`; the system `python3` on this host is currently Python 3.14 without `pip`, so sidecar checks should use the repository venv.
