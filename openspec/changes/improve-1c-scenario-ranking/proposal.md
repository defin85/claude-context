## Why

The current Qdrant + BGE-M3 `one-c` ranking is useful on `demo-do30-1c`, but the first 30-query quality probe found only `14/30` strict Top-1 hits and `20/30` strict Top-5 hits. The main failures are not indexing failures: search often finds the right subsystem, but broad common modules, generic forms, or lexical matches for words like `обработка`, `состояние`, `проверка`, and `подпись` outrank the concrete 1C scenario file the developer is trying to open.

## What Changes

- Add a committed `demo-do30-1c` scenario-ranking evaluation set derived from real source inspection, including expected files, acceptable alternate files, and notes for intentionally ambiguous cases.
- Extend live retrieval quality reporting so it separates strict expected-file hits from acceptable neighboring-context hits.
- Improve `rankingProfile=one-c` ranking for large exported 1C configurations by adding bounded scenario-aware signals for object kind, path intent, metadata object name, and query intent.
- Reduce over-ranking of generic common modules and generic lexical matches when the query clearly asks for a concrete form, document, report, constant, command, or journal scenario.
- Preserve useful broad subsystem results when the query does not express a concrete object-kind intent.
- Add focused tests for the observed failure classes: FNS response handling, saved counterparty state, inbound/outbound EDI forms, MCHD constants, send assistant forms, email print/save flows, SMS document manager versus SMS service module, and archive-transfer object/manager separation.
- Require live acceptance against the already indexed `examples/demo-do30-1c` Qdrant collection before the change can be called complete.
- Non-goal: change the Qdrant schema, BGE-M3 storage shape, ColBERT reranking storage, indexing scope, chunking, or worker scheduling.
- Non-goal: hard-code the 30 query IDs, expected paths, or `demo-do30-1c` fixture labels into production `search_code`.
- Non-goal: force every query to return a single canonical file when a neighboring file is genuinely the better development entry point.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `demo-1c-retrieval-ranking`: extend the 1C ranking contract from the small demo fixture to scenario-level quality checks on a larger exported 1C configuration, with explicit strict and acceptable-hit reporting.
- `code-symbol-retrieval`: refine the production `one-c` ranking contract so 1C object-kind and scenario intent can reorder candidates without using evaluation labels.

## Impact

- Affected code:
  - `packages/core/src/code-symbol-retrieval.ts`
  - `packages/core/src/context.code-symbol-retrieval.test.ts`
  - `scripts/run-demo-1c-live-mcp-eval.js` or a new sibling runner for `demo-do30-1c`
  - `scripts/run-demo-1c-relevance-eval.js` if shared scoring needs strict versus acceptable-hit support
  - `evaluation/retrieval/` for the new `demo-do30-1c` dataset and reports
- Affected APIs:
  - No MCP tool schema change is required for production search.
  - Evaluation output may gain additional fields for strict hits, acceptable hits, ambiguous-query notes, and failure classes.
- Affected systems:
  - MCP `search_code` ordering for BSL/1C codebases using `rankingProfile=one-c`.
  - Local Qdrant default live validation for `examples/demo-do30-1c`.
- Migration impact:
  - Existing indexed collections should not require reindexing because this is a ranking and evaluation change only.
  - Existing Qdrant, Milvus, and LanceDB indexes may return differently ordered results for 1C searches after the ranking change.
  - Operators should compare live results against the new `demo-do30-1c` baseline rather than treating the old `demo-1c` score as sufficient proof for large 1C configurations.
