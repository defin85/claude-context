## Context

Claude Context already supports semantic code retrieval through dense embeddings and, in BGE-M3 full mode, model-generated sparse vectors plus ColBERT late-interaction reranking. This is effective for conceptual queries, but code navigation also needs deterministic handling of exact identifiers, module names, and paths.

The observed failure is specific and reproducible enough to drive the design: on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd`, the file `src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl` contains `ПараметрыЗаполненияЗаписейСкладскогоЖурнала`, but exact-symbol queries did not return it in the top-10. This indicates a retrieval/ranking gap, not a traversal gap.

Current constraints:
- `packages/core` owns indexing, vector database integration, and `Context.semanticSearch`.
- MCP, VS Code, and other clients should benefit from the same core behavior.
- Existing indexed collections should remain searchable.
- BGE-M3 full mode is distinct from dense-only BGE-M3; full mode already has dense, sparse, and ColBERT signals, but still needs code-symbol-aware lexical fusion.

## Goals / Non-Goals

**Goals:**
- Add a code-symbol retrieval layer that improves exact identifier, declaration, and path lookup without degrading semantic search.
- Keep `search_code` backward-compatible while optionally exposing diagnostics that explain lexical/vector/fusion contributions.
- Support 1C/BSL naming patterns, including long Cyrillic identifiers and `Функция`/`Процедура` declarations.
- Provide a no-reindex first phase that can fix the worst exact-symbol misses using existing stored fields.
- Provide a provider-based second phase that can reuse specialized symbol indexes, especially `rlm-tools-bsl` for BSL/1C, without duplicating them inside `claude-context`.

**Non-Goals:**
- Replacing BGE-M3 full retrieval, ColBERT reranking, or Milvus vector search.
- Adding a new external search service for the first implementation.
- Requiring Rust for the initial implementation.
- Requiring LSP for the initial implementation.
- Reimplementing the full `rlm-tools-bsl` BSL parser, SQLite schema, call graph, metadata parser, or index lifecycle inside `claude-context`.
- Making MCP agents manage embedding workers or symbol indexes directly.
- Guaranteeing global exact-match completeness while only the bootstrap Milvus/content fallback exists.

## Decisions

### Decision: Implement fusion in `packages/core`

Hybrid code-symbol retrieval SHALL live in the core search pipeline, not only in MCP.

Rationale:
- `Context.semanticSearch` is shared by MCP and other clients.
- Search quality should not diverge by client surface.
- Core already has access to collection names, vector DB, retrieval mode, query embeddings, and result metadata.

Alternative considered: implement lexical fallback in `packages/mcp/src/handlers.ts`. This is faster to patch but would leave VS Code and other callers with the old behavior.

### Decision: Add a code-symbol provider contract

`packages/core` SHALL define a provider contract for exact symbol/path candidates. The core search pipeline owns query orchestration, candidate normalization, mapping provider candidates to indexed chunks, fusion scoring, diagnostics, timeouts, and fail-open behavior.

Suggested provider candidate shape:
- `providerName`: stable provider id, for example `rlm-tools-bsl` or `milvus-fallback`.
- `providerStatus`: `available`, `stale`, `missing`, `error`, or equivalent diagnostic state.
- `relativePath`: path that can be matched to existing indexed chunks.
- `startLine` / `endLine`: optional line range used to choose the best chunk within a file.
- `symbolName`, `declarationKind`, `moduleName`, `objectKind`, `moduleType`: optional structured fields.
- `lexicalRank` or `lexicalScore`: provider-local ranking signal.
- `diagnostics`: optional compact detail for logs/result metadata.

Rationale:
- `claude-context` should solve cross-client retrieval quality, not own every language-specific parser.
- Specialized providers can evolve independently while the public `search_code` behavior remains stable.
- A provider contract lets BSL use `rlm-tools-bsl` and leaves room for future generic symbol providers.

### Decision: Map provider candidates to indexed chunks before fusion

Provider candidates SHALL NOT be returned directly as `search_code` results. They must first be mapped to chunks already present in the `claude-context` vector collection.

Mapping rules:
- Normalize provider paths and `claude-context` paths to forward-slash relative paths.
- Support a provider source root that differs from the `claude-context` codebase root, for example a `src/cf` BSL root inside a larger repository root.
- Fetch a bounded set of chunks by `relativePath`; when a provider line range is present, prefer chunks whose `startLine`/`endLine` overlap that range.
- If no chunk maps to a provider candidate, record diagnostics and do not let that candidate affect ranking.
- Preserve provider metadata in result diagnostics only after mapping succeeds.

Rationale:
- `search_code` must continue returning indexed snippets, not raw external provider rows.
- Path and line mapping is the reliability boundary between a specialized symbol index and semantic chunks.
- This keeps fail-open behavior clear when provider data is stale or rooted differently from the indexed collection.

### Decision: Use `rlm-tools-bsl` as the preferred BSL symbol provider

For BSL/1C codebases, the preferred exact-symbol backend SHALL be an adapter to `rlm-tools-bsl` when it is available and fresh for the requested codebase.

Adapter responsibilities:
- Detect whether the codebase has an available `rlm-tools-bsl` index or provider endpoint.
- Query method/object/path lookup from `rlm-tools-bsl` rather than re-parsing BSL in TypeScript.
- Normalize `rlm-tools-bsl` results into core provider candidates with `relativePath`, symbol metadata, line ranges, and provider rank.
- Validate that the selected transport returns machine-readable structured results with an adapter-supported schema/version.
- Invoke subprocess/CLI transports with argument arrays, not shell-interpolated command strings.
- Never auto-build, update, or drop the `rlm-tools-bsl` index unless a future explicit user-approved indexing operation adds that behavior.
- Report provider status so agents can see whether exact BSL retrieval used `rlm-tools-bsl`, fell back, or skipped it.

Rationale:
- `rlm-tools-bsl` already has BSL path parsing, method tables, SQLite FTS5 trigram search, line/end-line/export metadata, incremental update, and 1C metadata knowledge.
- Duplicating that inside `claude-context` would create version skew, more index lifecycle work, and a second source of truth for BSL semantics.
- `claude-context` still adds value by fusing BSL symbol candidates with semantic BGE-M3 candidates into the same result list used by MCP, VS Code, and library callers.

Transport options to evaluate during implementation:
- Direct library/process integration if `rlm-tools-bsl` exposes a stable local API on the host.
- CLI/subprocess integration with strict timeouts, structured output, and safe argv-based invocation, if available.
- MCP-to-MCP integration only if the local runtime supports it cleanly; avoid making agents manually coordinate two tools for normal search.
- If no stable machine-readable transport is available, keep the provider disabled and rely on semantic/no-reindex fallback rather than scraping human-readable output.

### Decision: Keep a no-reindex lexical fallback

When no symbol provider is available, the implementation may derive lexical candidates from fields already stored in Milvus: `content`, `relativePath`, `fileExtension`, and `metadata`. This remains a bootstrap and compatibility path, not the target BSL exact-symbol architecture.

Rationale:
- Existing indexes can benefit immediately.
- Search remains useful when `rlm-tools-bsl` is not installed, not indexed, stale, or unavailable.
- It reduces rollout risk while provider integration is added.

Candidate retrieval options:
- Query Milvus with bounded `content like` / `relativePath like` expressions when supported.
- If backend filtering is insufficient, fetch a bounded candidate pool by path/module terms and score locally.
- Keep lexical candidate limits low and configurable to avoid large scans.

Alternative considered: require `rlm-tools-bsl` for all BSL symbol search. This gives stronger BSL quality but would make generic `claude-context` installations harder to run and would break the fail-open principle.

### Decision: Defer a generic local sidecar until the provider path is proven

`claude-context` MAY later add a language-neutral SQLite FTS5 or other local sidecar for repositories that do not have a specialized provider. It SHALL NOT be the first BSL implementation path.

Rationale:
- The immediate BSL quality gap can be closed by reusing `rlm-tools-bsl`.
- A generic sidecar is still useful for non-BSL languages or installations without specialized tooling.
- Deferring the sidecar avoids adding a SQLite/native dependency and index lifecycle before the provider/fusion contract is validated.

Alternative considered: make SQLite FTS5 sidecar the target lexical layer. This duplicates `rlm-tools-bsl` for the main motivating codebase and adds storage/staleness risks without improving BSL-specific knowledge.

### Decision: Fuse lexical and semantic results with explainable scoring

The result list should merge:
- BGE-M3 full candidates from dense+sparse retrieval and ColBERT rerank.
- Symbol provider candidates, for example `rlm-tools-bsl` BSL method/object/path matches.
- No-reindex lexical fallback candidates from exact content/path/module/symbol matching.

Suggested scoring:
- Preserve existing vector score as `semanticScore`.
- Add bounded boosts:
  - exact provider symbol/declaration match: highest lexical boost.
  - exact path/module match: high lexical boost.
  - partial identifier/path token match: medium boost.
  - content term overlap: lower boost.
- Use deterministic tie-breakers: exact symbol > path/module > semantic score > path order.
- Store optional metadata such as `retrievalSources`, `symbolProvider`, `providerStatus`, `semanticScore`, `lexicalScore`, and `fusionScore`.

Rationale:
- Agents need results that are both semantically useful and reliable for named-code lookup.
- Diagnostics make future quality bugs easier to isolate.

Alternative considered: RRF only. RRF is simple but may not guarantee exact symbol dominance when the exact lexical candidate enters with a low rank or only one source.

### Decision: Validate with a fixed 1C relevance eval

The implementation SHALL include a small hand-labeled 1C relevance eval for `demo-1c` or an equivalent stable exported 1C configuration fixture. The labels SHALL be test truth only: production search must not inspect the labels and must not route arbitrary user queries through pre-authored path prefixes.

Eval shape:
- Use representative 1C search intents, including exact symbol lookup, object/form/command lookup, and natural-language navigation queries.
- Store expected results as `expectedPathPrefixes` against returned `relativePath` values. Prefixes are acceptable because 1C objects expand into nested module/form/command files.
- Report Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, Precision@3, Precision@5, Precision@10, relevant hits at 10, first relevant rank, top result paths, latency, and per-query misses.
- Do not report recall unless labels become exhaustive relevant-document sets. The small eval is a control set, not a complete relevance corpus.

The eval should include known weak cases observed in current backend-only comparisons, for example:
- `печать расходной накладной` should find `Documents/РасходТовара/Commands/ПечатьРасходнойНакладной`.
- `настройки мобильного устройства` should find `CommonForms/НастройкиМобильногоУстройства`.
- `остатки товаров на складах` should reach the inventory report/command/form area instead of only sales document object modules.
- `карточка товара` should reach `Catalogs/Товары` form/object paths instead of unrelated document modules.

Rationale:
- Backend replacement alone can improve latency and some ranks, but the main quality gap is code-symbol/path/object ranking.
- A fixed eval makes that gap visible without pretending that all possible future queries can be manually labeled.
- Per-query miss reports are more useful than a single aggregate number for 1C navigation quality.

## Risks / Trade-offs

- [Risk] `rlm-tools-bsl` may be absent, stale, busy, or not indexed for the current codebase. → Mitigation: provider status diagnostics, strict timeouts, and fail-open to semantic retrieval plus no-reindex lexical fallback.
- [Risk] A `claude-context` adapter can drift from `rlm-tools-bsl` schema/API changes. → Mitigation: define a narrow adapter contract, version-check provider responses, and add tests with recorded provider fixtures.
- [Risk] The available `rlm-tools-bsl` transport may only expose human-readable output. → Mitigation: require machine-readable structured output for v1 enablement; otherwise keep the provider disabled.
- [Risk] Subprocess transport can introduce command injection or quoting bugs for Cyrillic queries and paths. → Mitigation: use argv-based process execution, never shell interpolation, and test queries/paths with spaces and Cyrillic identifiers.
- [Risk] Automatic index build/update through the adapter could surprise users and consume I/O. → Mitigation: v1 adapter SHALL query only; build/update/drop stay explicit user-controlled operations.
- [Risk] Mapping provider line/path results to existing chunks can miss when chunk boundaries differ. → Mitigation: match by normalized relative path first, prefer chunks covering the provider line range, and fall back to nearby/path-only chunks with diagnostics.
- [Risk] `rlm-tools-bsl` may index `src/cf` while `claude-context` indexes a repository root or another parent path. → Mitigation: detect or configure provider root translation and test both equal-root and nested-root cases.
- [Risk] Provider calls can add latency or process overhead. → Mitigation: run provider and semantic retrieval in parallel, use small candidate limits, enforce timeouts, and cache short-lived availability checks.
- [Risk] Agents may be confused about whether to use `search_code` or direct `rlm-tools-bsl` tools. → Mitigation: keep `search_code` as the integrated default and expose diagnostics that show when `rlm-tools-bsl` contributed.
- [Risk] Milvus `like` queries over `content` can be slow or backend-dependent. → Mitigation: keep candidate limits bounded, prefer path/symbol metadata after reindex, and guard the no-reindex pass behind retrieval options.
- [Risk] Lexical boosts can overpower semantic relevance for broad natural-language queries. → Mitigation: apply strong boosts only for query tokens that look like code identifiers, paths, or exact quoted/single-token symbols.
- [Risk] Adding a generic sidecar too early duplicates `rlm-tools-bsl` and creates two BSL truth sources. → Mitigation: defer generic sidecar implementation and keep BSL provider integration first.
- [Risk] Additional lexical pass increases search latency. → Mitigation: execute lexical and vector retrieval in parallel where possible, enforce small candidate limits, and measure p50/p95 search latency in tests or local benchmarks.
- [Risk] Eval path-prefix labels can be mistaken for production ranking rules or become stale when fixtures move. → Mitigation: keep labels in eval fixtures only, version them with the fixture, and assert production search has no dependency on eval labels.

## Migration Plan

1. Implement no-reindex lexical candidate retrieval and fusion using existing fields.
2. Add regression tests using fixture BSL chunks with long Cyrillic symbols.
3. Add the fixed 1C relevance eval dataset and capture the current semantic-only baseline.
4. Add optional diagnostics in structured search result metadata.
5. Add the `CodeSymbolProvider` contract and candidate-to-chunk mapping.
6. Add the `rlm-tools-bsl` adapter behind the provider contract when a fresh provider/index and stable machine-readable transport are available.
7. Re-run the 1C relevance eval and compare hybrid-symbol metrics plus key per-query misses against the captured baseline.
8. Document that existing indexes work with fallback mode, while deterministic BSL symbol boosts require an available `rlm-tools-bsl` provider/index.
9. Rollback path: disable provider querying or lexical fusion with a config flag and default back to the existing semantic-only path.

## Open Questions

- What latency budget should `search_code` enforce for lexical candidate fetching on very large collections?
- Should agents be able to request `retrievalMode: semantic-only | hybrid-symbol`, or should hybrid-symbol be the default for all code search?
- Which `rlm-tools-bsl` transport should v1 use: direct local API, CLI/subprocess, or another daemon/provider endpoint?
- How should provider availability be configured or discovered across MCP, VS Code, and library consumers?
- Should a generic sidecar be proposed as a separate future change after provider-based fusion is validated?
