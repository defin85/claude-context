# Upstream Master Merge Plan

Status: draft  
Date: 2026-04-15  
Local branch: `feature/mcp-snapshot-async-workspace` @ `7a70b6e`  
Upstream target: `origin/master` @ `d144caf`  
Merge-base: `2484ae2`

## Purpose

This document describes how to integrate the current upstream `zilliztech/claude-context` `master` branch into the local snapshot/workspace branch without losing local architectural work.

Current divergence:

- local branch is `ahead 2 / behind 9` relative to `origin/master`;
- the worktree is dirty in the same hotspot files that upstream also changed;
- the overlapping areas are `packages/mcp/src/handlers.ts`, `packages/mcp/src/snapshot.ts`, `packages/core/src/context.ts`, `packages/core/src/vectordb/*`, `packages/mcp/src/utils.ts`, and `packages/mcp/src/config.ts`.

## Goal

Adopt the upstream bugfixes that already landed in `master` while preserving the local branch direction:

- workspace-scoped snapshot persistence;
- async snapshot saves with locking/debouncing;
- canonical codebase path normalization;
- richer index statistics recovery;
- the local architectural plan for per-codebase isolation and shared-runtime work.

## Locked Decisions

- Do not merge directly on top of the current dirty worktree.
- Rebase onto `origin/master`; do not try to re-implement upstream fixes manually from memory.
- Use upstream `master` as the base truth for already-shipped bugfixes.
- Preserve the local workspace-scoped and async snapshot model where it is strictly stronger than upstream.
- Do not start daemon/shared-runtime implementation during this merge pass.

## Upstream Changes To Absorb

### 1. `03a83a1`

`fix: empty filter query and cloud sync deletion bugs (#279, #251) (#280)`

Must absorb:

- empty-string filter fix in both Milvus clients;
- collection description support for storing `codebasePath`;
- cloud sync safety guards when extraction fails or the cloud result is empty.

Primary files:

- `packages/core/src/vectordb/milvus-vectordb.ts`
- `packages/core/src/vectordb/milvus-restful-vectordb.ts`
- `packages/core/src/vectordb/types.ts`
- `packages/core/src/context.ts`
- `packages/mcp/src/handlers.ts`

### 2. `7255be0`

`fix: detect lost collection and return error instead of empty results on search (#281)`

Must absorb:

- if snapshot says indexed but the Milvus collection is gone, search must fail explicitly instead of returning a misleading empty result set.

Primary file:

- `packages/mcp/src/handlers.ts`

### 3. `76497e1`

`fix: snapshot merge and indexing stuck issues (#276) (#282)`

Must absorb conceptually:

- force reindex may clear stale `indexing` state;
- interrupted indexing on startup is converted to `indexfailed`.

Primary files:

- `packages/mcp/src/handlers.ts`
- `packages/mcp/src/snapshot.ts`

### 4. `3ed9375`

`fix: search_code returns not indexed even when VectorDB has data (#226) (#283)`

Must absorb conceptually:

- remove/re-add resurrection guard in snapshot merge;
- VectorDB fallback and auto-repair when snapshot and index disagree;
- snapshot/stat recovery when search/status discover a valid index.

Primary files:

- `packages/mcp/src/handlers.ts`
- `packages/mcp/src/snapshot.ts`

### 5. Non-critical upstream changes

These should not drive conflict decisions during the first merge pass:

- version bumps to `0.1.5` and `0.1.6`;
- README and docs link fixes.

Accept them only after code conflicts are resolved cleanly.

## Recommended Merge Strategy

### Phase 0: Safety Snapshot

Because the worktree is dirty and overlaps with rebase targets, create a recoverable checkpoint before any history rewrite.

Recommended approach:

1. create a temporary safety branch from the current state;
2. create a local-only WIP commit for the dirty worktree;
3. rebase that safety branch onto `origin/master`;
4. only after conflict resolution, decide whether to squash/rewrite the WIP history.

