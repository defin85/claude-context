## Why

BSL/1C ranking currently relies on semantic retrieval, path-derived heuristics, and an optional search-time `rlm-tools-bsl` subprocess provider. This leaves high-value structural knowledge in a separate RLM index instead of storing the relevant object, module, and symbol metadata on `claude-context` chunks during indexing.

The next step is to use `rlm-tools-bsl` as an indexing enrichment source: keep RLM as the specialized BSL truth source, but persist a bounded, queryable subset of its structure in `claude-context` vector payloads.

## What Changes

- Add an index-time RLM BSL enrichment path that can load a structured `rlm-tools-bsl` snapshot for a codebase before chunk insertion.
- Enrich BSL chunks with normalized metadata such as 1C object name, object kind, module kind, module/form/command name, matching method/procedure declarations, line ranges, export flags, synonyms, provider schema, and enrichment status.
- Store enrichment provenance and compatibility metadata in the indexed collection so searches and diagnostics can distinguish enriched and non-enriched indexes.
- Update 1C ranking to prefer stored RLM enrichment fields when present, while keeping existing path-derived signals and the current search-time provider as fallback behavior for old or unenriched collections.
- Add explicit configuration for enrichment mode: disabled, optional fail-open, and required fail-closed.
- Add tests and evaluation reporting that prove RLM-enriched indexes improve deterministic 1C navigation without using evaluation labels in production ranking.
- Non-goals:
  - Do not build, update, or drop `rlm-tools-bsl` indexes implicitly from `search_code`.
  - Do not duplicate the full `rlm-tools-bsl` SQLite schema, parser, call graph, or lifecycle inside `claude-context`.
  - Do not store whole RLM rows or unbounded symbol lists in every vector payload.
  - Do not remove semantic BGE-M3 retrieval or the existing no-reindex lexical fallback.
  - Do not require all non-BSL repositories to install `rlm-tools-bsl`.

## Capabilities

### New Capabilities
- `rlm-bsl-index-enrichment`: Index-time enrichment of BSL/1C chunks from a structured `rlm-tools-bsl` snapshot.

### Modified Capabilities
- `code-symbol-retrieval`: Search ranking and diagnostics SHALL use stored RLM BSL enrichment metadata when available, with existing lexical and search-time provider behavior retained as fallback.

## Impact

- Affected code:
  - `packages/core/src/context.ts`: indexing pipeline, chunk metadata preparation, collection compatibility metadata.
  - `packages/core/src/code-symbol-retrieval.ts`: ranking signals, diagnostics, and interaction with existing search-time providers.
  - `packages/core/src/vectordb/*`: payload projection and compatibility tests for new metadata fields.
  - `packages/mcp/src/*`: `index_codebase` options, status reporting, and structured diagnostics if enrichment status is exposed through MCP.
  - `docs/getting-started/environment-variables.md`: enrichment configuration.
  - `evaluation/retrieval/*` and `scripts/run-demo-1c-*`: reporting enriched versus non-enriched indexes.
- API impact:
  - New optional index-time configuration/env options for RLM enrichment.
  - Search result metadata may include optional enrichment-derived diagnostics.
  - Existing `search_code` response shape remains backward-compatible.
- Dependency impact:
  - `rlm-tools-bsl` remains an optional external tool/provider. `claude-context` must fail open unless enrichment is configured as required.
- Migration impact:
  - Existing indexed collections remain searchable.
  - Existing collections will not have stored RLM enrichment metadata until reindexed.
  - Ranking must detect unenriched collections and retain current behavior without requiring a forced migration.
