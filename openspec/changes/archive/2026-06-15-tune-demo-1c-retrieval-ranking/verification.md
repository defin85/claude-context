# Verification

## Measurement Gate

Date: 2026-06-15

Commands run:

```bash
node --check scripts/run-demo-1c-relevance-eval.js
node --check scripts/run-demo-1c-live-mcp-eval.js
node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-mcp-search-30-report.json --use-report-labels --backend-label qdrant-default-fixed-baseline --codebase-path examples/demo-1c --acceptance-threshold 24 --out .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.json --markdown-out .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.md --expect-hit-at10-count 18
node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-qdrant.json --backend-label qdrant-offline-dataset-smoke --codebase-path examples/demo-1c --acceptance-threshold 24 --validate-labels-against examples/demo-1c --out .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/demo-1c-dataset-validation-smoke-summary.json --label-validation-out .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/demo-1c-label-validation.json
systemctl --user start claude-context-mcp.service
node scripts/run-demo-1c-live-mcp-eval.js --backend-label qdrant-default-live-measurement --codebase-path examples/demo-1c --acceptance-threshold 24 --baseline .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.json --run-name live-demo-1c/current-measurement --limit 10
node scripts/run-demo-1c-live-mcp-eval.js --backend-label qdrant-default-live-measurement --codebase-path examples/demo-1c --acceptance-threshold 24 --baseline .artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-qdrant.json --run-name live-demo-1c/current-measurement-dataset-compare --limit 10
```

Artifacts:

- Preserved 18/30 baseline summary: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.json`
- Preserved 18/30 baseline Markdown: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.md`
- Dataset label validation: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/demo-1c-label-validation.json`
- Current live raw results: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/current-measurement/raw-results.json`
- Current live scored summary: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/current-measurement/summary.json`
- Current live Markdown report: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/current-measurement/summary.md`
- Same-ID comparison proof: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/current-measurement-dataset-compare/comparison.json`

Results:

- The preserved Qdrant fixed live report is scored as Hit@10 `18/30`, not a schema-induced `0/30`.
- The preserved baseline report has `0` MCP tool errors and `0` missing ColBERT errors in the original raw summary.
- `scripts/run-demo-1c-live-mcp-eval.js` executes all `30` queries from `evaluation/retrieval/demo-1c-relevance.json` against live MCP `search_code`.
- The live runner writes raw JSON, scored JSON, Markdown, label validation, and optional comparison artifacts.
- Generated artifacts include backend label, codebase path, dataset version, query count, latency, and acceptance threshold.
- Dataset label validation found `0` unreachable prefixes across `69` expected prefixes, so Hit@10 `24/30` is valid for the current reachable label set.
- The scorer normalizes supported result shapes including `results[].top10[].path`, `results[].results`, `perQuery[].topResultPaths`, and object-shaped `resultsById`.
- Same-ID comparison was verified against `.artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-qdrant.json`; it produced a comparable report with `10` improvements, `2` regressions, and `18` unchanged query outcomes.
- Comparison against the preserved 18/30 report is intentionally marked non-comparable for per-query regression accounting because that older report uses different case IDs and report-local labels.

## Ranking Tuning And Automated Verification

Date: 2026-06-15

Commands run:

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core typecheck
pnpm --filter @zilliz/claude-context-core lint
node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-mcp-search-30-report.json --use-report-labels --backend-label qdrant-default-fixed-baseline --codebase-path examples/demo-1c --acceptance-threshold 24 --out .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.json --markdown-out .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.md --expect-hit-at10-count 18
pnpm build:core
systemctl --user restart claude-context-mcp.service
node scripts/run-demo-1c-live-mcp-eval.js --backend-label qdrant-tuned-live --codebase-path examples/demo-1c --acceptance-threshold 24 --baseline .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-normalized-baseline-summary.json --run-name live-demo-1c/tuned-ranking --limit 10
node scripts/run-demo-1c-live-mcp-eval.js --backend-label qdrant-tuned-live --codebase-path examples/demo-1c --acceptance-threshold 24 --baseline .artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-qdrant.json --run-name live-demo-1c/tuned-ranking-dataset-compare --limit 10
pnpm exec openspec validate tune-demo-1c-retrieval-ranking --strict
git diff --check
```

Artifacts:

