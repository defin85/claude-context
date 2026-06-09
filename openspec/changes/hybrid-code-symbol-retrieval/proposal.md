## Why

The current BGE-M3 full retrieval path works for semantic search, but it can miss exact code symbols and BSL module names in top results. On a large 1C codebase, the indexed chunk containing `ПараметрыЗаполненияЗаписейСкладскогоЖурнала` was present locally but not returned in the top-10 for exact-symbol queries, which makes agent workflows unreliable for navigation and targeted edits.

## What Changes

- Add a code-symbol hybrid retrieval capability that combines the existing vector/ColBERT results with lexical candidates and deterministic symbol/path boosts.
- Add a pluggable code-symbol provider layer so `claude-context` can fuse semantic results with exact symbol candidates from specialized indexes.
- For BSL/1C codebases, prefer reusing the existing `rlm-tools-bsl` method/object index when available instead of building a second BSL parser/index in `claude-context`.
- Support exact and partial matching for identifiers, file paths, module names, and BSL `Функция`/`Процедура` declarations through provider candidates plus fallback lexical matching.
- Keep the existing BGE-M3 dense+sparse+ColBERT retrieval as the semantic layer, then fuse lexical and semantic candidates into a single ranked result list.
- Keep a no-reindex Milvus/content lexical pass as a bootstrap and compatibility fallback while no symbol provider is available or trusted.
- Add regression coverage using the observed 1C/BSL miss: `ПараметрыЗаполненияЗаписейСкладскогоЖурнала` must return `src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl` near the top.
- Add a fixed 1C relevance eval for representative natural-language and code-navigation queries, using hand-labeled expected `relativePath` prefixes only as eval truth for metrics such as Hit@k, MRR@10, and Precision@k.
- Non-goals:
  - Do not replace BGE-M3, ColBERT reranking, or Milvus vector retrieval.
  - Do not duplicate the full `rlm-tools-bsl` BSL structural index inside `claude-context`.
  - Do not require Rust, LSP, or a new external search service for the first implementation.
  - Do not make agents start, build, or manage symbol indexes directly.
  - Do not force immediate reindexing for the minimal lexical fallback path.
  - Do not use hand-labeled eval path prefixes as production routing/ranking rules or try to pre-label arbitrary user queries.

## Capabilities

### New Capabilities
- `code-symbol-retrieval`: Hybrid code retrieval that preserves semantic search while guaranteeing strong ranking behavior for exact code symbols, paths, and BSL declarations.

### Modified Capabilities

None.

## Impact

- Affected code:
  - `packages/core/src/context.ts` search pipeline and result fusion.
  - `packages/core/src/*` code-symbol provider contracts, candidate normalization, and query/fusion APIs.
  - `packages/core/src/vectordb/*` if backend query helpers, relative-path chunk lookup, or lexical candidate fetch APIs need to be formalized.
  - `packages/core/src/splitter/*` only if generic language-neutral symbol metadata is added after the provider path.
  - `packages/mcp/src/handlers.ts` only if `search_code` should expose lexical diagnostics or retrieval-mode metadata.
- API impact:
  - `search_code` should remain backward-compatible.
  - Structured result metadata may gain optional diagnostics such as `retrievalSources`, `symbolProvider`, `providerStatus`, `lexicalScore`, or `fusionScore`.
- Migration impact:
  - Minimal phase: no collection migration or reindex required; lexical candidates can be derived from stored `content`, `relativePath`, and existing metadata.
  - Provider phase: existing indexes remain searchable; deterministic BSL symbol search requires an available, fresh, machine-readable `rlm-tools-bsl` provider/index whose paths can be mapped to the `claude-context` codebase root.
  - Generic sidecar phase, if later implemented: language-neutral symbol metadata may require reindexing or an explicit sidecar rebuild, but it is not the primary BSL path.
- Evaluation impact:
  - Add or reuse a small `demo-1c` relevance eval dataset with eval-only expected path prefixes.
  - Report aggregate metrics plus per-query misses so backend changes and hybrid-symbol changes can be compared against the same control set.
