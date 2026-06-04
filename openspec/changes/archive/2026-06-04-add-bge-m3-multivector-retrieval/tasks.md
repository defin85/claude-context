## 1. Provider and Configuration

- [x] 1.1 Add BGE-M3 configuration fields and environment variables in MCP config.
- [x] 1.2 Add a BGE-M3 embedding provider adapter that calls a local sidecar endpoint.
- [x] 1.3 Extend provider logging/status so `full` and `dense` BGE-M3 modes are distinguishable.
- [x] 1.4 Add provider parsing tests for dense, sparse, and ColBERT responses.

## 2. Core Contracts

- [x] 2.1 Extend embedding result types to represent dense, sparse, and ColBERT vectors while preserving existing dense-only providers.
- [x] 2.2 Extend vector document types to carry BGE-M3 sparse and ColBERT data.
- [x] 2.3 Add retrieval mode/schema version metadata to codebase config and collection naming.
- [x] 2.4 Add compatibility checks that require explicit reindexing when switching from dense/BM25 hybrid indexes to BGE-M3 full mode.

## 3. Milvus Storage and Search

- [x] 3.1 Add BGE-M3 multivector collection creation with dense and sparse vector fields.
- [x] 3.2 Add storage for ColBERT token vectors using the selected same-collection or side-collection strategy.
- [x] 3.3 Add insert paths for BGE-M3 full documents.
- [x] 3.4 Add dense+sparse candidate search using BGE-M3 model-generated sparse vectors, not Milvus BM25 sparse vectors.

## 4. Reranking Pipeline

- [x] 4.1 Implement ColBERT MaxSim-style late-interaction scoring over query and candidate token vectors.
- [x] 4.2 Add bounded candidate retrieval and rerank limits.
- [x] 4.3 Surface rerank metadata in internal search results and MCP responses.
- [x] 4.4 Add failure paths for missing ColBERT vectors or incompatible collection schemas.

## 5. MCP, Docs, and Validation

- [x] 5.1 Update `index_codebase`, `search_code`, and `get_indexing_status` behavior for BGE-M3 modes.
- [x] 5.2 Document fully local Milvus + BGE-M3 sidecar setup.
- [x] 5.3 Add unit tests for config, provider parsing, schema compatibility, and rerank scoring.
- [x] 5.4 Add a local integration smoke covering index and search with BGE-M3 full mode.
- [x] 5.5 Run `pnpm lint`, `pnpm typecheck`, and targeted build/tests.
