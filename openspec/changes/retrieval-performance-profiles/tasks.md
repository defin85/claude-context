## 1. Profile Contract and Tests

- [ ] 1.1 Add a shared `RetrievalProfile` type with `fast`, `balanced`, and `quality` values.
- [ ] 1.2 Add a retrieval profile resolver that maps provider, profile, and low-level settings to retrieval mode, schema version, BGE-M3 mode, ColBERT storage, and hybrid behavior.
- [ ] 1.3 Add resolver tests for BGE-M3 `fast`, `balanced`, and `quality` mappings.
- [ ] 1.4 Add resolver tests for non-BGE `fast`, `balanced`, and `quality` mappings.
- [ ] 1.5 Test that first-version BGE-M3 `balanced` maps to dense-only and does not introduce sparse-without-ColBERT storage or search.
- [ ] 1.6 Test that `fast` changes retrieval/storage shape only and does not modify splitter type, chunk limits, chunk overlap, or batching limits.

## 2. Configuration Parsing and Validation

- [ ] 2.1 Add `RETRIEVAL_PROFILE` parsing in MCP config with a documented default.
- [ ] 2.2 Validate explicit profile conflicts with `BGE_M3_MODE`, `BGE_M3_STORE_COLBERT`, and `HYBRID_MODE`.
- [ ] 2.3 Preserve current low-level behavior when `RETRIEVAL_PROFILE` is unset.
- [ ] 2.4 Add config tests for invalid profiles and conflict errors.
- [ ] 2.5 Update startup logs and help output to show configured and resolved retrieval profile.
- [ ] 2.6 Document and test that `retrievalProfile` is separate from `rankingProfile`; retrieval profile changes can require reindexing, ranking profile changes cannot.

## 3. Core Indexing and Search Wiring

- [ ] 3.1 Extend core session/config types with optional `retrievalProfile`.
- [ ] 3.2 Apply resolved profile when choosing collection prefix, retrieval mode, retrieval schema version, and insert document shape.
- [ ] 3.3 Ensure BGE-M3 `fast` indexing uses dense-only sidecar responses and does not require sparse or ColBERT fields.
- [ ] 3.4 Ensure BGE-M3 `balanced` indexing uses the same dense-only storage/search shape as BGE-M3 `fast` in the first version.
- [ ] 3.5 Ensure BGE-M3 `quality` indexing requires dense, sparse, and ColBERT data and stores document ColBERT vectors for reranking.
- [ ] 3.6 Ensure search uses persisted retrieval profile/mode/schema for the target codebase rather than the current default profile, including collection prefix selection.

## 4. Persistence and Compatibility Guard

- [ ] 4.1 Persist `retrievalProfile` in codebase session config next to `retrievalMode` and `retrievalSchemaVersion`.
- [ ] 4.2 Backfill or infer profile safely for existing persisted configs that only contain retrieval mode/schema.
- [ ] 4.3 Add compatibility checks that reject incompatible profile/schema changes unless `force=true`.
- [ ] 4.4 Add tests for compatible same-profile reindex, incompatible no-force rejection, and incompatible force reindex.
- [ ] 4.5 Ensure successful force reindex updates persisted profile, mode, and schema only after indexing succeeds.

## 5. MCP API and Status Exposure

- [ ] 5.1 Add optional `retrievalProfile` input to `index_codebase` for per-call indexing profile override.
- [ ] 5.2 Expose persisted codebase profile in `get_indexing_status` structured content and text output.
- [ ] 5.3 Expose daemon default profile and resolved retrieval configuration in `get_daemon_status` structured content without secrets.
- [ ] 5.4 Add MCP handler tests for per-call override, status exposure, and persisted search behavior.

## 6. Documentation

- [ ] 6.1 Update environment variable docs with `RETRIEVAL_PROFILE` and profile-first guidance.
- [ ] 6.2 Update BGE-M3 docs to distinguish dense-only BGE-M3 from full BGE-M3 dense+sparse+ColBERT.
- [ ] 6.3 Document storage, indexing throughput, query latency, and quality tradeoffs for `fast`, `balanced`, and `quality`.
- [ ] 6.4 Document migration behavior and the need for explicit `force=true` when changing incompatible profiles.
- [ ] 6.5 Add examples for large-codebase first indexing and quality-focused reindexing.

## 7. Validation

- [ ] 7.1 Run targeted core retrieval profile and context tests.
- [ ] 7.2 Run targeted MCP config, handler, and codebase config tests.
- [ ] 7.3 Run `pnpm --filter @zilliz/claude-context-core typecheck` and `pnpm --filter @zilliz/claude-context-mcp typecheck`.
- [ ] 7.4 Run `pnpm --filter @zilliz/claude-context-core build` and `pnpm --filter @zilliz/claude-context-mcp build`.
- [ ] 7.5 Run `pnpm exec openspec validate retrieval-performance-profiles --strict`.
- [ ] 7.6 Smoke-test `fast` versus `quality` on a small repository and capture profile, mode, schema, batch counts, and search status.
- [ ] 7.7 Capture verification evidence in `openspec/changes/retrieval-performance-profiles/verification.md`.
