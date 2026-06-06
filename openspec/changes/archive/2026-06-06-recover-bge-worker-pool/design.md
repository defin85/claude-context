## Context

The BGE-M3 accelerator can run a primary sidecar plus managed extra sidecars for initial and force indexing. In a long large-repository run, both `8000` and `8001` started correctly and served `/embed_batch`, but later status reported `rejectedWorkers=1` while `8001` remained healthy by `/health` and `/metadata`. The current worker pool marks a worker unhealthy after a failed request and does not revalidate it during the same indexing job.

The same run reached `CODE_CHUNK_LIMIT=450000`. That limit already exists and can be raised through environment configuration, but status does not make the configured limit and limit-reached completion outcome clear enough. Full BGE-M3 mode stores dense, sparse, and ColBERT vectors, so raising the limit has storage and latency impact proportional to the extra chunks.

## Goals / Non-Goals

**Goals:**

- Recover BGE-M3 workers after transient failures without restarting the MCP daemon or managed sidecar services.
- Preserve strict worker equivalence checks for full BGE-M3 dense+sparse+ColBERT mode.
- Expose per-worker health, rejection reason, last failure, last success, and recovery attempts in snapshots/status.
- Make `CODE_CHUNK_LIMIT` visible in configuration/status and report limit-reached indexing as a normal partial-index outcome.
- Document the operational path for raising `CODE_CHUNK_LIMIT` and requiring force reindex to include chunks previously skipped by the lower limit.

**Non-Goals:**

- No automatic increase of the default chunk limit.
- No automatic exclusion of large 1C reports/forms or per-file chunk caps in this change.
- No changes to BGE-M3 vector schema, Milvus collection schema, or search ranking.
- No change from full BGE-M3 to dense-only behavior.

## Decisions

1. **Recover workers through health and metadata revalidation.**

   A worker rejected due to request failure should be eligible for recovery after a bounded cooldown. Recovery checks must call `/health` and `/metadata`, parse the profile, and validate equivalence against the primary profile before marking the worker healthy again.

   Alternative considered: restart rejected managed sidecars immediately. That is heavier and unnecessary when the sidecar still answers health/metadata, as observed in the live run.

2. **Keep failed workers out of request selection until recovery succeeds.**

   The pool should not keep sending production embedding batches to a worker that just failed. Revalidation should be separate from batch routing and should have its own timeout/cooldown.

   Alternative considered: retry the next batch against the same worker immediately. This risks repeated stalls during long indexing jobs.

3. **Expose diagnostics as optional status fields.**

   Worker snapshots should include endpoint, health state, in-flight count, rejection reason, last failure timestamp, last success timestamp, and recovery attempts. Existing clients can ignore new fields.

   Alternative considered: only log diagnostics. Logs are useful for root cause analysis, but status visibility is needed while a long indexing run is still active.

4. **Treat chunk-limit hits as limit-reached completion, not failure.**

   Indexing already returns `status: "limit_reached"` internally. MCP status and completion messages should include configured limit, total chunks indexed, files processed, files remaining if known, and the force-reindex requirement after raising the limit.

   Alternative considered: silently increase `CODE_CHUNK_LIMIT`. Full BGE-M3 storage includes dense, sparse, and ColBERT vectors, so silent increases can raise storage, memory, and latency costs.

## Risks / Trade-offs

- Revalidating workers too aggressively can add extra HTTP traffic and interfere with embedding throughput. Mitigation: bounded cooldown and low-frequency checks.
- A recovered worker might differ after process restart. Mitigation: require strict metadata equivalence before recovery.
- Extra status fields can expose noisy diagnostics. Mitigation: keep fields structured and optional.
- Raising `CODE_CHUNK_LIMIT` can increase Milvus storage, insertion time, and search/rerank latency. Mitigation: keep the default unchanged and make the configured limit explicit.
- Limit-reached indexes are partial but searchable. Mitigation: mark the status clearly and require force reindex after changing the limit.

## Migration Plan

1. Add worker diagnostic fields in a backward-compatible snapshot shape.
2. Add recovery logic behind the existing worker pool path, preserving current behavior for primary-only embedding.
3. Surface `CODE_CHUNK_LIMIT` in indexing logs/status and completion output.
4. Validate with unit tests for worker rejection/recovery and limit-reached status.
5. Run a live smoke with a temporary sidecar failure if feasible, then rerun large indexing with a raised `CODE_CHUNK_LIMIT` when operationally acceptable.

## Open Questions

- What cooldown should be the default for revalidating rejected BGE-M3 workers: 30s, 60s, or based on request timeout?
- Should `CODE_CHUNK_LIMIT` be included in persisted codebase sync config, or remain runtime env only?
- Should a future 1C-specific indexing profile exclude large report forms by default, or should that stay as repo-local `.contextignore` policy?
