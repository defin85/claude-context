## Why

Qdrant is now the intended default vector database backend, but live `examples/demo-1c` validation shows that BGE-M3 full search cannot complete on a freshly indexed Qdrant collection. The index stores dense, sparse, and ColBERT vectors, yet `search_code` fails during retrieval with missing ColBERT-vector errors, so Qdrant cannot be accepted as the default backend until its BGE-M3 full search contract is complete.

## What Changes

- Make Qdrant a fully supported BGE-M3 full retrieval backend for indexing and search, not only for vector insertion.
- Ensure Qdrant search returns the document data required by the shared ColBERT rerank path.
- Keep Qdrant collection creation, insertion, query, and search behavior compatible with the existing `VectorDatabase` contract.
- Preserve explicit Milvus and LanceDB backend selection for users who configure those backends.
- Add regression tests for Qdrant BGE-M3 full search request shape, point mapping, and missing-vector failure prevention.
- Add live verification guidance for clean Qdrant reindexing and `examples/demo-1c` search checks.
- Non-goal: redesign the BGE-M3 sidecar, embedding model outputs, or accelerated indexing scheduler.
- Non-goal: migrate existing Milvus collections to Qdrant automatically.
- Non-goal: change ranking targets beyond making Qdrant return a valid BGE-M3 full result set for the current retrieval pipeline.

## Capabilities

### New Capabilities
- `qdrant-bge-m3-retrieval`: Qdrant-backed BGE-M3 full retrieval, including dense+sparse candidate retrieval, ColBERT vector return for rerank, payload mapping, and operational validation.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/core/src/vectordb/qdrant-vectordb.ts`
  - `packages/core/src/vectordb/qdrant-vectordb.test.ts`
  - `packages/core/src/context.ts` only if the shared rerank contract needs a backend-neutral adjustment
  - MCP live verification scripts or artifacts used for `examples/demo-1c`
- Affected systems:
  - MCP `index_codebase` and `search_code` when `VECTOR_DATABASE_BACKEND=qdrant` or the backend is omitted.
  - Local Qdrant collections created before this change may require force reindexing if they were built with incompatible or polluted collection state.
- Migration impact:
  - Existing Qdrant collections with the correct dense, sparse, and ColBERT vectors should remain usable if the collection metadata and payload match the BGE-M3 full schema.
  - Existing Qdrant collections missing ColBERT vectors, using old payload shape, or sharing a collection name across different codebases must fail closed with clear guidance to clear or force reindex.
  - Existing Milvus and LanceDB collections are not migrated and should continue to work only when their backend is explicitly selected.
