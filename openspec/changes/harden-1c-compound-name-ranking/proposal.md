## Why

The `improve-1c-scenario-ranking` change raised the large `demo-do30-1c` strict quality gate to Top-1 `21/30` and Top-5 `24/30`, but six strict misses remain. Directly adding fixture-specific rules for those misses would risk overfitting, so the next step is to improve the generic `one-c` matching of natural Russian queries to compound 1C metadata names and prove the behavior on held-out and negative cases.

## What Changes

- Add a held-out 1C scenario evaluation set focused on compound metadata-name matching, negative controls, and currently missed intent classes.
- Improve `rankingProfile=one-c` ranking by normalizing and matching compound 1C object, form, command, constant, manager-module, and object-module names against natural-language query phrases.
- Keep scenario-specific labels, query IDs, expected prefixes, and fixture notes out of production ranking code.
- Add negative tests so generic domain terms such as email, EDI, МЧД, archive, state, signature, and counterparty do not force unrelated exact-name matches.
- Add live comparison gates against the current tuned `demo-do30-1c` final report and a new holdout report, requiring no query-level regressions before acceptance.
- Non-goal: change Qdrant schema, BGE-M3 storage shape, ColBERT vectors, chunking, indexing scope, or worker scheduling.
- Non-goal: require strict `30/30` Top-1 on `demo-do30-1c`; the goal is robust ranking behavior, not a fixture-only perfect score.
- Non-goal: broaden strict labels merely to improve aggregate metrics without source inspection.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `code-symbol-retrieval`: strengthen the production `one-c` ranking contract for compound 1C metadata-name intent while preserving broad-query and exact/provider-backed behavior.
- `demo-1c-retrieval-ranking`: extend the evaluation contract with holdout and negative-control checks that prevent overfitting to the known `demo-do30-1c` residual misses.

## Impact

- Affected code:
  - `packages/core/src/code-symbol-retrieval.ts`
  - `packages/core/src/context.code-symbol-retrieval.test.ts`
  - `scripts/run-demo-1c-relevance-eval.js`
  - `scripts/run-demo-1c-live-mcp-eval.js` or `scripts/run-demo-do30-1c-live-mcp-eval.js` if acceptance wiring needs new defaults
  - `evaluation/retrieval/` for holdout and negative-control datasets
- Affected APIs:
  - No MCP tool schema change is expected.
  - Evaluation reports may gain holdout and negative-control sections or separate artifact paths.
- Affected systems:
  - `search_code` result ordering for BSL/1C codebases using `rankingProfile=one-c`.
  - Local Qdrant live validation for `examples/demo-do30-1c`.
- Migration impact:
  - Existing indexed collections should not require reindexing because this is a ranking and evaluation change only.
  - Existing Qdrant, Milvus, and LanceDB indexes may return differently ordered 1C results when queries contain compound metadata-name intent.
