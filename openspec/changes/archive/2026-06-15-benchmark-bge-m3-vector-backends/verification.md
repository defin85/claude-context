## Infrastructure Verification

Date: 2026-06-09

Commands run:

```bash
node --check scripts/benchmark-bge-m3-vector-backends.js
pnpm benchmark:bge-m3-vector-backends -- --self-test
pnpm benchmark:bge-m3-vector-backends -- --generate-fixture --synthetic-fixture --dataset synthetic-cli --expected-chunks 3 --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-cli-fixture.json
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-fixture.json --backends dry-run,forced-skip --batch-size 2
pnpm benchmark:bge-m3-vector-backends -- --generate-fixture --synthetic-fixture --dataset synthetic-cli --expected-chunks 4 --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/should-not-write.json
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-cli-fixture.json --batch-size 2
pnpm build:core
pnpm typecheck
pnpm lint
pnpm exec openspec validate benchmark-bge-m3-vector-backends --strict
```

Evidence:

- Self-test matrix: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-11-10-848Z-synthetic_self_test/summary.json`
- CLI-generated synthetic fixture: `.artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-cli-fixture.json`
- Explicit run-mode matrix: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-06-07-376Z-synthetic_self_test/summary.json`
- Default backend synthetic matrix: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-06-31-115Z-synthetic_cli/summary.json`

Results:

- The script passes Node syntax check.
- Synthetic self-test writes per-run `summary.json`, `requests.jsonl`, `env.json`, `search-parity.json`, and matrix `summary.json`.
- `dry-run` completes with passing search parity; `forced-skip` is structured as skipped and non-comparable.
- Fixture checksum validation now reports `checksumMatchesStored: true` after chunk-count metadata is recorded.
- Fail-closed chunk-count guard rejects `expected=4` for a 3-document synthetic fixture and does not write the requested output file.
- Default synthetic backend matrix successfully exercised the local Milvus current path, while Qdrant and LanceDB were recorded as structured skips in this environment.
- The temporary Milvus collection created by that default synthetic matrix, `bge_m3_bench_synthetic_cli_milvus_current_72eced7e`, was dropped after the run.
- `pnpm build:core`, `pnpm typecheck`, and `pnpm lint` completed successfully. Lint still reports existing warnings but no errors.
- `pnpm exec openspec validate benchmark-bge-m3-vector-backends --strict` reports the change as valid.

Previously open verification items:

- Bounded `examples/demo-do30-1c` fixture capture. Closed on 2026-06-15; see "Bounded demo-do30-1c Matrix".
- Qdrant native multivector write against a live Qdrant service. Closed for `demo-1c` on 2026-06-09 and for bounded `demo-do30-1c` on 2026-06-15.
- LanceDB multivector write with `@lancedb/lancedb` installed. Closed for `demo-1c` on 2026-06-09 and for bounded `demo-do30-1c` on 2026-06-15.
- Real backend search parity. Closed for `demo-1c` on 2026-06-09 and for bounded `demo-do30-1c` on 2026-06-15.

## demo-1c Fixture And Baseline Run

Date: 2026-06-09

Commands run:

```bash
curl -sS --max-time 5 http://127.0.0.1:8000/health
pnpm benchmark:bge-m3-vector-backends -- --generate-fixture --codebase examples/demo-1c --dataset demo-1c --one-c-index-scope-profile developer --expected-chunks 893 --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json --bge-m3-endpoint http://127.0.0.1:8000
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json --dataset demo-1c --batch-size 100 --cleanup
```

Evidence:

- Fixture: `.artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json`
- Matrix summary: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-17-07-529Z-demo_1c/summary.json`
- Milvus run summary: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-17-07-529Z-demo_1c/demo_1c-milvus-current/summary.json`
- Milvus requests: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-17-07-529Z-demo_1c/demo_1c-milvus-current/requests.jsonl`

Results:

