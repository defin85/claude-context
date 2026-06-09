## Context

`indexing-perf-04` split embedding and insert batch sizes, but batching remains primarily chunk-count based. In BGE-M3 full mode, a chunk-count batch can still produce oversized HTTP/JSON/string payloads because every chunk can return dense vectors, sparse lexical weights, and ColBERT token vectors. Local benchmark artifacts for `examples/demo-1c` showed fatal embedding-stage failures with `Cannot create a string longer than 0x1fffffe8 characters` for `100/100` and `200/100` candidates.

The failure happens before vector insertion, so insert batch sizing cannot protect the embedding request/response path. The indexer needs payload-risk limits before embedding and a safe fallback when estimates are wrong.

## Goals / Non-Goals

**Goals:**

- Bound embedding batches by payload-risk signals, not only chunk count.
- Preserve current chunk splitting semantics, document IDs, metadata, and embedding result order.
- Recover from payload-size embedding failures by retrying smaller embedding sub-batches.
- Surface diagnostics that explain payload-driven splits and retries.
- Keep dense-only and non-BGE providers predictable while allowing BGE-M3 full to use safer limits.

**Non-Goals:**

- No new sidecar protocol or streaming embedding response format.
- No change to vector insert semantics beyond consuming the ordered embedded documents produced by fallback.
- No automatic retrieval-profile selection.
- No default throughput claim without benchmark artifacts.

## Decisions

### Decision: add payload-aware batch admission before embedding

Embedding batch construction SHALL use a small batch accumulator with limits for:

- max chunks,
- max content characters,
- max estimated tokens.

The next chunk is admitted only if it fits all configured limits. This prevents known-large batches before they reach the provider. Alternatives considered:

- **Only lower `INDEX_EMBEDDING_BATCH_SIZE` globally**: simple, but penalizes providers and repositories that can handle larger chunk-count batches.
- **Only split on failure**: useful as a backstop, but wastes time and can reject workers before recovery.

### Decision: make BGE-M3 full defaults more conservative through effective limits

The generic default can remain compatible with legacy behavior, but BGE-M3 full indexing SHOULD use conservative payload limits unless the operator overrides them. Dense-only BGE-M3 and non-BGE providers do not have ColBERT response payload cost and can keep the generic path.

### Decision: retry payload-size failures by recursive ordered splitting

When an embedding batch fails with a recognized payload-size error, the system SHALL split the logical embedding batch into smaller sub-batches, embed each sub-batch, and concatenate results in original chunk order. The logical batch remains the same for progress and document metadata; only provider calls are split.

Alternatives considered:

- **Mark the whole indexing run failed**: preserves current behavior but leaves one oversized batch able to stop an otherwise valid index.
- **Retry with a fixed smaller size only once**: simpler, but still fails when chunks are highly uneven.

### Decision: fail at single-chunk granularity with precise diagnostics

If a single chunk still triggers a payload-size failure, the system SHALL fail that batch with file path, chunk index, content character count, estimated tokens, and provider mode. This identifies malformed or oversized source content without hiding a real provider limitation.

### Decision: expose payload pressure in status and benchmarks

Accelerator status and benchmark summaries SHALL record content character counts, estimated tokens, split reason, and payload retry split counts. This allows future default changes to be tied to evidence instead of anecdotal batch-size tuning.

## Risks / Trade-offs

- **More provider calls** -> Payload-safe splits may increase wall-clock on small repositories. Mitigation: apply conservative effective limits primarily where payload risk exists and verify with benchmark artifacts.
- **Retry splitting hides provider bugs** -> Recursive fallback may mask sidecar defects. Mitigation: only trigger for recognized payload-size errors and fail single-chunk cases with detailed diagnostics.
- **Metrics become more complex** -> Logical batches and provider sub-batches diverge. Mitigation: keep logical batch IDs stable and add explicit sub-batch counters instead of reusing existing batch counters ambiguously.
- **Estimates can be wrong** -> Character/token estimates cannot predict serialized ColBERT payload exactly. Mitigation: keep failure-based splitting as a backstop.

## Migration Plan

No collection migration is required. Existing indexed collections remain valid. Operators can roll back by disabling new payload limit overrides and fallback behavior if an implementation adds such a flag; otherwise rollback is a code rollback because this only affects future indexing runs.

## Open Questions

- What BGE-M3 full effective default should be used after benchmark evidence: `50` chunks, a char/token cap, or both?
- Should payload-safe retry be enabled for all providers or only BGE-M3 full plus known JSON/string-size errors?
- Should the sidecar later support streaming or binary payloads to reduce JSON string pressure?
