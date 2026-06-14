## Context

`indexing-perf-08-write-coalescing-and-backpressure-tuning` closed Qdrant write evidence for `examples/demo-do30-1c`: Qdrant accepted backend-aware insert concurrency `2` and `4` with coalescing and zero failed insert batches. The remaining bounded-run pressure came from BGE-M3 full embedding retries:

- insert concurrency `2`: `24` retried batches, all `embedding_error`, `failedBatches=0`, throttle reason `retry_rate`, insert backlog `0`;
- insert concurrency `4`: `22` retried batches, all `embedding_error`, `failedBatches=0`, throttle reason `retry_rate`, insert backlog `0`;
- journal evidence shows repeated `Rejected worker http://127.0.0.1:800X: embedding_error fetch failed` followed by successful worker recovery.

The current evidence proves the symptom but not the root cause. `fetch failed` is too coarse: it may hide socket resets, sidecar process stalls, response write failures, request cancellation, CUDA/runtime pressure, model-server saturation, or a client-side timeout/abort path. Full BGE-M3 dense+sparse+ColBERT indexing is the relevant mode; dense-only behavior is not enough evidence for this issue.

## Goals / Non-Goals

**Goals:**

- Preserve existing retry and recovery behavior while adding enough evidence to diagnose transient BGE-M3 fetch failures.
- Capture request-level client metadata and low-level fetch causes without logging source code contents or embedding payload text.
- Capture sidecar `/embed_batch` timing and failure evidence, including Python exception class and failure phase when available.
- Produce a reproducible diagnostic run matrix that can distinguish worker-count pressure, payload-size pressure, full-mode output pressure, and client transport behavior.
- Classify the dominant cause for `embedding_error fetch failed` using artifacts, not inference.

**Non-Goals:**

- Do not change retrieval ranking, dense/sparse/ColBERT semantics, or stored vector schema.
- Do not promote new defaults for worker count, payload caps, retry budget, adaptive backpressure, or Qdrant insert concurrency in this change.
- Do not log source text, credentials, API keys, or raw embedding vectors.
- Do not treat a lower retry rate as a fix unless root cause evidence explains why it changed.

## Decisions

### Decision: add structured client-side failure cause capture

The BGE-M3 embedding provider SHALL capture sanitized failure metadata when an embedding request fails:

- worker endpoint and attempt number,
- logical batch id when available,
- chunk count, content-character count, estimated-token count, mode, and configured payload limits,
- request duration and timeout/cancellation state,
- normalized error name/message plus low-level cause name/code/message when provided by Node fetch.

Rationale: `embedding_error fetch failed` hides the difference between `ECONNRESET`, closed socket, timeout, cancellation, malformed response, and process death. Capturing `error.cause` and request shape gives enough evidence without storing payload content.

Alternative considered: rely on journal text only. That already proved insufficient because sidecar logs show many `200 OK` lines and Node logs collapse the failure into `fetch failed`.

### Decision: add sidecar request timing and failure logs

The Python BGE-M3 sidecar SHALL log structured `/embed_batch` request outcomes with request id, batch shape, duration, success/failure phase, and exception type/message. It SHALL NOT log raw text or embeddings.

Rationale: if the sidecar sees no exception for failed client requests, the issue is likely transport/client-side. If it records CUDA/runtime/model errors or response write failures, the root cause moves into sidecar execution or serialization.

Alternative considered: add only client-side diagnostics. That cannot distinguish a sidecar exception from a dropped response without correlating request ids.

### Decision: use a bounded diagnostic matrix, not one large benchmark

The investigation SHALL run bounded variants on `examples/demo-do30-1c` that isolate one pressure variable at a time:

- worker count: `1`, `2`, and `4` BGE-M3 full workers;
- payload caps: current `20000/5000` and at least one smaller cap;
- full-mode output setting unchanged for acceptance, with any dense-only comparison marked diagnostic only;
- Qdrant insert behavior held constant so insert writes do not confound embedding failures.

Rationale: the symptom is sensitive to load and request shape. A matrix lets us see whether failures scale with concurrency, payload size, or full-mode sidecar cost.

Alternative considered: immediately lower worker count or payload caps. That may reduce the symptom but would not prove the underlying cause.

### Decision: classify before proposing a fix

This change SHALL end with a root-cause classification and evidence summary. If a code or configuration fix is warranted, it can be implemented here only if the fix is narrow and directly supported by evidence; otherwise it should be split into a follow-up change.

Rationale: previous indexing work already has multiple interacting controls. Guessing a scheduler or retry change risks hiding the failure and shifting the bottleneck.

## Risks / Trade-offs

- [Risk] More diagnostics can add overhead to hot embedding paths. -> Mitigation: keep diagnostics structured and compact, sample only failure details plus aggregate success timing, and make verbose request logging opt-in if needed.
- [Risk] Logs may accidentally capture source text. -> Mitigation: log only counts, sizes, ids, endpoint, timing, and sanitized errors.
- [Risk] A transient environment issue may not reproduce. -> Mitigation: preserve the exact Qdrant-run parameters and compare multiple bounded variants rather than relying on one pass.
- [Risk] Full sidecar logging may be noisy. -> Mitigation: record detailed fields in artifacts and keep regular status compact.
- [Risk] The root cause may be outside the TypeScript codebase, such as CUDA/runtime behavior. -> Mitigation: classify that explicitly and leave a follow-up operational or sidecar change with evidence.

## Migration Plan

No collection migration is required. Diagnostic fields are additive and affect future indexing runs only. Rollback is disabling the new diagnostic mode or reverting the additive logging changes; existing indexed data and retrieval behavior remain valid.

## Open Questions

- Does Node fetch expose a stable low-level cause on this runtime for the observed failures?
- Do sidecar logs show matching failed request ids, or do failed client requests disappear from Python as transport-level disconnects?
- Is failure frequency primarily driven by worker count, payload size, or full-mode output serialization?
- Should persistent diagnostic capture live in `measure-indexing-baseline.js`, a new focused script, or both?