- BGE-M3 sidecar health returned `{"status":"ok"}`.
- Developer-scope `examples/demo-1c` fixture captured 129 files and exactly 893 chunks.
- Fixture checksum: `5d98182ab62e5da9d9735894b5ac50bfe065a8ca7bddf3f3272b5806a1982edb`.
- Fixture stats: dense dimensions `[1024]`, ColBERT dimensions `[1024]`, mean sparse nnz `58.42`, mean ColBERT vectors per document `3.99`.
- Fixture size on disk: about 100 MB.
- Capture used `Context.indexCodebase -> Context.processFileList -> Context.buildPreparedChunkBatchInsert -> CapturingVectorDatabase.insertBgeM3`, so it did not write to Milvus/Qdrant/LanceDB during fixture generation.
- The fixture command writes artifacts through an isolated fixture worker and validates the written checksum before returning success, so native teardown crashes after a valid capture no longer turn a successful fixture into CLI exit `129`.
- Milvus current write completed with 0 failures, 9 requests, write wall-clock `9686.32ms`, total request bytes `54517191`, mean bytes/request `6057465.67`.
- Milvus setup time was `2704.86ms`.
- Runner RSS for the Milvus run started at `657547264`, peaked at `657547264`, and ended at `454987776`.
- Qdrant was skipped because `http://localhost:6333` was unavailable.
- LanceDB was skipped because optional package `@lancedb/lancedb` is not installed.
- The matrix is not comparable yet because Qdrant/LanceDB did not write and real search parity is not implemented.
- The temporary Milvus collection `bge_m3_bench_demo_1c_milvus_current_abf748a2` was removed by `--cleanup`; a post-run `hasCollection` check returned `false`.

## Full Backend Infrastructure And demo-1c Matrix

Date: 2026-06-09

Setup commands:

```bash
pnpm add -D -w @lancedb/lancedb@0.30.0
mkdir -p .artifacts/qdrant-bge-m3-benchmark
docker run -d --name qdrant-bge-m3-benchmark -p 6333:6333 -p 6334:6334 -v "$PWD/.artifacts/qdrant-bge-m3-benchmark:/qdrant/storage" qdrant/qdrant:latest
curl http://localhost:6333/
```

Runtime evidence:

- Qdrant container: `qdrant-bge-m3-benchmark`
- Qdrant image: `qdrant/qdrant:latest`
- Qdrant version: `1.18.2`
- LanceDB package: `@lancedb/lancedb 0.30.0`

Smoke command:

```bash
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-fixture.json --backends milvus-current,qdrant-native,lancedb-native --batch-size 2 --cleanup
```

Smoke evidence:

- Matrix summary: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-28-35-999Z-synthetic_self_test/summary.json`
- Result: Milvus, Qdrant, and LanceDB completed writes with 0 failures.

Round-trip command:

```bash
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-fixture.json --dataset synthetic-roundtrip --backends milvus-current,qdrant-native,lancedb-native --batch-size 2
```

Round-trip evidence:

- Matrix summary: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-29-54-534Z-synthetic_roundtrip/summary.json`
- Milvus collection: `bge_m3_bench_synthetic_self_test_milvus_current_2e45f2c1`
- Qdrant collection: `bge_m3_bench_synthetic_self_test_qdrant_native_b1229d1d`
- LanceDB table: `bge_m3_bench_synthetic_self_test_lancedb_native_e00adfdb`

Round-trip result:

- All three backends returned IDs `synthetic-001`, `synthetic-002`, and `synthetic-003`.
- All three backends preserved dense vector length `4`, sparse nnz for first document `2`, ColBERT token vector count for first document `2`, and metadata keys `chunkIndex`, `language`, `retrievalMode`, `retrievalSchemaVersion`.
- The temporary round-trip Milvus collection, Qdrant collection, and LanceDB table were dropped after verification.

demo-1c matrix command:

```bash
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json --dataset demo-1c --backends milvus-current,qdrant-native,lancedb-native --batch-size 100 --cleanup
```

demo-1c evidence:

- Matrix summary: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-28-57-278Z-demo_1c/summary.json`
- Milvus run: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-28-57-278Z-demo_1c/demo_1c-milvus-current/summary.json`
- Qdrant run: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-28-57-278Z-demo_1c/demo_1c-qdrant-native/summary.json`
- LanceDB run: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T13-28-57-278Z-demo_1c/demo_1c-lancedb-native/summary.json`

demo-1c write results:

| Backend | Setup ms | Write ms | Requests | Total request bytes | Mean bytes/request | Peak runner RSS | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Milvus current | 2475.37 | 9508.89 | 9 | 54517191 | 6057465.67 | 657567744 | 0 |
| Qdrant native | 326.11 | 1364.96 | 9 | 54423793 | 6047088.11 | 619438080 | 0 |
| LanceDB native | 39.65 | 572.10 | 9 | 54432451 | 6048050.11 | 641466368 | 0 |

Interpretation:

- All three backends completed the `demo-1c` write matrix with 0 failures.
- Qdrant and LanceDB are much faster on write wall-clock in this local run.
- This earlier matrix was non-comparable for production recommendation because real search parity was not implemented yet and every run had `searchParity: not_run`.
- `--cleanup` removed the temporary Milvus collection, Qdrant collection, and LanceDB table after the run.

Validation after infrastructure setup:

