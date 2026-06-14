## Why

Recent Qdrant acceptance runs for `indexing-perf-08-write-coalescing-and-backpressure-tuning` showed zero failed vector inserts and no insert backlog, but the ten-minute window remained dominated by BGE-M3 embedding retries. The available evidence stops at `embedding_error fetch failed`, so we cannot yet distinguish transport resets, sidecar overload, CUDA/runtime pressure, request-size sensitivity, or client-side timeout behavior.

## What Changes

- Add diagnostic capture for BGE-M3 embedding request failures, including low-level fetch cause, worker endpoint, request shape, payload size, duration, retry attempt, and recovery outcome.
- Add sidecar-side evidence for `/embed_batch` failures and slow requests so Python/CUDA exceptions, cancellations, and response write failures are visible in artifacts.
- Add a reproducible investigation harness for `examples/demo-do30-1c` that can compare worker counts, payload caps, request concurrency, and full-mode output settings without changing retrieval semantics.
- Add acceptance evidence that identifies the dominant root cause category for `embedding_error fetch failed` before changing scheduler defaults.
- Non-goals:
  - Do not promote a new BGE-M3 worker count, payload cap, retry budget, or Qdrant insert default as part of this investigation change.
  - Do not change retrieval ranking or BGE-M3 dense/sparse/ColBERT output semantics.
  - Do not mask failures by silently ignoring embedding errors.
  - Do not require existing indexed collections to be rebuilt unless a later fix changes stored retrieval schema.

## Capabilities

### New Capabilities

- `bge-m3-fetch-failure-diagnostics`: Defines diagnostic evidence and root-cause classification for transient BGE-M3 embedding transport failures.

### Modified Capabilities

- `bge-worker-recovery`: Extends worker rejection and recovery diagnostics so transient fetch failures can be traced from failed embedding request through worker recovery and scheduler retry behavior.

## Impact

- Affected code:
  - `packages/core/src/embedding/bge-m3-embedding.ts`: failure classification, fetch cause capture, request metadata, worker rejection/recovery evidence.
  - `packages/core/src/indexing-accelerator.ts`: retry-pressure summaries and diagnostic fields exposed in accelerator snapshots.
  - `packages/mcp/src/handlers.ts` and worker-planning status formatting if compact status needs clearer failure attribution.
  - `python/bge_m3_sidecar.py`: structured logging around `/embed_batch` request duration, failures, cancellations, and output write errors.
  - `scripts/measure-indexing-baseline.js` or a focused diagnostic script: reproducible run artifacts for BGE-M3 fetch failure investigation.
- API impact:
  - Existing `index_codebase` and `search_code` request shapes remain unchanged.
  - Diagnostic fields may be added to structured indexing status and benchmark artifacts.
- Migration impact:
  - No collection migration is required.
  - Existing indexed collections remain valid.
