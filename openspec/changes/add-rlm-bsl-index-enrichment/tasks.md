## 1. RLM Snapshot Contract

- [ ] 1.1 Audit the installed `rlm-tools-bsl` CLI/MCP capabilities and record whether a machine-readable whole-codebase snapshot/export transport already exists.
- [ ] 1.2 If no suitable transport exists, define the required external RLM JSON export shape and document the dependency on adding it to `rlm-tools-bsl`.
- [ ] 1.3 Add TypeScript types for the normalized RLM BSL enrichment snapshot, file entries, object metadata, symbols, synonyms, capabilities, provider status, and diagnostics.
- [ ] 1.4 Add schema validation and normalization helpers that reject invalid JSON, unknown required fields, unbounded arrays, and unsupported provider statuses with clear diagnostics.
- [ ] 1.5 Add path normalization helpers for equal-root and nested-root RLM source roots, including Cyrillic paths and paths containing spaces.

## 2. Core Enrichment Pipeline

- [ ] 2.1 Add a generic index-time `CodebaseIndexEnricher` interface for availability checks, snapshot loading, per-chunk enrichment, and job diagnostics.
- [ ] 2.2 Implement `RlmBslIndexEnricher` behind explicit configuration for disabled, optional, and required modes.
- [ ] 2.3 Load the RLM snapshot once per indexing job and reuse an in-memory lookup keyed by normalized relative path and line range.
- [ ] 2.4 Enrich `CodeChunk` metadata after splitting and before `VectorDocument` creation using chunk `relativePath`, `startLine`, and `endLine`.
- [ ] 2.5 Bound per-chunk enrichment payloads by limiting symbols, synonyms, string lengths, and unsupported large RLM structures.
- [ ] 2.6 Preserve existing indexing behavior when enrichment is disabled or unavailable in optional mode.
- [ ] 2.7 Fail indexing before vector insertion when enrichment is required and the provider is missing, stale, busy, unsupported, invalid, or errors.

## 3. Collection Metadata and MCP Status

- [ ] 3.1 Store collection-level enrichment compatibility metadata such as provider, enrichment schema version, provider schema version, status, source root, build time, and fingerprint when available.
- [ ] 3.2 Ensure existing Qdrant, Milvus, Milvus REST, and LanceDB adapters preserve and return enriched chunk metadata without dropping nested `metadata.bsl` fields.
- [ ] 3.3 Expose enrichment status in indexing status, daemon diagnostics, or MCP structured output without leaking unrelated absolute paths or secrets.
- [ ] 3.4 Add environment/config documentation for enrichment command, args JSON, mode, limits, timeout, and source-root translation.

## 4. Search Ranking Integration

- [ ] 4.1 Update code-symbol ranking to read stored `metadata.bsl` object, module, synonym, and symbol fields as bounded structural ranking signals.
- [ ] 4.2 Prefer stored RLM enrichment over search-time `rlm-tools-bsl` provider candidates when collection metadata shows compatible enrichment.
- [ ] 4.3 Preserve search-time provider and no-reindex lexical fallback behavior for old or unenriched collections.
- [ ] 4.4 Add diagnostics that distinguish stored RLM enrichment, search-time provider candidates, lexical fallback, path/module boosts, semantic scores, and final fusion scores.
- [ ] 4.5 Ensure production ranking never reads evaluation query IDs, expected path prefixes, or fixture labels.

## 5. Tests

- [ ] 5.1 Add fixture tests for snapshot validation, malformed JSON, unsupported status, bounded arrays, and provider diagnostics.
- [ ] 5.2 Add path translation tests for equal-root and nested-root RLM snapshots with Cyrillic paths and spaces.
- [ ] 5.3 Add chunk enrichment tests proving only overlapping symbols attach to the matching chunk and non-overlapping file symbols do not become declaration matches.
- [ ] 5.4 Add optional-mode tests proving indexing continues without enrichment and records diagnostics.
- [ ] 5.5 Add required-mode tests proving indexing fails before vector insertion when enrichment is unavailable or invalid.
- [ ] 5.6 Add vector database payload tests proving nested `metadata.bsl` fields round-trip through Qdrant and existing test adapters.
- [ ] 5.7 Add search ranking tests proving stored RLM enrichment boosts exact BSL symbols and object/module/form queries without invoking the search-time provider.
- [ ] 5.8 Add backward-compatibility tests proving old indexes without enrichment retain current semantic plus lexical behavior.

## 6. Evaluation and Live Validation

- [ ] 6.1 Verify RLM indexes are available for the target `examples/*-1c` codebases before running enriched indexing acceptance.
- [ ] 6.2 Reindex `examples/demo-1c` with optional RLM enrichment and capture collection metadata, indexing status, and search diagnostics.
- [ ] 6.3 Reindex `examples/demo-bp30-1c` with required RLM enrichment after the RLM snapshot transport is proven reliable.
- [ ] 6.4 Run the universal 1C relevance matrix against enriched and non-enriched indexes and report Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, Precision@k, latency, failures, and per-query first relevant rank.
- [ ] 6.5 Inspect BP `needs-inspection` rows using source evidence and update labels separately from production ranking rules.
- [ ] 6.6 Confirm evaluation reports include enrichment provider/status and do not hide residual query regressions behind aggregate improvements.

## 7. Verification

- [ ] 7.1 Run targeted core tests for enrichment, code-symbol retrieval, and vector database payload compatibility.
- [ ] 7.2 Run `pnpm build:core`.
- [ ] 7.3 Run `pnpm typecheck`.
- [ ] 7.4 Run `pnpm lint`.
- [ ] 7.5 Run `pnpm build`.
- [ ] 7.6 Run `pnpm exec openspec validate --type change add-rlm-bsl-index-enrichment --strict`.
- [ ] 7.7 Document final verification evidence in `openspec/changes/add-rlm-bsl-index-enrichment/verification.md`.