```bash
node --check scripts/benchmark-bge-m3-vector-backends.js
pnpm build:core
pnpm typecheck
pnpm lint
pnpm exec openspec validate benchmark-bge-m3-vector-backends --strict
```

Validation result:

- `node --check` passed.
- `pnpm build:core` passed.
- `pnpm typecheck` passed when rerun after `build:core` completed. A previous parallel run raced with `build:core` cleaning `packages/core/dist` and produced transient TS6305 errors.
- `pnpm lint` passed with existing warnings and no errors.
- OpenSpec strict validation passed.

## Real Search Parity Implementation

Date: 2026-06-09

Commands run:

```bash
node --test scripts/benchmark-bge-m3-vector-backends.search-parity.test.js
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-fixture.json --dataset synthetic-parity-real --backends milvus-current,qdrant-native,lancedb-native --batch-size 2 --cleanup
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/self-test/synthetic-fixture.json --dataset synthetic-parity-api --backends dry-run,qdrant-native,lancedb-native --batch-size 2 --cleanup
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json --dataset demo-1c --backends milvus-current,qdrant-native,lancedb-native --batch-size 100 --cleanup
curl -sS --max-time 5 http://localhost:6333/collections
```

Evidence:

- Intentional parity failure self-test: `scripts/benchmark-bge-m3-vector-backends.search-parity.test.js`
- Synthetic real-backend smoke: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-38-07-610Z-synthetic_parity_real/summary.json`
- Synthetic Qdrant/LanceDB search API smoke with dry-run baseline: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-38-21-369Z-synthetic_parity_api/summary.json`
- demo-1c comparable matrix: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-38-30-506Z-demo_1c/summary.json`
- demo-1c Milvus parity: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-38-30-506Z-demo_1c/demo_1c-milvus-current/search-parity.json`
- demo-1c Qdrant parity: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-38-30-506Z-demo_1c/demo_1c-qdrant-native/search-parity.json`
- demo-1c LanceDB parity: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-38-30-506Z-demo_1c/demo_1c-lancedb-native/search-parity.json`

Results:

- The search parity suite now selects five deterministic fixture-document queries, reuses fixture dense/sparse/ColBERT vectors, and does not call the embedding sidecar during parity.
- `search-parity.json` now records status, baseline backend, query metadata, returned IDs/scores, overlap, missing IDs, rank drift, per-query latency, and errors.
- The controlled self-test includes a `parity-miss` backend that writes all documents but intentionally omits the expected query ID from search results; it records `searchParity: failed` and remains non-comparable.
- Synthetic real-backend smoke reached Milvus, Qdrant, and LanceDB. The tiny synthetic Milvus baseline failed one query-by-id expectation, so Qdrant and LanceDB parity were correctly skipped as baseline-unavailable.
- Synthetic Qdrant/LanceDB API smoke with dry-run baseline confirmed both real adapters execute search successfully, but the matrix is still non-comparable because real backend comparability requires the Milvus baseline.
- demo-1c wrote all three real backends with 0 failures and `comparable: true`.
- demo-1c search parity status: Milvus `passed`, Qdrant `passed`, LanceDB `passed`.
- demo-1c parity queries: 5 passed / 0 failed for every backend.
- Qdrant minimum top-k overlap against Milvus was `0.6` with threshold `0.5`; LanceDB minimum top-k overlap was `0.8`.
- demo-1c write wall-clock: Milvus `9677.96ms`, Qdrant `1348.79ms`, LanceDB `564.48ms`.
- demo-1c search parity wall-clock: Milvus `124.46ms`, Qdrant `21.50ms`, LanceDB `30.77ms`.
- demo-1c total request bytes: Milvus `54517191`, Qdrant `54423793`, LanceDB `54432451`.
- `--cleanup` removed the temporary Qdrant collection, Milvus collection, and LanceDB table. Qdrant `/collections` returned an empty collection list; Milvus `hasCollection('bge_m3_bench_demo_1c_milvus_current_61529b34')` returned `false`; LanceDB had no `demo_1c` tables.

Post-implementation validation:

```bash
node --check scripts/benchmark-bge-m3-vector-backends.js
node --test scripts/benchmark-bge-m3-vector-backends.search-parity.test.js
pnpm benchmark:bge-m3-vector-backends -- --self-test
pnpm build:core
pnpm typecheck
pnpm lint
pnpm exec openspec validate benchmark-bge-m3-vector-backends --strict
pnpm exec openspec instructions apply --change "benchmark-bge-m3-vector-backends" --json
```

Validation result:

