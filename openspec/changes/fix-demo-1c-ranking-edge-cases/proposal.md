## Why

The `improve-demo-1c-ranking-residuals` change preserved the live `examples/demo-1c` baseline and improved aggregate Hit@10 to `27/30`, but it left practical 1C navigation edge cases unresolved. The remaining gaps are concentrated in stock-report lookup, mobile-device settings form lookup, the intentionally narrow print-command label, and a product-card query whose live top result is still a barcode print command.

## What Changes

- Close the residual ranking defects for `r01` stock-report intent and `r28` mobile-device common-form intent without reducing the current live `27/30` result.
- Tighten product-card ordering so barcode print or scanner commands do not outrank product card forms or product object modules solely because the query contains `штрихкод`.
- Make the `r05` print-command audit actionable by either updating evaluation truth when the object module is accepted as legitimate print context or enforcing command discoverability when the command-only label remains intentional.
- Add live-report checks that fail when residual improvements are hidden by aggregate Hit@10 gains.
- Keep all production ranking behavior generic: no query IDs, expected path prefixes, or fixture labels in production `search_code`.
- Non-goal: change BGE-M3 vector storage, Qdrant schema, ColBERT reranking, daemon lifecycle, or indexing scope.
- Non-goal: lower the current acceptance baseline or accept regressions from the final `27/30` live run.
- Non-goal: hard-code `examples/demo-1c` object names as production routing rules.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `code-symbol-retrieval`: tighten the fixed 1C residual ranking contract for stock reports, mobile-device common forms, product-card ordering, print-label audit decisions, and residual-focused live acceptance.

## Impact

- Affected code:
  - `packages/core/src/code-symbol-retrieval.ts`
  - `packages/core/src/context.code-symbol-retrieval.test.ts`
  - `scripts/run-demo-1c-relevance-eval.js`
  - `scripts/run-demo-1c-live-mcp-eval.js`
  - `scripts/run-demo-1c-relevance-eval.test.js`
  - `evaluation/retrieval/demo-1c-relevance.json` only if the `r05` audit changes evaluation truth.
- Affected systems:
  - MCP `search_code` ranking for BSL/1C codebases using hybrid code-symbol retrieval.
  - Local Qdrant default live validation for `examples/demo-1c`.
- Migration impact:
  - Existing indexed collections should not require reindexing because this is a ranking and evaluation refinement only.
  - Existing Milvus, Qdrant, and LanceDB indexes may return differently ordered results after ranking changes.
  - Operators should compare against the final residual run baseline `27/30`, not the older `26/30` or `18/30` baselines.
