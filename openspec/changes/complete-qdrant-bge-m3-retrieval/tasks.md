## 1. Reproduce And Pin The Qdrant Failure

- [x] 1.1 Add or update Qdrant unit fixtures that represent a BGE-M3 full point with dense, sparse, and ColBERT vectors.
- [x] 1.2 Add a failing unit test showing `bgeM3HybridSearch()` currently returns candidates without document ColBERT vectors.
- [x] 1.3 Add a regression test for `query()` projection so requested code-symbol fields map from Qdrant payload without depending on Milvus-only `metadata_json`.

## 2. Implement Qdrant BGE-M3 Full Retrieval

- [x] 2.1 Update `QdrantVectorDatabase.bgeM3HybridSearch()` to request payload plus the ColBERT vector field required for rerank.
- [x] 2.2 Update Qdrant point-to-document mapping so returned ColBERT vectors populate the backend-neutral document shape consumed by `Context.rerankBgeM3Results()`.
- [x] 2.3 Keep dense-only and non-BGE Qdrant search paths from returning unnecessary vector payloads.
- [x] 2.4 Verify sparse and dense prefetch request shapes still match Qdrant named vector and sparse vector API expectations.

## 3. Compatibility And Diagnostics

- [x] 3.1 Add compatibility checks or error classification for Qdrant collections that lack dense, sparse, or ColBERT full-mode data.
- [x] 3.2 Improve missing-ColBERT diagnostics so stored-vector incompatibility is distinguished from backend response mapping bugs.
- [x] 3.3 Ensure polluted or wrong-codebase Qdrant collections fail closed or are reported clearly instead of producing misleading search results.
- [x] 3.4 Document when operators must clear or force reindex Qdrant collections after switching backends or changing retrieval schema.

## 4. Automated Verification

- [x] 4.1 Run focused core tests for Qdrant vector database behavior.
- [x] 4.2 Run MCP/core typecheck and build commands affected by vector backend changes.
- [x] 4.3 Run lint for changed TypeScript packages.

## 5. Live MCP Verification

- [x] 5.1 Start or verify a local Qdrant service on `http://127.0.0.1:6333`.
- [x] 5.2 Clear the target Qdrant collection or otherwise prove it contains only the target `examples/demo-1c` codebase.
- [x] 5.3 Force-index `examples/demo-1c` through MCP using `oneCIndexScopeProfile=developer` and Qdrant backend.
- [x] 5.4 Record indexing evidence: indexed file count, chunk count, Qdrant point count, vector fields, and zero failed insert batches.
- [x] 5.5 Run the 30-query `search_code` acceptance set and save JSON/Markdown artifacts with errors, Hit@10, and top paths.
- [x] 5.6 Confirm live search has no MCP tool errors and no missing ColBERT vector failures.

## 6. Finalization

- [x] 6.1 Update the OpenSpec task checklist with completed verification commands and artifact paths.
- [x] 6.2 Summarize remaining ranking quality risks separately from backend correctness.
- [x] 6.3 Prepare a commit that includes implementation, tests, docs, and OpenSpec artifacts.

## Verification Evidence

- Focused tests: `pnpm --filter @zilliz/claude-context-core test -- qdrant-vectordb.test.ts context.retrieval-mode.test.ts` passed with 2 suites and 16 tests.
- Builds/type checks: `pnpm build:core`, `pnpm build:mcp`, `pnpm --filter @zilliz/claude-context-core typecheck`, and `pnpm --filter @zilliz/claude-context-mcp typecheck` passed.
- Lint: `pnpm --filter @zilliz/claude-context-core lint` passed with existing warnings; `pnpm --filter @zilliz/claude-context-mcp lint` passed.
- Default backend smoke: running MCP config without `VECTOR_DATABASE_BACKEND` resolves to `qdrant` with `http://127.0.0.1:6333`.
- Live Qdrant evidence after clean force index of `examples/demo-1c`: 129 indexed files, 893 chunks, 893 Qdrant points for the target codebase, `dense` + `sparse` + `colbert` vector fields, and 0 failed insert batches.
- Live MCP acceptance artifacts: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-mcp-search-30-report.json` and `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/qdrant-fixed-mcp-search-30-report.md`.
- Live MCP acceptance result: 30 cases, 0 MCP tool errors, 0 missing ColBERT vector errors, 30 cases with lexical source, Hit@10 18/30.

## Remaining Risk

- Ranking quality is not fully solved by this change: the backend is now returning ColBERT vectors and no longer fails the BGE-M3 rerank path, but Hit@10 remains 18/30 on the current acceptance set. Further ranking work should be handled as a separate tuning/evaluation change.
