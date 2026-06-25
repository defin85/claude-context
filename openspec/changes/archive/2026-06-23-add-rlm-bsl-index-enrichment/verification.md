# Verification Evidence

## RLM Snapshot Provider

- `cd /run/media/egor/D6B64A72B64A52E3/Projects/OneC/rlm-tools-bsl && .venv/bin/pytest tests/test_symbol_provider.py`
  - Result: passed, 14 tests.
- `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/rlm-tools-bsl/.venv/bin/rlm-bsl-index provider export /run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c --json`
  - Result: JSON snapshot emitted on stdout.
  - Provider: `rlm-tools-bsl`.
  - Status: `available`.
  - Source fingerprint: `6b2037f15ef40a410e611194ea5786e88aee0effd5eb3f5b0edab86406cf0b68`.
  - Files: 129.
- RLM MCP index checks:
  - `examples/demo-1c`: indexed, 129 modules, 847 methods.
  - `examples/demo-bp30-1c`: indexed, 18425 modules.

## Targeted Automated Tests

- `pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts rlm-bsl-enrichment.test.ts context.rlm-bsl-enrichment.test.ts qdrant-vectordb.test.ts rlm-bsl-adapter-compat.test.ts`
  - Result: passed, 5 suites, 76 tests.

## Build and Static Checks

- `pnpm --filter @zilliz/claude-context-core typecheck`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-mcp test -- codebase-config.rlm-bsl-enrichment.test.ts`
  - Result: no package test script is defined; no tests were executed.
- `pnpm build:core`
  - Result: passed.
- `pnpm build:mcp`
  - Result: passed.
- `pnpm lint`
  - Result: passed.
- `pnpm build`
  - Result: passed.
- `pnpm exec openspec validate --type change add-rlm-bsl-index-enrichment --strict`
  - Result: passed.

## Live `demo-1c` Optional Enrichment Acceptance

The live MCP daemon was restarted with:

- `RLM_BSL_ENRICHMENT_MODE=optional`
- `RLM_BSL_ENRICHMENT_COMMAND=/run/media/egor/D6B64A72B64A52E3/Projects/OneC/rlm-tools-bsl/.venv/bin/rlm-bsl-index`
- `RLM_BSL_ENRICHMENT_ARGS_JSON=["provider","export","{codebasePath}","--json"]`
- `RLM_BSL_ENRICHMENT_TIMEOUT_MS=30000`

Forced reindex command:

- MCP `index_codebase` for `/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c`
  - `force=true`
  - `oneCIndexScopeProfile=developer`
  - `retrievalProfile=quality`

Post-index MCP status:

- Status: `indexed`.
- Indexed files: 129.
- Total chunks: 893.
- RLM BSL enrichment mode: `optional`.
- Provider: `rlm-tools-bsl`.
- Status: `available`.
- Raw status: `available`.
- Provider schema version: 1.
- Source root matches codebase: `true`.
- Source fingerprint: `6b2037f15ef40a410e611194ea5786e88aee0effd5eb3f5b0edab86406cf0b68`.

Live evaluation command:

```bash
node scripts/run-demo-1c-live-mcp-eval.js \
  --codebase-path /run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c \
  --dataset evaluation/retrieval/demo-1c-relevance.json \
  --limit 10 \
  --ranking-profile one-c \
  --one-c-index-scope-profile developer \
  --run-name 2026-06-18T19-14-rlm-demo-1c-optional-final \
  --raw-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional/raw-results.json \
  --out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional/summary.json \
  --markdown-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional/summary.md \
  --label-validation-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional/label-validation.json
