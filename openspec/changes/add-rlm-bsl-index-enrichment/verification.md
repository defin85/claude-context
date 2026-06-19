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

## Not Yet Covered

- `examples/demo-bp30-1c` required-mode enriched reindex was not run in this pass.
- The universal enriched/non-enriched 1C relevance matrix was not run in this pass.
- BP `needs-inspection` label review was not run in this pass.