- Tuned live raw results: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking/raw-results.json`
- Tuned live scored summary: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking/summary.json`
- Tuned live Markdown report: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking/summary.md`
- Tuned live label validation: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking/label-validation.json`
- Tuned live comparison against preserved report: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking/comparison.json`
- Tuned same-ID raw results: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking-dataset-compare/raw-results.json`
- Tuned same-ID scored summary: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking-dataset-compare/summary.json`
- Tuned same-ID Markdown report: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking-dataset-compare/summary.md`
- Tuned same-ID comparison: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking-dataset-compare/comparison.json`

Implementation evidence:

- `packages/core/src/code-symbol-retrieval.ts` now adds score diagnostics for semantic score, lexical score, exact-symbol boost, path boost, provider-rank boost, base fusion score, duplicate penalty, diversity reason, final fusion score, and bounded 1C signals.
- New 1C signals are path-derived and query-derived only: object kind, metadata object name, and form/command/print intent. Production ranking code does not read query IDs, `expectedPathPrefixes`, `labelsAreProductionRules`, or `evaluation/retrieval/demo-1c-relevance.json`.
- Unknown and customized layouts are neutral for 1C-specific signals.
- Duplicate control is a soft post-fusion penalty. Exact-symbol and provider-backed results remain eligible and receive a smaller duplicate penalty.
- Diagnostics are sanitized to remove vector payload keys such as `dense`, `sparse`, and `colbertVectors`.
- Focused tests cover schema normalization, preserved 18/30 scoring, diagnostics, object-kind intent, metadata object name matching, print candidate contexts, duplicate crowding, unknown/custom layout neutrality, and production label isolation by code search.

Verification results:

- `node --test scripts/run-demo-1c-relevance-eval.test.js`: `3` tests passed.
- `pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand`: `15` tests passed.
- `pnpm --filter @zilliz/claude-context-core typecheck`: passed.
- `pnpm --filter @zilliz/claude-context-core lint`: passed with warnings only; no errors.
- `pnpm build:core`: passed.
- `pnpm exec openspec validate tune-demo-1c-retrieval-ranking --strict`: passed.
- `git diff --check`: passed.
- Qdrant `http://127.0.0.1:6333/`: version `1.18.2`.
- Live index status in tuned raw artifact: `status=indexed`, `indexStatus=completed`, retrieval mode `bge_m3_full`, schema `v1`, `oneCIndexScopeProfile=developer`, `129` files, `893` chunks, `CODE_CHUNK_LIMIT=900000`.
- Tuned live run against preserved report labels: Hit@10 `26/30`, `0` MCP tool errors, `0` missing ColBERT errors.
- Tuned same-ID live comparison: Hit@10 `26/30`, `0` MCP tool errors, `0` missing ColBERT errors, `12` improvements, `2` regressions, `16` unchanged.
- Tuned run exceeds the recorded baseline `18/30` and reaches the documented threshold `24/30`.
- The live top-result metadata includes semantic, lexical, exact-symbol, path, 1C object-kind, 1C object-name, 1C intent, duplicate penalty, diversity reason, and fusion score fields; the checked sample had no forbidden vector payload keys.

Regression review:

- `r01` regressed from rank `9` to missing in the same-ID comparison. Query: `остатки товаров на складах отчет по складу`.
- `r06` regressed from rank `6` to missing in the same-ID comparison. Query: `карточка товара реквизиты цена артикул штрихкод`.
- Remaining tuned misses are `r01`, `r05`, `r06`, and `r28`.
- The aggregate tuned result still improves the 18/30 live baseline by `8` hits and passes the 24/30 gate.

## Acceptance Gate Closure

Date: 2026-06-15

Commands run:

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
node --check scripts/run-demo-1c-relevance-eval.js
node --check scripts/run-demo-1c-live-mcp-eval.js
node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/tuned-ranking-dataset-compare/raw-results.json --backend-label qdrant-tuned-live --codebase-path examples/demo-1c --acceptance-threshold 24 --baseline .artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-qdrant.json --out /tmp/tuned-ranking-acceptance-summary.json
node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-mcp-search-30-report.json --use-report-labels --backend-label qdrant-default-fixed-baseline --codebase-path examples/demo-1c --acceptance-threshold 24 --allow-below-acceptance-threshold --out /tmp/qdrant-fixed-baseline-summary.json --expect-hit-at10-count 18
if node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-mcp-search-30-report.json --use-report-labels --backend-label qdrant-default-fixed-baseline --codebase-path examples/demo-1c --acceptance-threshold 24 --out /tmp/qdrant-fixed-baseline-should-fail.json >/tmp/qdrant-fixed-baseline-should-fail.out 2>/tmp/qdrant-fixed-baseline-should-fail.err; then echo UNEXPECTED_PASS; exit 1; else cat /tmp/qdrant-fixed-baseline-should-fail.err; fi
```

Results:

- `scripts/run-demo-1c-relevance-eval.js` and `scripts/run-demo-1c-live-mcp-eval.js` now enforce `--acceptance-threshold` as a non-zero exit condition.
- Live acceptance also fails on MCP tool errors, missing ColBERT vector errors, or lack of aggregate Hit@10 improvement over a supplied baseline unless the run passes an explicit non-acceptance override.
- Historical baseline scoring remains possible with `--allow-below-acceptance-threshold`; the preserved 18/30 baseline still scores as `18`.
- Negative proof: the preserved 18/30 baseline without the override exits unsuccessfully with `Hit@10 count 18 is below acceptance threshold 24.`
