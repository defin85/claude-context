## Context

Qdrant is intended to become the default vector database backend for MCP search, but the current implementation is only partially compatible with BGE-M3 full retrieval. It can create a collection with dense, sparse, and ColBERT vector fields and can insert indexed chunks, but live validation against `examples/demo-1c` fails during `search_code`.

The live failure has two important findings:

- Reindexing into a clean Qdrant collection succeeds and stores 893 `examples/demo-1c` points with dense, sparse, and ColBERT vectors.
- Search still fails because `QdrantVectorDatabase.bgeM3HybridSearch()` asks Qdrant for payload only (`with_vector: false`) while the shared BGE-M3 rerank path requires document ColBERT vectors.

The implementation must preserve the shared `VectorDatabase` abstraction and avoid making MCP clients aware of backend-specific retrieval details.

## Goals / Non-Goals

**Goals:**

- Make Qdrant BGE-M3 full search return candidates that the existing ColBERT rerank path can score.
- Keep dense-only BGE-M3 behavior distinct from full BGE-M3 dense+sparse+ColBERT behavior.
- Preserve Qdrant as a normal `VectorDatabase` backend selected by `VECTOR_DATABASE_BACKEND=qdrant` or by default.
- Fail closed with actionable errors when a Qdrant collection is missing full-mode data or was polluted by another codebase.
- Add unit and live verification coverage for Qdrant BGE-M3 full retrieval.

**Non-Goals:**

- No automatic migration from Milvus to Qdrant.
- No redesign of the BGE-M3 embedding sidecar or worker-pool scheduling.
- No ranking target rewrite beyond making Qdrant participate correctly in the current dense+sparse recall plus ColBERT rerank pipeline.
- No attempt to merge multiple codebases into one Qdrant collection unless the collection naming and filtering contract is explicitly extended later.

## Decisions

### Decision: Return ColBERT vectors only for BGE-M3 full rerank candidates

`QdrantVectorDatabase.bgeM3HybridSearch()` will request Qdrant vectors needed by downstream reranking for candidate results. The preferred request shape is to keep payload enabled and request only the ColBERT vector field, not all vector fields.

Rationale:

- The shared rerank path already expects `VectorDocument.colbertVectors`.
- Dense and sparse vectors are used for recall, but the second-stage rerank needs ColBERT vectors.
- Returning all vectors would increase payload size without adding value to rerank.

Alternative considered: disable ColBERT rerank for Qdrant and return fused Qdrant scores directly. This would make Qdrant search complete, but it would silently weaken BGE-M3 full mode and make Qdrant ranking semantics diverge from the rest of the system.

### Decision: Keep ColBERT rerank in `Context`, not inside the Qdrant adapter

The Qdrant adapter will return backend-neutral `HybridSearchResult` objects with documents that include ColBERT vectors. The existing `Context` rerank flow will remain responsible for final ColBERT scoring and result trimming.

Rationale:

- Keeps backend adapters responsible for storage and retrieval mechanics.
- Keeps ranking semantics centralized.
- Avoids duplicating ColBERT scoring code in individual vector database adapters.

Alternative considered: use Qdrant multivector search as the final ColBERT ranking stage. This can be revisited later, but it would require a broader ranking design and parity checks across backends.

### Decision: Validate Qdrant collection compatibility before trusting indexed state

Qdrant full-mode collections must be treated as compatible only when they expose the expected dense, sparse, and ColBERT vector fields and collection metadata identifies BGE-M3 full mode. If search detects missing ColBERT vectors in returned candidates, the error should distinguish missing stored vectors from backend response-shape bugs.

Rationale:

- Live testing showed that old or polluted collections can contain points for another codebase.
- A clean index can still fail if the backend response omits vectors.
- Operators need precise guidance: clear/reindex for bad collections, code fix for bad response mapping.

Alternative considered: always force reindex after switching to Qdrant. This is operationally simple but masks real compatibility bugs and is too expensive for large codebases.

### Decision: Keep Qdrant collection naming behavior stable for this change

This change will not redesign collection naming. It will document and test the expected clean-collection flow and fail-closed behavior for polluted collections.

Rationale:

- The immediate blocker is retrieval response shape, not collection naming.
- Collection naming across codebases may need a separate change if collision risk is confirmed beyond the live artifact.

Alternative considered: include collection naming isolation in this change. That would broaden scope and make it harder to isolate BGE-M3 full retrieval correctness.

## Risks / Trade-offs

- ColBERT vector payload size increases search response cost -> request only the ColBERT vector field and only for candidate limits used by rerank.
- Qdrant API shape for named multivectors may differ across versions -> cover request and response mapping with unit tests using representative Qdrant point responses.
- Existing Qdrant collections may look indexed in MCP snapshots but contain incompatible data -> compatibility checks and clear error messages must prevent misleading empty or partial results.
- Qdrant lexical filtering may not match Milvus filter semantics exactly -> keep `query()` behavior covered for code-symbol retrieval fields and add backend-specific tests where semantics differ.
- Live validation depends on a local Qdrant service -> document the exact container/service requirement and keep unit tests independent of a live service.

## Migration Plan

1. Keep explicit `VECTOR_DATABASE_BACKEND=milvus` and `VECTOR_DATABASE_BACKEND=lancedb` working.
2. For Qdrant users, require clean force reindex when the existing collection lacks full-mode vector fields, has incompatible metadata, or contains points from another codebase.
3. Update Qdrant retrieval code and tests before declaring the new default ready.
4. Re-run live validation on `examples/demo-1c`:
   - clean Qdrant collection,
   - `index_codebase(force=true, oneCIndexScopeProfile=developer)`,
   - 30-query `search_code` set,
   - no tool errors,
   - no missing ColBERT vector errors,
   - report Hit@10.
5. Rollback remains setting `VECTOR_DATABASE_BACKEND=milvus` explicitly and using an existing Milvus index or force reindexing into Milvus.

## Open Questions

- Should Qdrant collection naming be made codebase-specific in a separate change to prevent cross-codebase pollution?
- Should Qdrant use its multivector field for first-stage ColBERT recall in addition to dense+sparse recall, or should ColBERT remain only a rerank stage?
- What minimum Qdrant version should be documented for named dense, sparse, and multivector behavior?
