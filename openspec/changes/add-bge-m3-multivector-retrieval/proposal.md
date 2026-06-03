## Why

Claude Context currently retrieves code with one dense embedding per chunk, or with hybrid mode that combines one dense vector with a Milvus-generated BM25 sparse vector. That is a useful baseline, but it does not preserve enough lexical and token-level structure for high-quality code retrieval across identifiers, APIs, signatures, and short implementation fragments.

BGE-M3 can produce dense vectors, model-generated sparse lexical weights, and ColBERT-style token vectors in one model family. This change introduces a true local BGE-M3 retrieval architecture instead of treating BGE-M3 as only another dense embedding model.

## What Changes

- Add a local BGE-M3 embedding provider path that can return:
  - dense document/query vectors,
  - model-generated sparse lexical vectors,
  - ColBERT token vectors for late-interaction reranking.
- Extend core embedding and vector database contracts so retrieval data is no longer limited to one dense vector per chunk.
- Add a BGE-M3 multivector collection/index layout for Milvus-backed local retrieval.
- Add a two-stage retrieval pipeline:
  - stage 1: dense+sparse candidate retrieval,
  - stage 2: ColBERT MaxSim-style late-interaction reranking over candidates.
- Keep existing dense-only and current hybrid/BM25 retrieval modes available for compatibility.
- Add migration behavior so existing indexed collections are detected as incompatible with BGE-M3 multivector mode and require explicit reindexing.

## Non-Goals

- Do not remove existing OpenAI, VoyageAI, Gemini, or Ollama dense embedding providers.
- Do not remove the current Milvus BM25 hybrid mode.
- Do not make remote embedding APIs mandatory.
- Do not implement a full independent vector database; Milvus remains the primary vector store.
- Do not guarantee that old dense-only indexes can be reused for BGE-M3 multivector search.

## Capabilities

### New Capabilities

- `bge-m3-multivector-retrieval`: Defines local BGE-M3 dense+sparse+ColBERT indexing, storage, retrieval, reranking, and migration behavior.

### Modified Capabilities

- None. This repository had no existing OpenSpec source-of-truth capabilities before this change.

## Impact

- `packages/core/src/embedding/*`: embedding contracts and provider implementations.
- `packages/core/src/vectordb/*`: vector document schema, Milvus collection creation, insert, search, query, and cleanup behavior.
- `packages/core/src/context.ts`: indexing, incremental sync, search, status, and collection naming/compatibility.
- `packages/mcp/src/config.ts` and `packages/mcp/src/embedding.ts`: provider selection and BGE-M3 runtime configuration.
- `packages/mcp/src/handlers.ts`: indexing/search/status responses and migration errors.
- Documentation and environment examples for local BGE-M3 service configuration.
- Existing indexed collections: dense-only and BM25-hybrid indexes cannot satisfy BGE-M3 ColBERT retrieval and must be reindexed when switching modes.