Do not rely on `git stash` as the only backup for this merge.

## Merge Order

Resolve in this order so lower-level interfaces settle before MCP conflict resolution.

### Step 1. Vector DB interfaces and collection metadata

Files:

- `packages/core/src/vectordb/types.ts`
- `packages/core/src/vectordb/milvus-vectordb.ts`
- `packages/core/src/vectordb/milvus-restful-vectordb.ts`
- `packages/core/src/context.ts`

Resolution rule:

- take upstream `query()` behavior as the base;
- keep the upstream `getCollectionDescription()` interface and implementations;
- keep upstream collection description format `codebasePath:${codebasePath}`;
- preserve the local `normalizeCodebasePath()` usage in `Context` where it canonicalizes WSL UNC and absolute paths.

Acceptance:

- no Milvus client sends `""` as the filter expression for unfiltered queries;
- new collections carry `codebasePath` in description;
- local path normalization still affects collection naming and all index/search entrypoints.

### Step 2. MCP path normalization helpers and snapshot config types

Files:

- `packages/mcp/src/utils.ts`
- `packages/mcp/src/config.ts`

Resolution rule:

- keep the local exported `normalizeCodebasePath()` helper and its WSL UNC support;
- keep local optional indexed stats plus `statsState` in `CodebaseInfoIndexed`;
- ensure all merged MCP code paths call the shared normalizer instead of ad hoc `path.resolve()`.

Acceptance:

- path canonicalization is centralized;
- merged code compiles against the richer snapshot types.

### Step 3. `handlers.ts` as upstream-first base plus local extensions

File:

- `packages/mcp/src/handlers.ts`

Start from upstream semantics, then layer local stronger behavior on top.

Must preserve from upstream:

- cloud sync safety guards;
- collection-description-aware cloud extraction;
- lost-collection explicit search error;
- search fallback and mismatch auto-repair when VectorDB has data but snapshot is missing or stale.

Must preserve from local branch:

- awaited async snapshot saves with explicit save reasons;
- normalized codebase paths at MCP boundaries;
- recovery of indexed stats from Merkle snapshot plus `count(*)` query;
- stronger non-destructive local snapshot policy where cloud visibility is uncertain.

Must review carefully:

- `getTotalChunkCountFromCollection()` currently uses `query(collectionName, '', ['count(*)'])` locally.
  After merge, it must follow the upstream empty-filter fix and stop passing empty string.
- any place that still mutates global `Context` extensions/ignore patterns must be left intact only for this merge pass, but clearly marked as the next isolation hotspot.

Acceptance:

- no upstream search/sync safety fix is lost;
- local stats recovery remains available;
- no merged handler path depends on empty-string Milvus filters.

### Step 4. `snapshot.ts` as local-first base plus selected upstream semantics

File:

- `packages/mcp/src/snapshot.ts`

Use the local workspace-scoped async/locked snapshot implementation as the base model.

Port or preserve conceptually from upstream:

- interrupted `indexing` becomes `indexfailed` on startup;
- explicit delete must not be re-added by subsequent merge/save operations;
- snapshot auto-repair must not silently recreate intentionally removed entries.

Port or preserve from local branch:

- workspace-scoped snapshot path resolution and legacy migration;
- async save queue and debounce;
- file lock acquisition with stale lock cleanup;
- `pendingDeletes`/timestamp-based delete semantics;
- canonical path normalization inside snapshot logic.

Conflict rule:

- do not replace the local workspace-scoped async implementation with upstream’s older global synchronous snapshot model;
- instead, manually integrate the upstream bugfix intent into the local implementation.

Acceptance:

- workspace scope remains intact;
- delete resurrection remains impossible;
- startup does not leave stale `indexing` entries blocking future work;
- no unconditional `post-load-migration` save remains unless something truly changed.

### Step 5. `sync.ts`

File:

- `packages/mcp/src/sync.ts`

