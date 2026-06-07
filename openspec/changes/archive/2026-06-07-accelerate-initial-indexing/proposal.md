## Why

Large initial and force indexing runs can take many hours even when the host has unused RAM, VRAM, and GPU capacity. The current indexing pipeline processes chunk batches sequentially, so BGE-M3 full retrieval often leaves acceleration headroom unused while users wait for a codebase to become searchable.

## What Changes

- Add a default-safe acceleration mode for primary and force indexing jobs.
- Introduce bounded intra-codebase batch parallelism so multiple embedding batches can be in flight without changing index contents.
- Add an adaptive BGE-M3 worker pool that can launch additional identical local sidecars when resource budgets allow.
- Gate acceleration by resource policy, health checks, and automatic fallback to the existing single-worker path.
- Keep background sync and incremental reindexing conservative by default.
- Preserve stable chunk identifiers, retrieval schema metadata, and search behavior.

Non-goals:

- Do not change BGE-M3 ranking semantics, ColBERT reranking, or search result scoring.
- Do not introduce multi-model indexing for a single codebase.
- Do not require users to run accelerated indexing; the existing single-worker behavior remains available.
- Do not change existing collection data in place without an explicit reindex.

## Capabilities

### New Capabilities

- `accelerated-indexing`: Covers resource-aware acceleration for initial and force indexing, including parallel batch scheduling, optional BGE-M3 worker pools, fallback behavior, and operational visibility.

### Modified Capabilities

- None.

## Impact

- Affected code:
  - `packages/core`: indexing pipeline, embedding batching, BGE-M3 embedding client, progress accounting, tests.
  - `packages/mcp`: `index_codebase` scheduling context, daemon status reporting, environment/config parsing if acceleration is daemon-scoped.
  - `python`: BGE-M3 sidecar startup compatibility and metadata/health validation if workers are launched by the Node process.
- Affected runtime systems:
  - Local BGE-M3 sidecars on loopback ports.
  - Milvus insert throughput and collection write ordering.
  - Daemon workload status and cancellation.
- New configuration may include accelerator mode, maximum workers, VRAM budget, embedding batch concurrency, and background-sync acceleration policy.
- Existing indexed collections require no migration. Accelerated indexing applies to new initial/force indexing runs and produces the same retrieval schema for the same embedding profile.
