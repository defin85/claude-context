## Why

Batch sizing is currently based on chunk count, but BGE-M3 full embedding payloads can exceed Node/V8 string limits when a chunk-count batch contains large text and ColBERT response data. Recent `indexing-perf-04` benchmark artifacts showed `Cannot create a string longer than 0x1fffffe8 characters` on the embedding stage for `100/100` and `200/100` candidates, while smaller batches avoided the failure on the small benchmark.

## What Changes

- Add payload-aware embedding batch boundaries using content character and estimated token limits in addition to chunk count.
- Add a fail-safe embedding retry path that splits payload-size failures into smaller embedding sub-batches while preserving result order.
- Surface payload-pressure metrics in accelerator status and benchmark artifacts.
- Keep chunk splitting semantics and document identity unchanged.
- Keep current defaults unless benchmark evidence justifies a profile-specific default change.

Non-goals:

- Do not change splitter output or chunk boundaries.
- Do not change vector insert batching except as needed to preserve the existing insert stage after embedding sub-batch retries.
- Do not introduce a new BGE-M3 sidecar protocol in this change.
- Do not claim a throughput improvement from bounded or failed benchmark runs.

## Capabilities

### New Capabilities

- `payload-safe-embedding-batches`: Covers payload-aware embedding batch limits, payload-size retry splitting, diagnostics, and benchmark evidence.

### Modified Capabilities

- `embedding-batch-scheduling`: Embedding batches must be bounded by payload-risk limits, not only chunk count, and must recover from payload-size embedding failures when smaller sub-batches are safe.

## Impact

- Affected code:
  - `packages/core`: embedding batch construction, BGE-M3/full embedding retry, accelerator batch metadata, tests.
  - `packages/mcp`: status/help exposure if new config or status fields are surfaced.
  - `scripts/measure-indexing-baseline.js`: payload-risk metrics in samples and summaries.
  - `docs`: environment variables and operational guidance for BGE-M3 full batch sizing.
- Runtime impact:
  - Fewer fatal indexing failures from oversized embedding JSON/string payloads.
  - Potentially more embedding requests when payload-aware limits split large chunk-count batches.
- Migration impact:
  - No indexed collection migration. The change affects future indexing runs only.
