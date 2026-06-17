## Why

The universal 1C search evaluation currently covers Document Management, Accounting, Trade Management, and UNF fixtures, but the newly available `examples/demo-zup-1c` export is a different HR and payroll configuration shape. Adding ZUP coverage now lets the universal matrix distinguish truly cross-configuration 1C navigation behavior from trade/accounting-specific assumptions.

## What Changes

- Add `demo-zup-1c` as a first-class fixture in the universal 1C search matrix.
- Classify existing universal queries for ZUP as `applicable`, `not-applicable`, or `needs-inspection` based on source-backed paths.
- Add ZUP-specific universal scenarios for payroll, HR documents, time tracking, leave, sick leave, NDFL, insurance contributions, SEDO/FSS, and military accounting.
- Add negative controls for broad HR/payroll terms so generic names do not force unrelated exact-looking results.
- Update evaluation and live runner wiring so ZUP reports include label validation, matrix fixture metadata, negative-control summaries, backend/retrieval/ranking labels, raw top results, and comparison output when a baseline is supplied.
- Keep `examples/demo-zup-1c/` ignored by git; the source export remains local fixture data and only matrix labels/reporting code are committed.
- Non-goal: change `search_code` API schemas, Qdrant/Milvus collection schemas, BGE-M3 storage shape, indexing scope, worker scheduling, or chunking.
- Non-goal: require ZUP to pass trade/accounting-specific rows such as goods realization, customer order, supplier order, KKM checks, or the `Хозрасчетный` accounting register.
- Non-goal: treat uninspected ZUP paths as strict labels only to improve metrics.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `demo-1c-retrieval-ranking`: extend the 1C evaluation contract so universal matrix evaluation supports a ZUP fixture with source-backed applicable/not-applicable labeling, ZUP-specific scenario rows, negative controls, and reproducible live report artifacts.

## Impact

- Affected code:
  - `evaluation/retrieval/universal-1c-search-matrix.json`
  - `scripts/run-demo-1c-relevance-eval.js`
  - `scripts/run-demo-1c-live-mcp-eval.js`
  - a ZUP-specific wrapper script if the existing runner needs stable defaults
  - `scripts/run-demo-1c-relevance-eval.test.js`
- Affected artifacts:
  - live reports under `.artifacts/hybrid-code-symbol-retrieval/`
  - label-validation summaries for `demo-zup-1c`
- Affected systems:
  - local MCP live evaluation for `examples/demo-zup-1c`
  - universal matrix scoring and report aggregation
- API impact:
  - no MCP tool schema change is expected.
  - report JSON may gain ZUP fixture rows, ZUP-specific domains/intents, and additional negative-control details.
- Migration impact:
  - existing indexed collections do not require migration.
  - `demo-zup-1c` must be indexed separately before live ZUP acceptance can run.
