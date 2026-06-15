## Context

The current accelerated BGE-M3 full indexing pipeline now has payload-safe embedding batches, managed worker recovery, separate insert scheduling, and fail-fast insert failure handling. Recent local evidence on `examples/demo-do30-1c` shows the next bottleneck:

- LanceDB with `INDEX_INSERT_CONCURRENCY=1`, payload caps `20000/5000`, and 4 workers reached `16%` in about ten minutes with `failedInsertBatches=0`, but spent about `537s` in backpressure.
- LanceDB with `INDEX_INSERT_CONCURRENCY=2` failed after about one minute with `Unexpected end of JSON input`, showing that concurrent writes into one local table are unsafe with the current adapter.
- Qdrant with `INDEX_INSERT_CONCURRENCY=2` and `4` accepted parallel writes with `failedInsertBatches=0`, but still reached only `16%` in the same bounded window.
- Payload-safe limits split large 1C modules into many small batches, often around `9-23` chunks. This protects BGE-M3 workers but increases vector write call count and insert scheduler churn.

The remaining work is not to blindly raise concurrency. The scheduler needs backend-aware write policy, write coalescing after embedding, and clearer pressure attribution.

## Goals / Non-Goals

**Goals:**

- Reduce vector database write call count when payload-safe embedding creates many small batches.
- Preserve BGE-M3 payload safety and worker stability.
- Select insert scheduling behavior from backend capabilities: parallel-safe, single-writer, idempotent upsert support, and preferred write batch sizes.
- Keep exact document IDs, metadata, cancellation, progress, and fail-fast ambiguous-write semantics.
- Make backpressure status distinguish insert backlog, insert latency, retry pressure, worker rejection, host memory, and VRAM pressure.
- Provide benchmark evidence on `examples/demo-do30-1c` before promoting new defaults.

**Non-Goals:**

- No increase to BGE-M3 full embedding payload limits.
- No concurrent LanceDB `table.add` calls into the same table.
- No retrieval quality or ranking changes.
- No mandatory vector backend migration.
- No change to background sync defaults unless explicitly benchmarked.

## Decisions

### Decision: add backend write capability metadata

Each vector database implementation SHALL expose write capabilities used by the accelerated scheduler:

- whether concurrent writes to the same collection are safe,
- whether idempotent upsert is available for BGE-M3 documents,
- recommended maximum write concurrency,
- target and maximum coalesced document counts,
- whether write coalescing is recommended,
- whether failed writes are ambiguous and must fail fast.

Rationale:

- Qdrant can accept concurrent upserts into one collection.
- LanceDB should be treated as single-writer per table until proven otherwise.
- Milvus remains conservative because previous evidence showed parallel insert did not materially improve throughput and ambiguous insert failures must stay contained.

Alternative considered: keep a single global `INDEX_INSERT_CONCURRENCY`. This is simple but lets unsafe backends fail and lets safe backends run without enough information to tune batch shape.

### Decision: coalesce embedded documents before vector writes

The scheduler SHALL keep BGE-M3 embedding batches payload-safe, but it MAY combine multiple completed embedding batches into a larger vector write flush. Coalescing happens after embedding, so it does not increase BGE-M3 request or response payload size.

Suggested flush criteria:

- flush when coalesced document count reaches a target such as `100-300`,
- flush when a short max wait such as `100-500ms` expires,
- flush when cancellation or scheduler drain begins,
- flush immediately for backends that opt out.

Rationale:

- Payload caps made embedding safe but produced many small write calls.
- Larger vector write flushes reduce per-request overhead and insert scheduler churn.
- Coalescing preserves single-writer correctness for local backends while still improving throughput opportunities.

Alternative considered: increase `INDEX_EMBEDDING_MAX_CONTENT_CHARS`. This risks returning to worker rejection and V8 string-size failures.

### Decision: keep backend write safety stronger than requested concurrency

Configured `INDEX_INSERT_CONCURRENCY` remains the operator's upper bound, not a mandate. The effective insert concurrency SHALL be clamped by backend write capabilities. For LanceDB this can be `1` per collection even when the operator requests `2` or `4`. For Qdrant it can allow `2` or `4` when benchmarks remain healthy.

Rationale:

- A backend that corrupts or fails with concurrent writes should not be forced into unsafe writes by a global setting.
- Correctness must remain more important than the appearance of parallelism.

### Decision: separate producer backpressure from resource pressure

Adaptive status SHALL report separate pressure signals and the selected throttle reason, but implementation should avoid turning every pressure signal into a full producer stop. Insert backlog should slow the producer only when the write queue cannot drain after coalescing. VRAM pressure should reduce worker count or effective embedding concurrency when needed, not hide write-side behavior.

Rationale:

- Recent Qdrant runs showed parallel writes worked, but bounded progress stayed at `16%` because backpressure remained around `532s`.
- A single aggregate pressure score is not enough to decide whether to tune writes, embedding concurrency, or worker lifecycle.

### Decision: benchmark acceptance uses bounded progress plus pressure attribution

This change SHALL compare candidates against the latest capped baseline, not against old uncapped failures. The main acceptance evidence is a bounded `examples/demo-do30-1c` run with:

- same codebase and `full` 1C scope,
- same payload caps,
- same worker budget,
- backend and insert policy recorded,
- progress percent and file count,
- write call count, coalesced flush sizes, failed insert count,
- backpressure wait split by reason.

Rationale:

- The target is not only "no failures"; it is materially less waiting or materially more progress in the same window.

## Risks / Trade-offs

- [Risk] Coalescing can delay already embedded documents. -> Mitigation: use a short flush timeout and drain immediately on cancellation/finalization.
- [Risk] Large coalesced writes can create new vector database request-size issues. -> Mitigation: keep max coalesced document count configurable and backend-specific.
- [Risk] Backend capability metadata can become inaccurate. -> Mitigation: add backend tests and benchmark evidence for each enabled policy.
- [Risk] More scheduler states make status harder to read. -> Mitigation: keep compact summaries and expose detailed fields only in structured content.
- [Risk] Effective concurrency lower than configured may surprise operators. -> Mitigation: report configured and effective insert concurrency plus clamp reason.

## Migration Plan

No collection migration is required. Existing indexes remain valid. The rollout can start with diagnostics-only backend capability reporting, then enable coalescing behind defaults for payload-safe BGE-M3 full indexing. Rollback is disabling coalescing and returning to current insert scheduling while preserving payload-safe embedding.

## Open Questions

- What default target should coalescing use for BGE-M3 full: 100, 200, or backend-specific values?
- Should Qdrant default to `INDEX_INSERT_CONCURRENCY=4` after evidence, or should auto mode choose it only when the backend reports parallel-safe writes?
- Should LanceDB implement an internal coalescing queue now, or remain single-writer without coalescing until search parity and write stability tests are broader?
