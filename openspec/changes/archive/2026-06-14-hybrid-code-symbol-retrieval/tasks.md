## 1. Search Pipeline Baseline

- [x] 1.1 Add focused regression fixtures for BSL chunks containing `ПараметрыЗаполненияЗаписейСкладскогоЖурнала`, related `ЗаписьСкладскогоЖурнала` chunks, and module/path distractors.
- [x] 1.2 Add a failing core search test proving exact-symbol queries currently miss or under-rank the exact BSL declaration.
- [x] 1.3 Add baseline assertions that broad semantic queries still return vector-search results.
- [x] 1.4 Add a fixed `demo-1c` relevance eval dataset with 30-50 representative queries and eval-only `expectedPathPrefixes`.
- [x] 1.5 Capture current semantic-only or current-backend baseline metrics for the fixed 1C relevance eval before changing ranking.

## 2. No-Reindex Lexical Candidate Layer

- [x] 2.1 Add query tokenization helpers for code identifiers, Cyrillic BSL identifiers, path fragments, and quoted/exact terms.
- [x] 2.2 Add a bounded lexical candidate fetch path using existing stored fields: `content`, `relativePath`, `fileExtension`, and current metadata.
- [x] 2.3 Make lexical candidate fetching backend-safe: cap candidate count, handle unsupported backend filters, and fall back to semantic-only results on lexical fetch failure.
- [x] 2.4 Run vector retrieval and lexical candidate retrieval in parallel where possible without changing the public `search_code` contract.

## 3. Code-Symbol Provider Contract

- [x] 3.1 Define a core-side `CodeSymbolProvider` abstraction for availability checks, symbol/path candidate queries, timeouts, and diagnostics.
- [x] 3.2 Define normalized provider candidate fields: `providerName`, `providerStatus`, `relativePath`, optional line range, symbol name, declaration kind, module name, object kind, provider rank, and diagnostics.
- [x] 3.3 Define provider query budgets: max provider candidates, provider timeout, availability-check cache TTL, and behavior when budgets are exceeded.
- [x] 3.4 Add candidate-to-chunk mapping that matches by normalized `relativePath`, fetches bounded chunks from the vector collection, and prefers chunks covering provider line ranges when available.
- [x] 3.5 Ensure unmapped provider candidates are reported in diagnostics but do not appear in results and do not affect ranking.
- [x] 3.6 Run vector retrieval, provider retrieval, and no-reindex lexical retrieval in parallel where possible without changing the public `search_code` contract.
- [x] 3.7 Make provider failures fail open to semantic retrieval plus no-reindex lexical fallback.
- [x] 3.8 Add configuration or discovery hooks for enabling symbol providers without requiring agents to coordinate multiple tools manually.

## 4. rlm-tools-bsl Provider Adapter

- [x] 4.1 Audit viable `rlm-tools-bsl` integration transports: direct local API, CLI/subprocess, daemon endpoint, or MCP-to-MCP if locally supported.
- [x] 4.2 Select the least invasive v1 transport and document why it avoids duplicating the BSL index inside `claude-context`.
- [x] 4.3 Require the selected v1 transport to return machine-readable structured results; keep the provider disabled if only human-readable output is available.
- [x] 4.4 If using subprocess/CLI transport, invoke it with argv arrays and never shell-interpolated query/path strings.
- [x] 4.5 Implement provider availability/staleness detection for the requested codebase.
- [x] 4.6 Implement provider root translation for equal-root and nested-root cases, such as `src/cf` indexed by `rlm-tools-bsl` under a repository root indexed by `claude-context`.
- [x] 4.7 Query `rlm-tools-bsl` method/object/path search for BSL symbol and module candidates.
- [x] 4.8 Normalize `rlm-tools-bsl` results into `CodeSymbolProvider` candidates with path, line range, symbol metadata, and provider rank.
- [x] 4.9 Ensure the adapter never auto-builds, updates, or drops `rlm-tools-bsl` indexes during search.
- [x] 4.10 Add recorded provider fixtures or fakes so core tests do not require a live `rlm-tools-bsl` runtime.
- [x] 4.11 Document that a generic local sidecar is deferred to a separate future change unless provider integration proves insufficient for non-BSL repositories.

## 5. Fusion and Diagnostics

- [x] 5.1 Implement deterministic fusion that combines semantic score, provider lexical score, no-reindex lexical score, exact-symbol boost, module/path boost, and stable tie-breakers.
- [x] 5.2 Ensure exact provider declaration matches rank above semantically related chunks that do not contain the searched symbol.
- [x] 5.3 Make the fusion layer prefer provider/metadata-based boosts when available, while preserving no-reindex fallback behavior.
- [x] 5.4 Attach optional result diagnostics such as `retrievalSources`, `symbolProvider`, `providerStatus`, `semanticScore`, `lexicalScore`, and `fusionScore`.
- [x] 5.5 Keep semantic-only behavior unchanged when there are no lexical matches or lexical retrieval is unavailable.

## 6. Validation

- [x] 6.1 Verify `ПараметрыЗаполненияЗаписейСкладскогоЖурнала` returns `src/cf/CommonModules/ЗаполнениеДокументовВЕТИС/Ext/Module.bsl` in the top 3 on fixture data.
- [x] 6.2 Verify a fake or recorded `rlm-tools-bsl` provider result maps to the BSL symbol row with path, module, object kind, declaration kind, export flag, and line metadata.
- [x] 6.3 Verify `ЗаполнениеДокументовВЕТИС` boosts chunks from the matching common module.
- [x] 6.4 Verify natural-language semantic queries still return relevant BGE-M3 full retrieval results.
- [x] 6.5 Verify missing/stale/busy/error provider states fail open to semantic retrieval plus no-reindex lexical fallback.
- [x] 6.6 Verify unmapped provider candidates are excluded from results and reported only in diagnostics.
- [x] 6.7 Verify provider root translation for equal-root and nested-root `src/cf` cases.
- [x] 6.8 Verify subprocess/CLI adapter tests cover spaces and Cyrillic characters without shell interpolation if that transport is selected.
- [x] 6.9 Run targeted core tests and typecheck: `pnpm --filter @zilliz/claude-context-core test -- <relevant-test> --runInBand` and `pnpm --filter @zilliz/claude-context-core typecheck`.
- [x] 6.10 If MCP structured diagnostics are touched, run `pnpm --filter @zilliz/claude-context-mcp typecheck` and relevant MCP tests.
- [x] 6.11 Run the fixed 1C relevance eval and report Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, Precision@3, Precision@5, Precision@10, relevant hits at 10, per-query first relevant rank, top result paths, latency, and failures.
- [x] 6.12 Verify known 1C misses such as `печать расходной накладной`, `настройки мобильного устройства`, `остатки товаров на складах`, and `карточка товара` are reported explicitly and improve or remain explainable versus baseline.
- [x] 6.13 Verify eval path-prefix labels live only in eval fixtures and are not used by production search routing, filtering, boosting, or ranking.
- [x] 6.14 Close finish-to-100 review risks: lexical/provider candidates honor caller filters, Qdrant lexical filters are translated instead of silently becoming unfiltered scrolls, `rlm-tools-bsl` requires structured freshness checks before use, and environment/OpenSpec docs match the shipped behavior.
