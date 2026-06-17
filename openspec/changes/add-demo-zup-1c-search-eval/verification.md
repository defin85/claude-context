# Verification

## Source Snapshot

- `examples/demo-zup-1c` export is present.
- Total files: `48986`.
- BSL modules matched by `*/Ext/*Module.bsl` or `*/Forms/*/Ext/Form/Module.bsl`: `12239`.
- Shallow directories under the export: `8528`.

## Matrix Validation

- `demo-zup-1c` was added to `evaluation/retrieval/universal-1c-search-matrix.json`.
- ZUP matrix label validation against `examples/demo-zup-1c`:
  - query count: `61`;
  - applicable targets: `39`;
  - not-applicable targets: `19`;
  - needs-inspection targets: `3`;
  - strict prefixes: `31`;
  - acceptable prefixes: `29`;
  - unreachable prefixes: `0`;
  - target issues: `0`.
- Remaining `needs-inspection` ZUP rows: `u03`, `u04`, `u05`.
  These are MCHD rows where ZUP has MCHD-related sources, but the exact constants or setting from the original DO30 query were not source-backed in the inspected export.

## Commands Run

- `node --test scripts/run-demo-1c-relevance-eval.test.js`
- `pnpm build:core`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `openspec validate --type change add-demo-zup-1c-search-eval --strict`

## Live Indexing

- Submitted `examples/demo-zup-1c` to the MCP indexer with:
  - `oneCIndexScopeProfile=developer`;
  - `retrievalProfile=quality`;
  - `splitter=ast`.
- Submission result: `startedImmediately=false`, `queuePosition=1`.
- Later daemon status showed `demo-zup-1c` as `indexing`, while the global workload still had `activeCount=1` and `queuedCount=2`.
- Do not run the ZUP live evaluation until `get_indexing_status` for `examples/demo-zup-1c` reports an indexed/completed status.

## Pending Live Artifacts

Expected ZUP live command after indexing completes:

```bash
node scripts/run-demo-zup-1c-live-mcp-eval.js
```

Expected artifact directory pattern:

```text
.artifacts/hybrid-code-symbol-retrieval/*-demo-zup-1c-live/
```

Required files from the live run:

- `raw-results.json`
- `summary.json`
- `summary.md`
- `label-validation.json`
- `comparison.json`, only when a baseline is supplied.

