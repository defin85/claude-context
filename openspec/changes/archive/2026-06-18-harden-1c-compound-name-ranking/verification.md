# Verification

## Focused Tests

- `node --test scripts/run-demo-1c-relevance-eval.test.js` - passed, 33 tests.
- `node --test scripts/run-demo-1c-relevance-eval.test.js` - passed after finish-to-100 closure, 35 tests.
- `node --test scripts/run-demo-1c-relevance-eval.test.js` - passed after default demo-do30 baseline hardening, 36 tests.
- `pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts` - passed, 42 tests.
- `pnpm build:core` - passed.
- `systemctl --user restart claude-context-mcp.service` - daemon restarted and reported `active`.

## Live Evaluation Reports

- Existing demo-1c workflow:
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-1c/summary.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-1c/raw-results.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-1c/label-validation.json`
  - Result: Hit@10 `30/30`, MCP tool errors `0`, missing ColBERT vector errors `0`.

- Final demo-do30 live evaluation:
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-rerun/summary.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-rerun/raw-results.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-rerun/label-validation.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-rerun/comparison.json`
  - Result: strict Top1 `23/30`, strict Top5 `26/30`, strict Top10 `26/30`, query-level regressions `0`, improvements `4`, MCP tool errors `0`, missing ColBERT vector errors `0`.

- Finish-to-100 demo-do30 acceptance replay with tightened query-level regression gate:
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-finish-harden-compound-demo-do30/summary.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-finish-harden-compound-demo-do30/comparison.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-finish-harden-compound-demo-do30/label-validation.json`
  - Result: strict Top1 `23/30`, strict Top5 `26/30`, strict Top10 `26/30`, query-level regressions `0`, improvements `4`, strict Top1 gate `21`, strict Top5 gate `24`, MCP tool errors `0`, missing ColBERT vector errors `0`.
  - Default runner hardening: `scripts/run-demo-do30-1c-live-mcp-eval.js` now fails fast when neither an explicit `--baseline` nor the preserved tuned baseline artifact is available, so non-regression acceptance cannot silently run without query-level comparison.

- Compound-name holdout live evaluation:
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-holdout-rerun/summary.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-holdout-rerun/raw-results.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-holdout-rerun/label-validation.json`
  - Result: strict positive Top10 `4/8`, negative controls `5/5`, unreachable strict prefixes `0`, MCP tool errors `0`, missing ColBERT vector errors `0`.
  - The final positive threshold is fixed at `4/8` for this change because the remaining strict misses require retrieval or storage changes outside this change scope.

- Finish-to-100 compound-name holdout acceptance replay:
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-finish-harden-compound-holdout/summary.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-finish-harden-compound-holdout/label-validation.json`
  - Result: strict positive Top10 `4/8`, negative controls `5/5`, strict positive gate `4`, negative-control gate `5`, unreachable strict prefixes `0`, MCP tool errors `0`, missing ColBERT vector errors `0`.

- Universal matrix supporting evidence:
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-universal/summary.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-universal/raw-results.json`
  - `.artifacts/hybrid-code-symbol-retrieval/2026-06-18-harden-compound-demo-do30-universal/label-validation.json`
  - Result: positive strict Top10 `24/33`, negative controls `6/6`, unreachable strict prefixes `0`, MCP tool errors `0`, missing ColBERT vector errors `0`.
