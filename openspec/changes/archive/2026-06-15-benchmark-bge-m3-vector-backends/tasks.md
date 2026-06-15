## 1. Fixture Foundation

- [x] 1.1 Locate the existing BGE-M3 indexing path that produces `VectorDocument` records with dense, sparse, and ColBERT vectors, and document the exact call path used by the benchmark.
- [x] 1.2 Add a benchmark fixture command that can generate or load canonical post-embedding fixtures without writing to any vector backend.
- [x] 1.3 Add fixture metadata and checksum output for source path, scope profile, chunk count, vector dimensions, sparse non-zero statistics, ColBERT vector count statistics, and document identity fields.
- [x] 1.4 Add a fail-closed chunk-count check for the full `examples/demo-1c` developer-scope fixture with expected count `893` and an explicit override for accepted drift.
- [x] 1.5 Add bounded fixture support for `examples/demo-do30-1c`, including cap/timeout/cancellation reason and `bounded: true` metadata.
- [x] 1.6 Verify fixture generation on a tiny synthetic fixture and on `examples/demo-1c` without contacting Milvus, Qdrant, or LanceDB.

## 2. Backend Write Adapters

- [x] 2.1 Implement the benchmark Milvus candidate using the current BGE-M3 insert path, including existing ColBERT JSON payload serialization and flush behavior.
- [x] 2.2 Implement the Qdrant benchmark candidate with native dense vector, model sparse vector, and ColBERT multivector storage fields.
- [x] 2.3 Implement the LanceDB benchmark candidate with a local multivector table and explicit preservation of dense vectors, sparse vectors, content, path fields, metadata, and stable document IDs.
- [x] 2.4 Add structured skip/failure handling for unavailable services, missing optional dependencies, or client APIs that cannot express full-vector comparable storage.
- [x] 2.5 Record backend version, endpoint/URI, collection/table schema, vector datatypes, batch size, flush/index behavior, and write-relevant backend settings for each candidate.
- [x] 2.6 Verify each adapter against a tiny synthetic fixture and confirm that dense, sparse, ColBERT, metadata, and IDs round-trip or are queryable as required by that backend.

## 3. Benchmark Runner And Metrics

- [x] 3.1 Add a benchmark CLI under `scripts/` that accepts dataset, fixture path, backend selection, batch size, output directory, timeout, and skip-backend options.
- [x] 3.2 Ensure all selected backends replay the same fixture checksum, document order, and batch plan.
- [x] 3.3 Measure setup time, collection/table creation time, write wall-clock, finalize/flush/index time, request count, failures, total bytes, and min/max/mean bytes per request.
- [x] 3.4 Add per-request `requests.jsonl` records with backend, dataset, batch id, document count, byte size, elapsed time, and error details when present.
- [x] 3.5 Measure runner RSS before, during, and after each run, and collect backend process RSS when available without fragile privileged assumptions.
- [x] 3.6 Write per-run `summary.json`, `requests.jsonl`, `env.json`, and a matrix-level `summary.json` under `.artifacts/bge-m3-vector-backend-benchmark/`.
- [x] 3.7 Verify metric output on a tiny synthetic matrix with one successful backend and one forced skipped backend.

## 4. Search Parity

- [x] 4.1 Define a small fixed parity query set for the 1C demo fixtures using stable terms, paths, or document IDs from the fixture.
- [x] 4.2 Generate or load query vectors in a way that is shared across Milvus, Qdrant, and LanceDB parity runs.
- [x] 4.3 Compare candidate results against the Milvus baseline using stable document IDs and configured top-k overlap, without requiring score equality.
- [x] 4.4 Write `search-parity.json` with per-query returned IDs, overlap, missing IDs, errors, and passed/failed status.
- [x] 4.5 Mark any backend with failed parity as non-comparable for recommendation/ranking purposes.
- [x] 4.6 Verify parity logic with a controlled synthetic fixture where one backend intentionally misses an expected ID.

## 5. Real Benchmark Runs

- [x] 5.1 Run the full `examples/demo-1c` developer-scope fixture generation and confirm the expected `893` chunk count or record explicit accepted drift.
- [x] 5.2 Run the Milvus current, Qdrant native multivector, and LanceDB multivector write matrix for `examples/demo-1c`.
- [x] 5.3 Run the bounded `examples/demo-do30-1c` fixture generation with explicit cap/timeout/cancellation metadata.
- [x] 5.4 Run the selected backend write matrix for bounded `examples/demo-do30-1c`.
- [x] 5.5 Confirm that failed, skipped, bounded, fixture-drifted, or parity-failed runs are marked non-comparable in the matrix summary.
- [x] 5.6 Capture a short evidence summary that states which backend, if any, is comparable on write wall-clock and bytes/request, and which conclusions are blocked by parity or bounded status.

## 6. Documentation And Verification

- [x] 6.1 Document benchmark usage, required local services, optional dependencies, output artifacts, and interpretation rules.
- [x] 6.2 Add or update self-test coverage for fixture replay, byte accounting, RSS accounting, skip/failure artifacts, and parity gating.
- [x] 6.3 Run `pnpm build:core` and fix any TypeScript build issues introduced by shared benchmark helpers.
- [x] 6.4 Run `pnpm typecheck` and fix type errors.
- [x] 6.5 Run `pnpm lint` and fix lint errors.
- [x] 6.6 Run the benchmark self-test command and include artifact paths in verification notes.
- [x] 6.7 Run `pnpm exec openspec validate benchmark-bge-m3-vector-backends --strict` before marking the change complete.
