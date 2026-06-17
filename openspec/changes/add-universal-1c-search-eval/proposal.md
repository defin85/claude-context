## Why

The current 1C ranking work is still evaluated mostly on `demo-1c` and `demo-do30-1c`, so a ranking improvement can look good while remaining tuned to one exported configuration. We now have multiple local real configurations (`demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c`), which makes it possible to evaluate generic 1C search behavior across domains instead of adding fixture-specific rules.

## What Changes

- Add a committed universal 1C search evaluation dataset built around reusable developer intents such as document posting, forms, commands, reports, registers, email, EDI, signatures, accounting, trade, warehouse, and production scenarios.
- Model applicability per configuration so the same universal query can be evaluated only where the scenario exists, with strict and acceptable path prefixes scoped to each fixture.
- Add negative-control queries that prevent broad words such as `форма`, `подпись`, `настройки`, `контрагент`, `почта`, or `менеджер` from forcing unrelated exact-looking candidates to the top.
- Extend scoring and reports so they summarize quality by configuration, domain, intent, positive/negative-control class, and query-level regressions.
- Require live or saved-result comparison across `examples/demo-do30-1c`, `examples/demo-bp30-1c`, `examples/demo-ut-1c`, and `examples/demo-unf-1c` before using the universal dataset as acceptance evidence.
- Keep universal query IDs, expected prefixes, applicability statuses, notes, and domain labels out of production ranking code.
- Non-goal: tune separate production weights per configuration name or configuration synonym.
- Non-goal: require every universal query to apply to every configuration.
- Non-goal: replace the existing `demo-1c` and `demo-do30-1c` baselines; the universal matrix complements them as cross-configuration evidence.
- Non-goal: change Qdrant schema, BGE-M3 storage shape, ColBERT vectors, indexing scope, chunking, or worker scheduling.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `demo-1c-retrieval-ranking`: extend the 1C evaluation contract from single-fixture datasets to a multi-configuration universal-intent matrix with applicability, domain grouping, and negative controls.
- `code-symbol-retrieval`: strengthen the production ranking contract so future `one-c` ranking changes are validated through generic intent evidence and remain independent from universal evaluation labels.

## Impact

- Affected code:
  - `evaluation/retrieval/` for the universal 1C query matrix and optional per-configuration label manifests.
  - `scripts/run-demo-1c-relevance-eval.js` for matrix loading, applicability handling, negative-control scoring, and grouped summaries.
  - `scripts/run-demo-1c-live-mcp-eval.js` or sibling runners for multi-fixture live collection.
  - `scripts/run-demo-1c-relevance-eval.test.js` for dataset validation, scoring, and regression checks.
  - `openspec/changes/*/verification.md` and generated `.artifacts/` reports for acceptance evidence.
- Affected APIs:
  - No MCP `search_code` schema change is expected.
  - Evaluation report JSON will gain matrix, domain, intent, applicability, and negative-control fields.
- Affected systems:
  - Local live validation can run against the ignored example fixtures under `examples/demo-do30-1c`, `examples/demo-bp30-1c`, `examples/demo-ut-1c`, and `examples/demo-unf-1c`.
  - Production `search_code` ordering may be tuned later based on this evidence, but this change itself establishes the evaluation contract.
- Migration impact:
  - Existing indexed collections should not require reindexing because this is evaluation and reporting work.
  - Existing single-fixture reports remain valid; universal-matrix reports are a new artifact shape.
  - Existing acceptance thresholds remain separate until universal matrix baselines are measured and documented.
