## Context

The current Qdrant adapter in `packages/core` uses REST requests for collection administration, search, scroll/count, delete, and point writes. Full BGE-M3 indexing writes dense vectors, model sparse lexical weights, ColBERT token vectors, and payload metadata through JSON batches. With Qdrant now used as the default local vector store, write transport overhead is worth measuring independently from chunking, embedding, and ranking changes.

Qdrant exposes both HTTP and gRPC APIs, and the local native service listens on HTTP port `6333` and gRPC port `6334`. The repository already has a transport-neutral `VectorDatabase` interface, so the change can be isolated to Qdrant adapter wiring and data mapping.

## Goals / Non-Goals

**Goals:**

- Add an opt-in Qdrant gRPC path for vector batch writes.
- Preserve full BGE-M3 data parity: dense vector, sparse vector, ColBERT multivector, payload, and point identity.
- Keep existing HTTP behavior as the default and fallback.
- Produce a controlled HTTP-versus-gRPC write performance measurement.
- Make rollback a configuration change rather than a collection migration.

**Non-Goals:**

- No change to BGE-M3 retrieval logic, ranking, reranking, or query semantics.
- No automatic conversion of existing collections.
- No full rewrite of Qdrant search/admin operations to gRPC in this change.
- No default switch to gRPC before benchmark evidence is captured.

## Decisions

### Decision: implement gRPC as an opt-in write transport

The Qdrant factory SHALL select HTTP by default and only use gRPC when configuration explicitly requests it. This keeps existing daemon behavior stable and allows direct comparison against the current implementation.

Alternative considered: replace the whole Qdrant adapter with a gRPC client. That would increase scope by requiring search filters, scroll/count, collection setup, and diagnostics to move at once, while the immediate performance question is about indexing writes.

### Decision: use a hybrid adapter during the first phase

The first implementation SHOULD keep collection administration, search, delete, scroll/count, and diagnostics on the existing HTTP adapter while routing point writes through gRPC. The adapter can use composition or subclassing, but external callers should still see one `VectorDatabase` implementation.

Alternative considered: create a completely separate full `QdrantGrpcVectorDatabase`. That is cleaner long term, but it creates more parity work before any write-performance evidence exists.

### Decision: preserve wire-level data parity before benchmarking

The gRPC write path SHALL map the same stable point identifiers, vector names, vector values, sparse indices/values, ColBERT multivectors, and payload fields as the HTTP path. Tests should compare normalized point data or read back inserted points to catch mismatches before timing results are trusted.

### Decision: benchmark isolated temporary collections

Benchmark runs SHALL use temporary Qdrant collections or disposable fixture indexes. They MUST NOT clear or rewrite the existing Business Automation demo collection used for live retrieval checks.

### Decision: measure compression separately

The gRPC client defaults may use compression. Localhost writes should be tested with compression enabled and disabled because gzip can trade lower transfer size for higher CPU cost when network latency is negligible.

## Risks / Trade-offs

- gRPC mapping bug changes stored vectors or payloads -> Add parity tests and read-back checks before performance measurements.
- gRPC appears faster only by skipping durability semantics -> Preserve the same write wait/acknowledgement semantics as the HTTP path unless an explicit benchmark variant labels the difference.
- Local compression hides the real bottleneck -> Record compression mode and compare both modes when practical.
- Additional dependency increases install surface -> Use the official Qdrant JavaScript gRPC client and keep HTTP mode available without operational migration.
- Benchmark noise from embedding dominates write timings -> Use existing indexing metrics and, where possible, compare insert-stage timing rather than only total wall-clock time.

## Migration Plan

1. Add configuration for Qdrant transport selection and gRPC endpoint.
2. Add gRPC write support behind the existing vector database interface.
3. Keep default configuration on HTTP.
4. Run unit/parity tests and a temporary-collection benchmark.
5. Document results and recommended default.

Rollback is changing the transport configuration back to HTTP and restarting the daemon. Existing collections require no migration because the stored schema and point payloads remain unchanged.

## Open Questions

- Does the official Qdrant JavaScript gRPC client expose the point-write API with enough type safety for all full BGE-M3 vector forms, or do we need a small local mapper around generated protobuf types?
- Which benchmark fixture gives the best signal without spending the full Business Automation indexing time on every development run?
- Should gRPC compression be controlled by a first-class environment variable or kept as an internal benchmark option until evidence supports exposing it?