```

Live evaluation result:

- Query count: 30.
- Tool errors: 0.
- Missing ColBERT vector errors: 0.
- Hit@1: 19/30, 63.33%.
- Hit@3: 26/30, 86.67%.
- Hit@5: 28/30, 93.33%.
- Hit@10: 29/30, 96.67%.
- MRR@10: 0.7525.
- Precision@10: 0.39.
- Residual failures: 1 query; the markdown report lists the failing row instead of hiding it behind aggregate metrics.
- Report includes RLM BSL enrichment mode, provider, status, configured flag, and source fingerprint.
- Search diagnostics in raw results include stored `metadata.bsl`, `storedBslSymbolName`, semantic score, lexical score, path boosts, intent boosts, and fusion score.

Artifacts:

- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional/raw-results.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional/summary.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional/summary.md`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional/label-validation.json`

## Live `demo-1c` Disabled Versus Search-Time RLM Versus Indexed RLM Rerun

Date: 2026-06-19.

Provider snapshot check:

- `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/rlm-tools-bsl/.venv/bin/rlm-bsl-index provider export /run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c --json`
  - Provider: `rlm-tools-bsl`.
  - Status: `available`.
  - Source fingerprint: `6b2037f15ef40a410e611194ea5786e88aee0effd5eb3f5b0edab86406cf0b68`.
  - Files: 129.

Disabled RLM reindex:

- The MCP daemon was restarted with `RLM_BSL_ENRICHMENT_MODE=disabled`.
- The previous per-codebase persisted RLM configuration was cleared with MCP `clear_index` before the forced reindex, because a force reindex alone preserved the prior per-codebase RLM mode in the daemon session configuration.
- MCP `index_codebase` was run for `examples/demo-1c` with:
  - `force=true`
  - `oneCIndexScopeProfile=developer`
  - `retrievalProfile=quality`
- Post-index MCP status:
  - Status: `indexed`.
  - Indexed files: 129.
  - Total chunks: 893.
  - RLM BSL enrichment mode: `disabled`.
  - Configured: `false`.
  - Command configured: `false`.
- A targeted search confirmed there was no stored `metadata.bsl`, no `storedBslSymbolName`, and no symbol provider diagnostics.

Disabled RLM live evaluation:

```bash
node scripts/run-demo-1c-live-mcp-eval.js \
  --codebase-path /run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c \
  --dataset evaluation/retrieval/demo-1c-relevance.json \
  --limit 10 \
  --ranking-profile one-c \
  --one-c-index-scope-profile developer \
  --backend-label qdrant-demo-1c-disabled-no-provider \
  --run-name 2026-06-19T14-03-demo-1c-disabled-no-provider \
  --artifact-dir .artifacts/rlm-bsl-index-enrichment \
  --raw-out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/raw-results.json \
  --out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/summary.json \
  --markdown-out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/summary.md \
  --label-validation-out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/label-validation.json \
  --allowBelowAcceptanceThreshold
```

Disabled RLM live evaluation result:

- Query count: 30.
- Tool errors: 0.
- Missing ColBERT vector errors: 0.
- Hit@1: 28/30, 93.33%.
- Hit@3: 30/30, 100%.
- Hit@5: 30/30, 100%.
- Hit@10: 30/30, 100%.
- MRR@10: 0.9667.
- Precision@10: 0.49.
- Raw diagnostics counts: 0 results with `metadata.bsl`, 0 stored BSL symbol results, 0 symbol provider results, 0 available provider diagnostics.

Search-time RLM provider over the disabled index:

- The MCP daemon was temporarily restarted with the disabled index still in place and the search-time `rlm-tools-bsl` symbol provider configured.
- A targeted search for `ОбработкаПроведения` showed provider availability and symbol-provider boosting:
  - Provider diagnostics status: `available`.
  - First result retrieval sources included `symbol_provider`.
  - Provider: `rlm-tools-bsl`.
- The full evaluation used the disabled RLM run above as the baseline:

```bash
node scripts/run-demo-1c-live-mcp-eval.js \
  --codebase-path /run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c \
  --dataset evaluation/retrieval/demo-1c-relevance.json \
  --limit 10 \
  --ranking-profile one-c \
  --one-c-index-scope-profile developer \
  --backend-label qdrant-demo-1c-disabled-searchtime-rlm \
  --run-name 2026-06-19T14-07-demo-1c-disabled-searchtime-rlm \
  --artifact-dir .artifacts/rlm-bsl-index-enrichment \
  --raw-out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/raw-results.json \
  --out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/summary.json \
  --markdown-out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/summary.md \
  --label-validation-out .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/label-validation.json \
  --baseline .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/summary.json \
  --baseline-mode disabled-no-provider \
  --allowBelowAcceptanceThreshold \
  --allowNoBaselineImprovement \
  --allowQueryRegressions
