## Why

Local Milvus storage can grow very quickly under BGE-M3 full retrieval because each indexed chunk can store dense vectors, sparse weights, and ColBERT token-vector payload. On this workstation, `~/.local/share/claude-context/milvus/volumes` reached roughly `146GB`, dominated by MinIO object-store paths:

- `a-bucket/files/wp`: about `96GB`
- `a-bucket/files/insert_log`: about `43GB`
- `a-bucket/files/index_files`: about `7GB`

Operators need to answer which codebases, collections, retrieval profiles, and indexing runs own that storage before deleting anything. Manual deletion inside MinIO/Milvus volumes is unsafe because it can corrupt Milvus metadata.

## What Changes

- Add a local Milvus storage audit command/report that maps Milvus collections to codebase paths, retrieval schema/profile, row counts, and approximate storage contribution where available.
- Add safe reclaim workflows for stale, failed, superseded, and explicitly cleared codebase indexes using Milvus/vector database APIs rather than filesystem deletes.
- Extend `clear_index` semantics or add a maintenance tool so snapshot state, codebase config, and Milvus collections remain consistent after cleanup.
- Add operator documentation for local Milvus disk usage, BGE-M3 full storage cost, and safe cleanup steps.
- Add verification artifacts showing before/after disk usage and Milvus collection state.

Non-goals:

- Do not delete files directly from `~/.local/share/claude-context/milvus/volumes`.
- Do not silently garbage-collect indexed codebases without explicit operator approval.
- Do not change retrieval ranking or storage schema as part of cleanup.
- Do not require Zilliz Cloud maintenance features for local Milvus.

## Capabilities

### New Capabilities

- `local-milvus-storage-audit`: Covers local Milvus storage diagnosis, collection ownership mapping, safe reclaim, orphan detection, and operator guidance.

### Modified Capabilities

- `retrieval-performance-profiles`: Storage reports SHOULD include retrieval profile/schema once profile persistence exists.
- `1c-indexing-scope-profiles`: Storage reports SHOULD include scope profile once scope persistence exists.

## Impact

- Affected code:
  - `packages/core`: vector database inspection/drop helpers, Milvus collection metadata helpers, tests.
  - `packages/mcp`: `clear_index`, optional new maintenance/audit MCP tool, daemon status or CLI wiring.
  - `scripts`: local storage audit/reclaim helper for benchmark and operator workflows.
  - `docs`: troubleshooting and environment docs for local Milvus storage.
- Runtime impact:
  - Safe cleanup may drop Milvus collections and free storage after Milvus/MinIO compaction or object cleanup.
  - Audit may query Milvus metadata and local filesystem sizes but MUST NOT mutate storage in dry-run mode.
- Migration impact:
  - Existing collections remain valid. Cleanup requires explicit operator action.
