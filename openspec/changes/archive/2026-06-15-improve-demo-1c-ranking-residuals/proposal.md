## Why

The post-commit live `examples/demo-1c` run now passes the hard acceptance gate at Hit@10 `26/30`, but four residual misses remain and two of them are regressions against the same-ID baseline. These misses are concentrated in practical 1C navigation intents: stock report lookup, print command lookup, product card lookup, and mobile-device settings form lookup.

## What Changes

- Add a follow-up ranking quality pass for the current `demo-1c` residual misses `r01`, `r05`, `r06`, and `r28`.
- Preserve the current live `26/30` result as the regression baseline for this change.
- Add or reuse an acceptance comparison mode that can enforce "not below baseline" for follow-up work, instead of requiring every run to strictly improve over the supplied baseline.
- Add focused tests and live-report checks for:
  - report and stock-balance intent such as `остатки`, `склад`, and `отчет`;
  - product card intent such as `карточка товара`, `реквизиты`, `цена`, `артикул`, and `штрихкод`;
  - common-form and form-name intent such as `настройки мобильного устройства`;
  - print command intent for `ПечатьРасходнойНакладной`, after validating whether the current label is too narrow.
- Improve diversity control where repeated chunks from one broad file still crowd out distinct expected files.
- Revalidate dataset labels for the residual queries before treating any new score movement as ranking improvement.
- Keep production search independent from `demo-1c` query IDs, expected path prefixes, and relevance labels.
- Non-goal: change Qdrant schema, BGE-M3 vector storage, ColBERT reranking, daemon lifecycle, or indexing scope.
- Non-goal: lower the existing acceptance bar or accept a net regression from the current `26/30` live result.
- Non-goal: hard-code `demo-1c` residual query IDs, expected path prefixes, or business-object synonyms into production ranking.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `code-symbol-retrieval`: tighten the fixed 1C relevance quality contract for residual navigation misses and regression protection after the `26/30` tuned baseline.

## Impact

- Affected code:
  - `packages/core/src/code-symbol-retrieval.ts`
  - `packages/core/src/context.code-symbol-retrieval.test.ts`
  - `scripts/run-demo-1c-relevance-eval.js`
  - `scripts/run-demo-1c-live-mcp-eval.js` for non-regression baseline comparison or residual-case report detail if needed
  - `evaluation/retrieval/demo-1c-relevance.json` only if residual label validation proves a label is stale, ambiguous, or too narrow
- Affected systems:
  - MCP `search_code` ranking for BSL/1C codebases using hybrid code-symbol retrieval.
  - Local Qdrant default live validation for `examples/demo-1c`.
- Migration impact:
  - Existing indexed collections should not require reindexing because this is a ranking and evaluation refinement only.
  - Existing Milvus, Qdrant, and LanceDB indexes may return differently ordered results after ranking changes.
  - Operators should compare against the current `26/30` live baseline rather than the older `18/30` ranking baseline.
