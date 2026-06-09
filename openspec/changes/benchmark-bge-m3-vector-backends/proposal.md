## Why

The indexing performance series showed that parallel BGE-M3 embedding workers can speed up small indexes, but later runs shifted pressure to vector writes and payload shape. We need a reproducible micro-benchmark that compares the current Milvus BGE-M3 write path against native multivector-capable alternatives before choosing a storage optimization or backend migration.

## What Changes

- Add a benchmark-only harness for BGE-M3 full vector backend write paths using the already-indexed `VectorDocument` shape: dense vector, model-generated sparse vector, ColBERT token vectors, content, path fields, and metadata.
- Compare:
  - current Milvus BGE-M3 storage path,
  - Qdrant native dense+sparse+multivector storage,
  - LanceDB multivector storage.
- Run the benchmark against:
  - full `examples/demo-1c` developer-scope output, expected around 893 chunks,
  - bounded `examples/demo-do30-1c` developer-scope output, explicitly marked bounded when cancelled or capped.
- Record write wall-clock, bytes/request, request count, failures, peak RSS, backend-specific write settings, and search parity.
- Store machine-readable benchmark artifacts under `.artifacts/bge-m3-vector-backend-benchmark/` and document interpretation limits.
- Keep production indexing defaults unchanged until benchmark evidence justifies a follow-up change.

Non-goals:

- Do not replace Milvus as the production backend in this change.
- Do not change chunk splitting, document identity, or BGE-M3 embedding generation semantics.
- Do not claim a throughput improvement from bounded, failed, or non-parity runs.
- Do not add cloud-only services as required benchmark dependencies.
- Do not optimize retrieval ranking quality beyond a minimal parity check for equivalent stored documents and stable top results.

## Capabilities

### New Capabilities

- `bge-m3-vector-backend-benchmark`: Defines benchmark inputs, backend candidates, required metrics, artifact format, and acceptance criteria for comparing BGE-M3 full write paths across Milvus, Qdrant, and LanceDB.

### Modified Capabilities

- None.

## Impact

- Affected code:
  - `scripts/`: new or extended benchmark runner for storage-backend write-path comparison.
  - `packages/core`: benchmark-only adapters or helpers for serializing BGE-M3 `VectorDocument` batches to candidate backend schemas.
  - `docs` or change `verification.md`: benchmark runbook and evidence summary.
  - Optional dev dependencies for Qdrant and LanceDB clients if no existing dependency is available.
- Runtime impact:
  - Benchmark-only. Production MCP indexing and search behavior remain unchanged.
  - Local benchmark runs may start or require local backend services and write temporary collections/tables.
- Migration impact:
  - No migration for existing indexed collections. Any backend migration or production adapter selection must be proposed separately after this benchmark produces comparable evidence.
