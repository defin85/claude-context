## Overview

Implement BGE-M3 as a new retrieval mode, not only as another dense embedding model. The mode must support model-generated dense vectors, sparse lexical weights, and ColBERT token vectors, with a retrieval pipeline that first retrieves candidates using dense+sparse search and then reranks those candidates using ColBERT late interaction.

The current architecture already has useful boundaries:

- `Embedding` creates vectors.
- `Context` owns chunking, indexing, search, and collection naming.
- `VectorDatabase` owns Milvus schema, insert, query, and search.
- MCP config creates provider instances and exposes operational behavior.

This change extends those boundaries rather than replacing the full system.

## Current State

Existing dense mode:

- stores one `FloatVector` field named `vector`;
- embeds each chunk into one vector;
- searches with one query vector.

Existing hybrid mode:

- stores `vector` plus `sparse_vector`;
- creates `sparse_vector` through a Milvus BM25 function over `content`;
- searches dense and BM25 sparse fields and combines with RRF.

That is not full BGE-M3 retrieval because sparse vectors are not model-generated BGE-M3 sparse weights and there is no ColBERT token-vector reranking.

## Target Architecture

```text
                    ┌────────────────────┐
query ─────────────▶│ BGE-M3 local service│
                    └─────────┬──────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
      dense vector       sparse weights      colbert tokens
          │                   │                   │
          └──────────────┬────┴────┬──────────────┘
                         │         │
                         ▼         ▼
             Milvus dense+sparse candidate search
                         │
                         ▼
               top-N candidate chunks
                         │
                         ▼
            ColBERT MaxSim late-interaction rerank
                         │
                         ▼
               top-K search_code results
```

## Embedding Contract

Add a multivector embedding result alongside the existing dense-only result.

Conceptual shape:

```typescript
interface DenseEmbeddingVector {
    vector: number[];
    dimension: number;
}

interface SparseEmbeddingVector {
    indices: number[];
    values: number[];
}

interface ColbertEmbeddingVector {
    vectors: number[][];
    dimension: number;
    tokenCount: number;
}

interface MultiVectorEmbedding {
    dense: DenseEmbeddingVector;
    sparse?: SparseEmbeddingVector;
    colbert?: ColbertEmbeddingVector;
}
```

Existing providers can adapt by returning only `dense`. BGE-M3 must return all three for full mode.

## Local BGE-M3 Runtime

Prefer a local sidecar service instead of loading Python directly inside the Node.js process. The service can be implemented with `FlagEmbedding` or an equivalent BGE-M3 runtime and expose a small HTTP API:

- `POST /embed` for one input,
- `POST /embed_batch` for indexing batches,
- provider metadata with dense dimension, ColBERT dimension, model name, and supported modes.

The Node provider should fail clearly when the sidecar is unavailable or when it returns only dense vectors while full multivector mode is requested.

## Milvus Storage Strategy

Use a separate collection namespace for BGE-M3 multivector indexes, for example `bge_m3_code_chunks_<hash>`. Do not reuse `code_chunks_*` or `hybrid_code_chunks_*`.

Required stored fields:

- `id`
- `content`
- `relativePath`
- `startLine`
- `endLine`
- `fileExtension`
- `metadata`
- `dense_vector`
- `sparse_vector`
- ColBERT storage

ColBERT storage has two viable designs:

1. Store token vectors in the same collection as a JSON/binary payload and rerank in Node after candidate retrieval.
2. Store token vectors in a side collection keyed by chunk id, with one row per token vector or a packed vector payload.

Start with option 1 unless memory or row-size limits force option 2. Candidate reranking only needs token vectors for top-N chunks, so operational simplicity matters more than making ColBERT vectors globally searchable in phase 1.

## Retrieval Pipeline

1. Embed query with BGE-M3.
2. Run dense+sparse hybrid candidate search against Milvus.
3. Fetch candidate ColBERT vectors.
4. Compute MaxSim-style score between query token vectors and document token vectors.
5. Combine or replace first-stage scores with ColBERT score.
6. Return top-K results with score metadata that identifies retrieval mode and rerank stage.

Default candidate sizes should be configurable:

- `BGE_M3_CANDIDATE_LIMIT`, default 100.
- `BGE_M3_RERANK_LIMIT`, default equal to requested `limit` after rerank.

## Migration and Compatibility

BGE-M3 multivector indexes are incompatible with current dense-only and BM25-hybrid collections. Switching an indexed codebase to BGE-M3 full mode must:

- detect that the existing collection name/schema does not match the requested retrieval mode;
- return a clear reindex-required status;
- require explicit force reindex before replacing an existing index.

The mode and schema version should be persisted in collection metadata and daemon codebase config.

## Configuration

New environment variables:

- `EMBEDDING_PROVIDER=BGE_M3`
- `BGE_M3_ENDPOINT=http://127.0.0.1:<port>`
- `BGE_M3_MODEL=BAAI/bge-m3`
- `BGE_M3_MODE=full` or `dense`
- `BGE_M3_CANDIDATE_LIMIT=100`
- `BGE_M3_STORE_COLBERT=true`

`BGE_M3_MODE=dense` is explicitly dense-only and must not be described as full multivector retrieval.

## Storage and Latency Tradeoffs

ColBERT vectors can grow storage by an order of magnitude because each chunk stores many token vectors. The implementation should:

- cap maximum tokens used for ColBERT per chunk;
- avoid returning ColBERT vectors in normal search output;
- rerank only a bounded candidate set;
- log index size and rerank latency;
- allow disabling ColBERT storage for dense+sparse-only deployments.

## Risks

- Milvus row size or JSON payload limits may force a side collection for ColBERT vectors.
- Local BGE-M3 service throughput may make indexing slower than the current Ollama dense model.
- Dense+sparse score scales and ColBERT scores need tuning before default thresholds are reliable.
- Incremental sync must preserve collection schema version checks to avoid mixed-mode collections.

## Validation

- Unit tests for embedding contract adapters and BGE-M3 provider response parsing.
- Unit tests for collection naming/schema compatibility and reindex-required behavior.
- Milvus integration smoke for collection creation, insert, dense+sparse candidate search, and ColBERT rerank.
- MCP smoke for `index_codebase`, `get_indexing_status`, and `search_code` with BGE-M3 mode.
- Documentation test path for fully local Milvus + BGE-M3 sidecar configuration.
