## Context

Milvus standalone stores object data under the MinIO volume. The largest local paths are implementation details such as `wp`, `insert_log`, and `index_files`; they are not safe ownership boundaries for manual deletion. The product-level ownership boundary is the Milvus collection and its association with a codebase path and retrieval schema.

The existing system has `clear_index`, snapshot state, per-codebase config, and collection descriptions. A storage cleanup design must keep these layers consistent.

## Goals / Non-Goals

**Goals:**

- Explain local Milvus disk usage by collection and codebase.
- Identify stale/orphaned collections and failed-run leftovers.
- Provide dry-run-first reclaim operations.
- Ensure cleanup uses Milvus/vector DB APIs and updates daemon snapshot/config state coherently.
- Record before/after evidence for disk usage and collection inventory.

**Non-Goals:**

- No direct filesystem deletion inside Milvus/MinIO volumes.
- No automatic cleanup on daemon startup in the first version.
- No ranking or retrieval schema changes.
- No promise that disk is reclaimed immediately if Milvus keeps deleted objects until compaction/GC.

## Decisions

### Decision: audit by collection ownership, not MinIO paths

The audit SHALL query Milvus collections and metadata first. Filesystem size under MinIO MAY be reported as aggregate evidence, but cleanup decisions SHALL be based on collection ownership and snapshot state.

### Decision: dry-run is mandatory for reclaim

Any reclaim operation SHALL have a dry-run mode that reports collections, codebase paths, snapshot entries, expected actions, and risks before mutation.

### Decision: use existing clear semantics where possible

For a known codebase, reclaim SHOULD reuse or extend `clear_index` so collection drops and snapshot/config cleanup stay consistent. A broader maintenance command MAY handle orphaned collections that are not attached to current snapshot state.

### Decision: separate stale snapshot cleanup from vector storage cleanup

Runtime registry snapshots and daemon metadata are small and should not be conflated with Milvus object-store cleanup. The audit SHALL distinguish snapshot-only stale state from storage-heavy collections.

### Decision: report BGE-M3 full storage drivers

Reports SHALL identify retrieval mode/schema and, when available, profile and ColBERT storage settings. This helps explain why BGE-M3 full/multivector indexes consume far more disk.

## Risks / Trade-offs

- Milvus may not expose precise per-collection object-store size through public APIs; local filesystem estimates may be approximate.
- Dropping a collection is destructive for that codebase index and requires reindexing.
- Disk may not be freed immediately if Milvus/MinIO retains temporary, compaction, or garbage-collection artifacts.
- Orphan detection can be risky when multiple daemon instances or worktrees share one Milvus; require explicit allow roots and confirmation.

## Migration Plan

No data migration. The audit is additive. Reclaim operations only affect collections selected by explicit operator action.

Rollout:

1. Add read-only collection inventory and local storage summary.
2. Add dry-run reclaim plan for known codebase paths.
3. Add mutation path using `clear_index`/collection drop with snapshot/config cleanup.
4. Add orphan detection and guarded reclaim after inventory is reliable.

Rollback:

- Disable or avoid maintenance commands.
- Reindex any codebase whose collection was intentionally dropped.