```

Search-time RLM provider live evaluation result:

- Query count: 30.
- Tool errors: 0.
- Missing ColBERT vector errors: 0.
- Hit@1: 28/30, 93.33%.
- Hit@3: 30/30, 100%.
- Hit@5: 30/30, 100%.
- Hit@10: 30/30, 100%.
- MRR@10: 0.9667.
- Precision@10: 0.49.
- Raw diagnostics counts: 0 results with `metadata.bsl`, 0 stored BSL symbol results, 0 symbol provider results, 300 available provider diagnostics.

Optional indexed RLM reindex:

- The MCP daemon was restarted with optional index-time RLM enrichment:
  - `RLM_BSL_ENRICHMENT_MODE=optional`
  - `RLM_BSL_ENRICHMENT_COMMAND=/run/media/egor/D6B64A72B64A52E3/Projects/OneC/rlm-tools-bsl/.venv/bin/rlm-bsl-index`
  - `RLM_BSL_ENRICHMENT_ARGS_JSON=["provider","export","{codebasePath}","--json"]`
  - `RLM_BSL_ENRICHMENT_TIMEOUT_MS=30000`
- MCP `index_codebase` was run for `examples/demo-1c` with:
  - `force=true`
  - `oneCIndexScopeProfile=developer`
  - `retrievalProfile=quality`
- Post-index MCP status:
  - Status: `indexed`.
  - Indexed files: 129.
  - Total chunks: 893.
  - RLM BSL enrichment mode: `optional`.
  - Configured: `true`.
  - Command configured: `true`.
  - Provider: `rlm-tools-bsl`.
  - Status: `available`.
  - Raw status: `available`.
  - Provider schema version: 1.
  - Source root matches codebase: `true`.
  - Source fingerprint: `6b2037f15ef40a410e611194ea5786e88aee0effd5eb3f5b0edab86406cf0b68`.
- A targeted search for `ОбработкаПроведения` confirmed stored RLM payloads:
  - Results included `metadata.bsl`.
  - `storedBslSymbolName` was populated.
  - Search-time provider diagnostics were empty, because stored index-time RLM payloads were used.

Optional indexed RLM live evaluation:

```bash
node scripts/run-demo-1c-live-mcp-eval.js \
  --codebase-path /run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c \
  --dataset evaluation/retrieval/demo-1c-relevance.json \
  --limit 10 \
  --ranking-profile one-c \
  --one-c-index-scope-profile developer \
  --backend-label qdrant-demo-1c-optional-index-rlm \
  --run-name 2026-06-19T14-12-demo-1c-optional-index-rlm \
  --artifact-dir .artifacts/rlm-bsl-index-enrichment \
  --raw-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/raw-results.json \
  --out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/summary.json \
  --markdown-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/summary.md \
  --label-validation-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/label-validation.json \
  --baseline .artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/summary.json \
  --baseline-mode disabled-no-provider \
  --compare-out .artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/comparison-vs-disabled.json \
  --allowBelowAcceptanceThreshold \
  --allowNoBaselineImprovement \
  --allowQueryRegressions
```

Optional indexed RLM live evaluation result:

- Query count: 30.
- Tool errors: 0.
- Missing ColBERT vector errors: 0.
- Hit@1: 19/30, 63.33%.
- Hit@3: 26/30, 86.67%.
- Hit@5: 28/30, 93.33%.
- Hit@10: 29/30, 96.67%.
- MRR@10: 0.7525.
- Precision@10: 0.39.
- Raw diagnostics counts: 252 results with `metadata.bsl`, 160 stored BSL symbol results, 0 symbol provider results, 0 available provider diagnostics.
- Comparison against the disabled RLM baseline found 0 improvements and 11 regressions.
- Strict miss: `r19`.
- Rank regressions: `r03` 2 -> 5, `r08` 1 -> 4, `r09` 1 -> 3, `r10` 1 -> 2, `r11` 1 -> 2, `r12` 1 -> 2, `r13` 2 -> 3, `r19` 1 -> miss, `r28` 1 -> 3, `r29` 1 -> 2, `r30` 1 -> 8.

Artifacts:

- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/raw-results.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/summary.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/summary.md`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled/label-validation.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/raw-results.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/summary.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/summary.md`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-disabled-searchtime-rlm/label-validation.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/raw-results.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/summary.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/summary.md`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/label-validation.json`
- `.artifacts/rlm-bsl-index-enrichment/demo-1c-optional-rerun/comparison-vs-disabled.json`

Conclusion:

- Search-time RLM provider availability works over a disabled, non-enriched index, but it did not change aggregate metrics for this 30-query `demo-1c` set.
- Index-time RLM enrichment is present in stored payloads and live search diagnostics, but the current ranking blend regresses the `demo-1c` matrix against the disabled baseline.
- This rerun is evidence for `demo-1c` only; it does not close the universal enriched/non-enriched 1C relevance matrix task.

## Not Yet Covered

- `examples/demo-bp30-1c` required-mode enriched reindex was not run in this pass.
- The universal enriched/non-enriched 1C relevance matrix was not run in this pass.
- BP `needs-inspection` label review was not run in this pass.
