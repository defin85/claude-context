# BGE-M3 Vector Backend Benchmark

This runbook covers the benchmark infrastructure for comparing the current Milvus BGE-M3 write path with Qdrant native dense+sparse+multivector storage and LanceDB local multivector storage.

The benchmark is write-path evidence only. A backend is comparable only when it writes the same fixture checksum, uses the same batch plan, completes without failures, is not bounded, uses the Milvus current baseline when real backends are selected, and passes search parity.

## Commands

Run the synthetic infrastructure self-test:

```bash
pnpm benchmark:bge-m3-vector-backends -- --self-test
```

Generate the full `demo-1c` fixture without writing to a vector backend:

```bash
pnpm benchmark:bge-m3-vector-backends -- \
  --generate-fixture \
  --codebase examples/demo-1c \
  --dataset demo-1c \
  --one-c-index-scope-profile developer \
  --expected-chunks 893 \
  --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json
```

Run the write matrix against a fixture:

```bash
pnpm benchmark:bge-m3-vector-backends -- \
  --run \
  --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json \
  --backends milvus-current,qdrant-native,lancedb-native \
  --batch-size 100
```

Add `--cleanup` when temporary backend collections/tables should be deleted after each run.

Generate a bounded `demo-do30-1c` fixture:

```bash
pnpm benchmark:bge-m3-vector-backends -- \
  --generate-fixture \
  --codebase examples/demo-do30-1c \
  --dataset demo-do30-1c \
  --one-c-index-scope-profile developer \
  --bounded \
  --bounded-reason "manual cap or timeout" \
  --timeout-ms 1800000 \
  --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-do30-1c-bounded.json
```

## Services

Milvus uses the current SDK-backed BGE-M3 path from `packages/core/dist/vectordb/milvus-vectordb.js`. Configure it with `MILVUS_ADDRESS` and, if needed, `MILVUS_TOKEN`.

Qdrant uses the REST API directly and defaults to `http://localhost:6333`. Configure another endpoint with `QDRANT_URL` or `--qdrant-url`. If an API key is needed, store it in an environment variable and pass `--qdrant-api-key-env <name>`.

Local Qdrant benchmark container used for this change:

```bash
mkdir -p .artifacts/qdrant-bge-m3-benchmark
docker run -d \
  --name qdrant-bge-m3-benchmark \
  -p 6333:6333 \
  -p 6334:6334 \
  -v "$PWD/.artifacts/qdrant-bge-m3-benchmark:/qdrant/storage" \
  qdrant/qdrant:latest
curl http://localhost:6333/
```

LanceDB uses local package `@lancedb/lancedb`. The default database path is `.artifacts/bge-m3-vector-backend-benchmark/lancedb`.

## Artifacts

Each matrix run writes:

- `summary.json`: per-backend completion, timing, bytes/request, RSS, settings, and comparability.
- `requests.jsonl`: per-batch write bytes, elapsed time, and errors.
- `env.json`: sanitized environment and host metadata.
- `search-parity.json`: parity status, returned IDs, overlap, missing IDs, rank drift, query latency, and errors.
- matrix `summary.json`: all backend runs, parity query metadata, matrix-level `comparable`, and comparable ranking when the full real-backend matrix is comparable.

Artifacts are written under `.artifacts/bge-m3-vector-backend-benchmark/`.

## Search Parity

Search parity uses fixture documents as the query vector source, so it does not call the embedding sidecar after write replay. The query set is deterministic: up to five stable fixture document IDs are selected from the sorted fixture IDs, and each query carries dense, sparse, and ColBERT vectors from that document.

For real backend matrices, `milvus-current` is the required baseline. Qdrant uses native named-vector `/points/query` with dense, sparse, and ColBERT multivector prefetch plus RRF fusion. LanceDB uses local multivector search on `colbert_vectors`. Candidates pass when every query includes its expected document ID and overlaps the Milvus top-k by at least `0.5`; score equality is not required.

Parity statuses are `passed`, `failed`, `skipped`, or `not_run`. The matrix `summary.json` sets `comparable: true` only when all selected real backends completed, were not skipped or bounded, had zero failures, replayed the stored fixture checksum, used the Milvus baseline, and reported `searchParity=passed`.

## Interpretation

Do not rank or claim a backend win from bounded, skipped, failed, fixture-drifted, or non-parity runs.

The Milvus baseline intentionally preserves the current ColBERT JSON payload serialization and flush behavior. Any optimized Milvus schema should be a separate candidate or follow-up change.