Keep the local debug/awaited save behavior, then verify it still matches the merged snapshot API and handler repair model.

Acceptance:

- background sync still runs with the merged snapshot manager;
- sync metadata refresh does not reintroduce stale snapshot writes;
- logs are still useful for diagnosing skip reasons and collection-loss scenarios.

### Step 6. Secondary files and release noise

Files:

- package version bumps
- README/doc link changes
- local docs under `docs/plans`
- local helper scripts such as `scripts/build-local-mcp.sh`

Resolution rule:

- accept upstream release/docs changes after code conflicts are resolved;
- keep local planning docs and helper scripts;
- do not let documentation conflicts block code integration.

## Conflict Matrix

### `packages/core/src/context.ts`

Keep both:

- upstream collection description for `codebasePath`;
- local codebase path normalization before collection-name generation and public index/search operations.

### `packages/mcp/src/handlers.ts`

Upstream wins for:

- Milvus empty-filter safety;
- lost-collection detection;
- cloud extraction guards and repair triggers.

Local wins for:

- async save reasons;
- richer stats recovery;
- normalized path canonicalization;
- non-destructive snapshot policy when cloud data is ambiguous.

### `packages/mcp/src/snapshot.ts`

Local wins for overall architecture:

- workspace scope;
- async save queue;
- file locking;
- normalized paths.

Upstream bugfix intent must be ported manually:

- interrupted `indexing` reset;
- explicit delete not being re-added;
- startup stuck-index cleanup.

### `packages/core/src/vectordb/*`

Upstream wins almost entirely.

Local branch should only reapply additional behavior if it does not revert:

- omitted-filter query behavior;
- collection description support;
- new interface methods.

## Verification Plan

### Targeted build checks

- `pnpm --filter @zilliz/claude-context-core typecheck`
- `pnpm --filter @zilliz/claude-context-core build`
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
- `pnpm --filter @zilliz/claude-context-mcp build`

### Broader checks

- `pnpm typecheck`
- `pnpm build`

### Manual regression checks

1. Search fallback:
   local snapshot missing, VectorDB index present -> search succeeds and repairs snapshot.
2. Lost collection:
   snapshot says indexed, collection missing -> search returns explicit error, not empty results.
3. Force reindex after stale indexing:
   interrupted `indexing` state does not block `force=true`.
4. Delete resurrection:
   remove a codebase, then trigger unrelated save from another process -> codebase is not re-added.
5. Workspace migration:
   legacy snapshot entries that are valid for the workspace survive migration.
6. Local Milvus empty-filter case:
   unfiltered metadata/count queries still work after merge.

## Stop Conditions

Pause the merge and re-evaluate if any of the following happen:

- rebase tries to replace the local workspace-scoped snapshot with the upstream global snapshot model;
- merged `handlers.ts` loses the upstream empty-filter or lost-collection fixes;
- merged `snapshot.ts` still performs unconditional startup rewrites;
- multi-root VS Code issues begin to leak into the merge scope and threaten to turn this into a broader refactor.

## Post-Merge Follow-Up

After the code merge is stable:

1. re-run the architecture plan in `docs/plans/unified-mcp-stability-and-shared-service-plan.md` against the merged codebase;
2. update the architectural plan if upstream changed the implementation baseline materially;
3. only then continue with per-codebase state isolation and the remaining Phase 1/2 work.

## References

- Upstream compare view:
  - `https://github.com/zilliztech/claude-context/compare/2484ae29b3a9c92815f1524cbb9924b3e241ec17...d144caf64ea2c183834ee3614a1248238fcb5c53`
- Upstream commits:
  - `03a83a1897e8e997824667ea10d6b8245beb16f1`
  - `7255be0039628cf978078750dcacf8760289024f`
  - `76497e1f78192c6f758ead3445fcff4b2453e92c`
  - `3ed9375e5a9bf09f751eeca19d8e4c3e31188864`