- `node --check` passed.
- `node --test scripts/benchmark-bge-m3-vector-backends.search-parity.test.js` passed.
- Synthetic self-test artifact: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-09T14-41-22-047Z-synthetic_self_test/summary.json`.
- Synthetic self-test results: `dry-run=passed`, `parity-miss=failed`, `forced-skip=skipped`, matrix `comparable=false`.
- `pnpm build:core` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with existing warnings and no errors.
- `pnpm exec openspec validate benchmark-bge-m3-vector-backends --strict` passed.
- OpenSpec apply progress was `35/38` before the bounded `demo-do30-1c` closure below.

## Bounded demo-do30-1c Matrix

Date: 2026-06-15

Setup evidence:

- BGE-M3 sidecar health at `http://127.0.0.1:8000/health`: `{"status":"ok"}`.
- Milvus was reachable at `localhost:19530`.
- Qdrant container `qdrant-bge-m3-benchmark` was started; Qdrant reported version `1.18.2`.
- LanceDB package was installed.

Fixture command:

```bash
CODE_CHUNK_LIMIT=1000 pnpm benchmark:bge-m3-vector-backends -- --generate-fixture --codebase examples/demo-do30-1c --dataset demo-do30-1c-bounded --one-c-index-scope-profile full --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-do30-1c-bounded.json --bounded --bounded-reason CODE_CHUNK_LIMIT=1000 --bge-m3-endpoint http://127.0.0.1:8000
```

Fixture evidence:

- Fixture: `.artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-do30-1c-bounded.json`
- Dataset: `demo-do30-1c-bounded`
- Source: `examples/demo-do30-1c`
- Scope profile: `full`
- Boundary: `bounded=true`, `boundedReason=CODE_CHUNK_LIMIT=1000`
- Context result: `status=limit_reached`, `indexedFiles=24`, `totalChunks=1000`, `codeChunkLimit=1000`
- Fixture checksum: `26685a6a19330d7b54318c834c532429474b58fa7fc12ce97773d8a604b7ea9d`
- Fixture stats: dense dimensions `[1024]`, ColBERT dimensions `[1024]`, mean sparse nnz `62.343`, mean ColBERT vectors per document `3.985`
- Fixture size on disk: about 112 MB

The fixture command now exits with `0` on this bounded capture. The CLI isolates fixture generation in a worker process and accepts the run only after the written fixture is present, non-empty, checksum-valid, and matches the expected chunk guard when one is supplied. The previously observed worker-side `free(): invalid pointer` native teardown is filtered after successful fixture validation and no longer propagates as CLI exit `129`.

Matrix command:

```bash
pnpm benchmark:bge-m3-vector-backends -- --run --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-do30-1c-bounded.json --dataset demo-do30-1c-bounded --backends milvus-current,qdrant-native,lancedb-native --batch-size 100 --bounded --bounded-reason CODE_CHUNK_LIMIT=1000 --cleanup
```

Matrix evidence:

- Matrix summary: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-15T08-51-00-892Z-demo_do30_1c_bounded/summary.json`
- Milvus run: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-15T08-51-00-892Z-demo_do30_1c_bounded/demo_do30_1c_bounded-milvus-current/summary.json`
- Qdrant run: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-15T08-51-00-892Z-demo_do30_1c_bounded/demo_do30_1c_bounded-qdrant-native/summary.json`
- LanceDB run: `.artifacts/bge-m3-vector-backend-benchmark/2026-06-15T08-51-00-892Z-demo_do30_1c_bounded/demo_do30_1c_bounded-lancedb-native/summary.json`

Bounded matrix write results:

| Backend | Setup ms | Write ms | Requests | Total request bytes | Mean bytes/request | Peak runner RSS | Failures | Search parity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Milvus current | 2303.74 | 11516.43 | 10 | 61552188 | 6155218.80 | 716312576 | 0 | passed |
| Qdrant native | 355.89 | 1626.83 | 10 | 61439640 | 6143964.00 | 661757952 | 0 | passed |
| LanceDB native | 40.05 | 687.82 | 10 | 61449447 | 6144944.70 | 688898048 | 0 | passed |

Interpretation:

- All three selected real backends completed the bounded `demo-do30-1c` write matrix with `0` failures.
- All three backends passed search parity on 5 fixture-vector queries.
- The matrix summary reports `comparable=false`, `interpretation.rankingAvailable=false`, and `interpretation.boundedResultsExcluded=true`.
- Each backend run is marked `comparable=false` even though writes and parity passed, because the fixture is bounded.
- This closes the non-comparable gating requirement for bounded runs: the result is valid operational evidence for backend behavior on the bounded subset, but it is not ranked as a complete throughput winner.
- `--cleanup` removed benchmark backend artifacts; Qdrant `/collections` showed no benchmark collection after the run.
