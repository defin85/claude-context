## Why

Interrupted initial indexing currently leaves operators with an unsafe choice: start over and rewrite already inserted chunks, or continue with ambiguous partial state. This is especially costly for large repositories and 1C exports where embedding and vector insertion can run for hours.

The indexer needs to decide the correct mode itself: full initial indexing for a new or incompatible target, manifest-backed initial resume for a compatible interrupted run, or ordinary change indexing when a completed index already exists.

## What Changes

- Add durable manifest-backed initial indexing state keyed by codebase path, effective indexing configuration, vector collection/schema identity, embedding profile, retrieval mode, and 1C scope profile when present.
- Add an indexing mode decision step before `index_codebase` work starts:
  - `initial_full`: no usable completed index or compatible resume manifest exists.
  - `initial_resume`: the previous initial run was interrupted or failed and has a compatible manifest with confirmed inserted document identifiers.
  - `incremental_changes`: a compatible completed index and synchronizer snapshot exist, so normal changed-file indexing applies.
  - `incompatible_requires_reindex`: persisted state exists but profile/schema/configuration no longer matches.
- Make initial resume skip chunks whose stable document identifiers were confirmed after successful vector insertion, and process only missing or unconfirmed chunks.
- Track batch state through planning, embedding, insertion, confirmed insertion, failure, and cancellation without treating queued or in-flight work as durable success.
- Surface the selected indexing mode, resume eligibility, manifest compatibility, and remaining work through indexing status and completion output.
- Require the behavior to work for all indexing profiles and repository shapes, including dense, hybrid, BGE-M3 full, regular source repositories, and all 1C indexing scope profiles (`full`, `developer`, `minimal`, `v8unpack`).
- Keep existing retrieval ranking and vector schema behavior unchanged.

Non-goals:

- Do not implement vector-backend-wide reconciliation of arbitrary legacy partial indexes without a compatible manifest.
- Do not change search ranking, chunk splitting semantics, or document metadata fields except where a stable identifier bug must be fixed to make resume safe.
- Do not support two daemon processes concurrently indexing the same codebase and collection.
- Do not silently reuse an interrupted run after incompatible profile, embedding, schema, or scope changes.

## Capabilities

### New Capabilities

- `resumable-initial-indexing`: Manifest-backed automatic selection between full initial indexing, initial resume, and ordinary change indexing.

### Modified Capabilities

- None. The new capability depends on existing accelerated indexing, vector insert containment, and 1C scope profile contracts, but does not change their standalone requirements.

## Impact

- `packages/core`: indexing coordinator, synchronizer integration, accelerator runtime, vector insertion adapters, manifest persistence, and status types.
- `packages/mcp`: `index_codebase` mode reporting, `get_indexing_status` fields, and operator-facing error messages.
- Tests: unit coverage for mode selection, manifest compatibility, interrupted initial resume, insert ambiguity, all 1C scope profiles, and accelerated/non-accelerated paths.
- Documentation: operator notes for interpreting `initial_full`, `initial_resume`, `incremental_changes`, and incompatible-state outcomes.
- Migration impact: existing completed indexes remain usable and should continue through ordinary change indexing. Failed or interrupted indexes created before this change do not have a trusted manifest, so they cannot be safely resumed as `initial_resume`; the system must report that a new full initial reindex is required unless a compatible manifest is present.
