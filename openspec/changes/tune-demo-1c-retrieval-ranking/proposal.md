## Why

The Qdrant BGE-M3 full backend now completes live `examples/demo-1c` search without missing ColBERT errors, but the 30-query acceptance set still scores only Hit@10 18/30. The remaining problem is ranking quality: search often finds the right domain but over-ranks broad 1C modules, generic forms, or repeated chunks over the expected metadata object.

## What Changes

- Add a reproducible ranking evaluation workflow for the existing `evaluation/retrieval/demo-1c-relevance.json` dataset and live MCP `search_code` output.
- Record a baseline from the current Qdrant default path before tuning, including Hit@10, per-query misses, top paths, and score-component diagnostics.
- Improve 1C-aware ranking signals for code-symbol retrieval fusion:
  - metadata object name and object kind matches in paths;
  - form intent such as item card, list form, document form, command, report, register, catalog, and document;
  - duplicate-result control so one file cannot crowd out more specific expected objects;
  - safer balance between semantic, lexical, path, exact-symbol, and provider-rank scores.
- Keep the relevance dataset as evaluation truth only; production search must not route queries by pre-authored expected path prefixes.
- Add regression tests for ranking behaviors that caused the current misses.
- Add live verification artifacts for the tuned Qdrant default run and compare them against the baseline.
- Non-goal: change Qdrant storage, BGE-M3 vector insertion, ColBERT retrieval mechanics, or daemon lifecycle.
- Non-goal: make the 30-query dataset a complete product-quality benchmark for all 1C configurations.
- Non-goal: hard-code `demo-1c` labels or expected paths into production search.

## Capabilities

### New Capabilities
- `demo-1c-retrieval-ranking`: Reproducible 1C relevance evaluation and ranking tuning for the `examples/demo-1c` search acceptance set.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/core/src/code-symbol-retrieval.ts`
  - `packages/core/src/context.code-symbol-retrieval.test.ts`
  - `scripts/run-demo-1c-relevance-eval.js`
  - likely a new live MCP acceptance script under `scripts/`
  - `evaluation/retrieval/demo-1c-relevance.json` only if labels are found to be stale or insufficient, with explicit documentation
- Affected systems:
  - MCP `search_code` ranking for BSL/1C codebases using hybrid code-symbol retrieval.
  - Local Qdrant default live validation for `examples/demo-1c`.
- Migration impact:
  - Existing indexed collections should not require reindexing because this change tunes result fusion and evaluation, not stored vector schema.
  - Existing Milvus, Qdrant, and LanceDB indexes may return differently ordered results after ranking changes.
  - Operators comparing old and new results should use the recorded baseline and tuned artifacts rather than assuming identical ordering.
