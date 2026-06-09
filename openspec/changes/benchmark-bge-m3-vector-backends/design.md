## Context

The current BGE-M3 full-vector path writes `VectorDocument` records with dense vectors, model-generated sparse vectors, and ColBERT token vectors. Milvus is the production baseline, but the current implementation stores ColBERT vectors as a JSON payload field before insert/flush, so write cost includes both vector storage and payload serialization overhead.

The indexing performance work already showed that adding embedding workers can move the bottleneck from embedding generation to vector writes. This change measures that write path directly instead of inferring backend behavior from end-to-end indexing runs.

Important distinctions:

- Dense-only BGE-M3 means one model dense vector per chunk. It is not enough for this benchmark.
- Full BGE-M3 means dense vector, model sparse lexical weights, and ColBERT token vectors for late-interaction search. The benchmark must preserve all three shapes.
- The benchmark compares storage/write behavior and a minimal retrieval parity check. It is not a retrieval-quality tuning project.

## Goals / Non-Goals

**Goals:**

- Produce repeatable write-path metrics for the same BGE-M3 `VectorDocument` fixture across current Milvus, Qdrant native multivector, and LanceDB multivector candidates.
- Isolate backend write cost from embedding generation by replaying a canonical fixture into each backend.
- Measure write wall-clock, bytes/request, request count, failures, peak RSS, backend settings, and search parity.
- Run the matrix on the full `examples/demo-1c` developer-scope fixture and a bounded `examples/demo-do30-1c` fixture.
- Leave artifacts that support a later decision about Milvus optimization, backend migration, or a staging/cache layer.

**Non-Goals:**

- Replace Milvus as the production backend.
- Change chunk splitting, document IDs, embedding generation, or ranking semantics.
- Implement an in-memory production cache or durable write spool.
- Claim throughput wins from failed, skipped, bounded, or non-parity runs.
- Tune ANN/search latency beyond the minimal parity check needed to prove inserted records are usable.

## Decisions

### Replay canonical fixtures instead of running full indexing per backend

The benchmark runner will first create or load a canonical fixture containing the post-embedding `VectorDocument` records. Each backend adapter then writes that exact fixture using the same document order and batch plan.

Rationale: this separates vector DB write behavior from splitter, file IO, and BGE-M3 embedding latency. It also makes bytes/request and request count comparable.

Alternative considered: run full indexing once per backend. That would be closer to production wall-clock, but backend differences would be mixed with embedding concurrency, retries, and fixture drift.

### Preserve current Milvus behavior as the baseline

The Milvus candidate must use the existing BGE-M3 storage path, including JSON serialization of ColBERT vectors and current flush behavior. Any optimized Milvus variant belongs in a later change or an explicitly separate benchmark candidate.

Rationale: the user question is whether parallel write/insert helped and whether Milvus is now the limiting path. The baseline must be the path we actually run today.

Alternative considered: benchmark a hand-optimized Milvus schema immediately. That would answer a different question and hide the current cost center.

### Model Qdrant as native dense + sparse + multivector

The Qdrant candidate will store dense, model sparse, and ColBERT multivector data using named vector fields and sparse vector configuration where supported by the selected client/API. The artifact must record collection settings that affect write cost, including vector datatypes, on-disk/in-memory settings, indexing thresholds, shard/replica choices, WAL or optimizer changes, and whether indexing was deferred during bulk load.

Rationale: Qdrant is useful in this comparison only if it avoids treating ColBERT vectors as opaque JSON payload and uses native multivector search semantics.

Alternative considered: store ColBERT vectors in payload for Qdrant too. That would be comparable to Milvus payload shape, but would not answer whether native multivector storage improves heavy writes.

### Model LanceDB as local multivector storage

The LanceDB candidate will use a local table with a multivector column for ColBERT token vectors. Dense and sparse data must be preserved in explicit columns or documented fallback columns so the fixture remains round-trippable. If the TypeScript client cannot express the required multivector write/search behavior, the run must be marked skipped or failed with that limitation in the artifact instead of silently degrading to dense-only.

