## 1. Evidence Baseline

- [ ] 1.1 Preserve the current `indexing-perf-08` Qdrant run evidence as the baseline for `embedding_error fetch failed`, including retry counts, worker recovery counts, payload limits, worker count, and journal excerpts.
- [ ] 1.2 Identify the current client-side fetch path in `packages/core/src/embedding/bge-m3-embedding.ts` and document which error fields are currently lost.
- [ ] 1.3 Identify the current sidecar `/embed_batch` logging path in `python/bge_m3_sidecar.py` and document which request outcome fields are currently unavailable.

## 2. Client-Side Diagnostics

- [ ] 2.1 Add sanitized request-shape metadata to BGE-M3 embedding request failure handling: logical batch id when available, chunk count, content-character count, estimated-token count, retrieval mode, and payload limits.
- [ ] 2.2 Capture normalized Node fetch failure cause fields: error name/message, cause name/code/message, timeout or cancellation state, worker endpoint, request duration, retry attempt, and retry-safe flag.
- [ ] 2.3 Preserve worker rejection and recovery behavior while linking each rejection to the failed request evidence that caused it.
- [ ] 2.4 Add unit tests for failure cause normalization without logging raw source text, credentials, or embedding vectors.

## 3. Sidecar Diagnostics

- [ ] 3.1 Add structured sidecar request ids for `/embed_batch` and include them in success and failure evidence.
- [ ] 3.2 Add sidecar request timing and sanitized request-shape logging for successful `/embed_batch` calls.
- [ ] 3.3 Add sidecar failure logging with failure phase, exception class, sanitized message, duration, and request id.
- [ ] 3.4 Add Python-side tests or a focused smoke script proving sidecar diagnostics omit raw source text and embedding vectors.

## 4. Status and Artifact Reporting

- [ ] 4.1 Extend accelerator retry summaries to distinguish fetch failures from timeouts, cancellations, metadata failures, startup failures, and unknown embedding errors.
- [ ] 4.2 Expose per-worker rejection counts, recovery attempts, last failed request reference, and aggregate failure categories in structured status.
- [ ] 4.3 Update benchmark or diagnostic artifact output to summarize failure cause counts by client cause, sidecar phase, worker endpoint, payload-size bucket, retry-safe status, and recovery outcome.
- [ ] 4.4 Keep compact user-facing status readable and avoid printing secret or raw payload fields.

## 5. Diagnostic Matrix

- [ ] 5.1 Run a bounded full BGE-M3 diagnostic on `examples/demo-do30-1c` with one worker, current payload caps `20000/5000`, and fixed vector backend settings.
- [ ] 5.2 Run a bounded full BGE-M3 diagnostic on `examples/demo-do30-1c` with two workers, current payload caps `20000/5000`, and fixed vector backend settings.
- [ ] 5.3 Run a bounded full BGE-M3 diagnostic on `examples/demo-do30-1c` with four workers, current payload caps `20000/5000`, and fixed vector backend settings.
- [ ] 5.4 Run at least one smaller-payload diagnostic while holding worker count and vector backend constant.
- [ ] 5.5 If dense-only BGE-M3 is used as a control, mark it diagnostic only and do not use it as acceptance evidence for full dense+sparse+ColBERT indexing.

## 6. Root-Cause Classification

- [ ] 6.1 Compare diagnostic artifacts and classify the dominant cause category: client transport reset, sidecar exception, CUDA/runtime pressure, response serialization/write failure, request-size pressure, worker-count pressure, timeout/cancellation path, or unknown.
- [ ] 6.2 Record evidence for any rejected hypothesis, especially Qdrant insert pressure, insert backlog, worker startup failure, and metadata mismatch.
- [ ] 6.3 Decide whether a narrow fix belongs in this change or whether the evidence requires a separate follow-up change.
- [ ] 6.4 If no cause is proven, document exactly what missing evidence prevented classification and leave tuning defaults unchanged.

## 7. Verification

- [ ] 7.1 Run focused TypeScript tests for BGE-M3 failure classification, worker recovery diagnostics, and accelerator status summaries.
- [ ] 7.2 Run focused sidecar diagnostics tests or smoke checks.
- [ ] 7.3 Run `pnpm --filter @zilliz/claude-context-core typecheck`.
- [ ] 7.4 Run `pnpm exec openspec validate investigate-bge-m3-fetch-failures --strict`.
- [ ] 7.5 Write `verification.md` with commands, artifact paths, root-cause classification, residual risks, and whether follow-up implementation is required.
