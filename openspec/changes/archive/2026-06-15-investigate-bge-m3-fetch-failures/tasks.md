## 1. Evidence Baseline

- [x] 1.1 Preserve the current `indexing-perf-08` Qdrant run evidence as the baseline for `embedding_error fetch failed`, including retry counts, worker recovery counts, payload limits, worker count, and journal excerpts.
- [x] 1.2 Identify the current client-side fetch path in `packages/core/src/embedding/bge-m3-embedding.ts` and document which error fields are currently lost.
- [x] 1.3 Identify the current sidecar `/embed_batch` logging path in `python/bge_m3_sidecar.py` and document which request outcome fields are currently unavailable.

## 2. Client-Side Diagnostics

- [x] 2.1 Add sanitized request-shape metadata to BGE-M3 embedding request failure handling: logical batch id when available, chunk count, content-character count, estimated-token count, retrieval mode, and payload limits.
- [x] 2.2 Capture normalized Node fetch failure cause fields: error name/message, cause name/code/message, timeout or cancellation state, worker endpoint, request duration, retry attempt, and retry-safe flag.
- [x] 2.3 Preserve worker rejection and recovery behavior while linking each rejection to the failed request evidence that caused it.
- [x] 2.4 Add unit tests for failure cause normalization without logging raw source text, credentials, or embedding vectors.

## 3. Sidecar Diagnostics

- [x] 3.1 Add structured sidecar request ids for `/embed_batch` and include them in success and failure evidence.
- [x] 3.2 Add sidecar request timing and sanitized request-shape logging for successful `/embed_batch` calls.
- [x] 3.3 Add sidecar failure logging with failure phase, exception class, sanitized message, duration, and request id.
- [x] 3.4 Add Python-side tests or a focused smoke script proving sidecar diagnostics omit raw source text and embedding vectors.

## 4. Status and Artifact Reporting

- [x] 4.1 Extend accelerator retry summaries to distinguish fetch failures from timeouts, cancellations, metadata failures, startup failures, and unknown embedding errors.
- [x] 4.2 Expose per-worker rejection counts, recovery attempts, last failed request reference, and aggregate failure categories in structured status.
- [x] 4.3 Update benchmark or diagnostic artifact output to summarize failure cause counts by client cause, sidecar phase, worker endpoint, payload-size bucket, retry-safe status, and recovery outcome.
- [x] 4.4 Keep compact user-facing status readable and avoid printing secret or raw payload fields.

## 5. Diagnostic Matrix

- [x] 5.1 Run a bounded full BGE-M3 diagnostic on `examples/demo-do30-1c` with one worker, current payload caps `20000/5000`, and fixed vector backend settings.
- [x] 5.2 Run a bounded full BGE-M3 diagnostic on `examples/demo-do30-1c` with two workers, current payload caps `20000/5000`, and fixed vector backend settings.
- [x] 5.3 Run a bounded full BGE-M3 diagnostic on `examples/demo-do30-1c` with four workers, current payload caps `20000/5000`, and fixed vector backend settings.
- [x] 5.4 Run at least one smaller-payload diagnostic while holding worker count and vector backend constant.
- [x] 5.5 If dense-only BGE-M3 is used as a control, mark it diagnostic only and do not use it as acceptance evidence for full dense+sparse+ColBERT indexing.

## 6. Root-Cause Classification

- [x] 6.1 Compare diagnostic artifacts and classify the dominant cause category: client transport reset, sidecar exception, CUDA/runtime pressure, response serialization/write failure, request-size pressure, worker-count pressure, timeout/cancellation path, or unknown.
- [x] 6.2 Record evidence for any rejected hypothesis, especially Qdrant insert pressure, insert backlog, worker startup failure, and metadata mismatch.
- [x] 6.3 Decide whether a narrow fix belongs in this change or whether the evidence requires a separate follow-up change.
- [x] 6.4 If no cause is proven, document exactly what missing evidence prevented classification and leave tuning defaults unchanged.

## 7. Verification

- [x] 7.1 Run focused TypeScript tests for BGE-M3 failure classification, worker recovery diagnostics, and accelerator status summaries.
- [x] 7.2 Run focused sidecar diagnostics tests or smoke checks.
- [x] 7.3 Run `pnpm --filter @zilliz/claude-context-core typecheck`.
- [x] 7.4 Run `pnpm exec openspec validate investigate-bge-m3-fetch-failures --strict`.
- [x] 7.5 Write `verification.md` with commands, artifact paths, root-cause classification, residual risks, and whether follow-up implementation is required.