Rationale: LanceDB is an embedded/local-storage alternative that may avoid service round trips for heavy writes. The benchmark must make that trade-off visible without turning it into a production migration.

Alternative considered: use a Python-only LanceDB helper. That could be faster to prototype but adds a second runtime path to a TypeScript benchmark and makes integration evidence weaker. A Python fallback is acceptable only if it is explicitly recorded as a backend runner variant.

### Measure request bytes at the adapter boundary

Each backend adapter will expose the serialized request size or a conservative byte estimate per write call. The runner records per-request bytes, request count, min/max/mean bytes/request, and total bytes.

Rationale: the suspected issue is heavy payload insertion. Bytes/request is the most direct way to compare JSON-string ColBERT payloads against native multivector writes and embedded-table writes.

Alternative considered: record only chunk count and wall-clock. That would not explain whether time is caused by backend execution, client serialization, or request payload size.

### Peak RSS is measured for the runner and, when practical, backend processes

The runner records Node process RSS before, during, and after each backend write. For local service backends, it should also record backend process RSS when the process can be identified without privileged or fragile commands. Missing backend-process RSS is allowed only when marked as unavailable.

Rationale: an in-memory cache/spool could help if request latency dominates, but it can make RSS unacceptable. This benchmark must capture memory pressure before proposing that path.

Alternative considered: use only wall-clock. That would make LanceDB and RAM-cache ideas look cheaper than they are.

### Search parity is a gate for recommendations

After each successful write, the runner executes a small fixed search-parity suite. The suite compares results against the Milvus baseline for stable document IDs and top-k overlap, and stores mismatches. Exact score equality is not required because backend scoring and late-interaction implementations differ.

Rationale: fastest write is not useful if the stored vectors cannot support equivalent retrieval. Parity is deliberately minimal so this change stays a write-path benchmark.

Alternative considered: skip search checks. That would risk recommending a backend that only wrote data but did not preserve full BGE-M3 usability.

## Risks / Trade-offs

- Backend defaults can dominate results -> record every write-relevant setting and compare only runs with explicit, reproducible settings.
- Qdrant and LanceDB multivector search semantics may not exactly match current Milvus reranking -> use top-k overlap and stable IDs rather than score equality.
- Bounded `demo-do30-1c` runs can be misread as complete throughput evidence -> set `bounded: true` in artifacts and exclude bounded runs from win claims.
- Fixture chunk counts can drift when splitters or ignore rules change -> assert the expected `demo-1c` chunk count and require an explicit override to accept drift.
- Optional backend dependencies can make CI brittle -> keep production code paths unchanged and allow benchmark-only skips that are visible in artifacts.
- LanceDB local writes remove network/service overhead -> report it as an embedded-local candidate, not a drop-in service replacement.

## Migration Plan

This change has no production migration. It adds benchmark-only code and artifacts.

Implementation rollout:

1. Add fixture extraction/replay and backend adapters behind benchmark CLI commands.
2. Run self-tests on tiny synthetic fixtures.
3. Run the `demo-1c` and bounded `demo-do30-1c` matrix locally.
4. Store machine-readable evidence under `.artifacts/bge-m3-vector-backend-benchmark/`.
5. Use the evidence to propose a separate production optimization or migration change.

Rollback is deleting the benchmark-only scripts/adapters and optional dev dependencies. Existing Milvus collections and MCP indexing behavior are unaffected.

## Open Questions

- Which Qdrant bulk-write settings should be treated as the default candidate versus a tuned candidate if indexing deferral materially changes write time?
- Should LanceDB be benchmarked through TypeScript only, or should a recorded Python fallback be allowed if TypeScript multivector support is incomplete locally?
- Which fixed parity queries best represent the 1C demo codebase without turning this into a full retrieval-quality evaluation?
