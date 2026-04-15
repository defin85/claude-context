# Unified MCP Stability and Shared Service Plan

Status: draft  
Date: 2026-04-15  
Scope: `packages/mcp`, `packages/core`, `packages/vscode-extension`, `docs`

Based on:

- `PR274_FIX_PLAN.md`
- `TODO.md`
- `docs/plans/shared-multi-repo-mcp-service-plan.md`

## Purpose

This document merges three parallel planning threads into one execution order:

1. correctness fixes required before PR #274 can be reviewed again;
2. incremental sync reliability work currently tracked in `TODO.md`;
3. the longer-term shared multi-repo MCP service rollout.

The main decision is sequencing: do not expand the runtime model before snapshot semantics, indexing ownership, and per-codebase mutable state are correct.

## Executive Summary

Current issues cluster into three shared failure domains:

1. snapshot consistency under concurrent processes;
2. repository isolation for indexing and background sync behavior;
3. runtime/transport architecture for one shared local service.

These are not independent workstreams. The same root causes appear in all three source documents:

- stale snapshot state can overwrite newer truth;
- `indexing` ownership is not enforced across processes;
- repository-specific mutable state still leaks through process-global `Context`;
- background sync lacks enough diagnostics and self-healing;
- a shared daemon would amplify these bugs instead of solving them.

Recommended execution order:

1. diagnostics and observability baseline;
2. snapshot correctness and cross-process ownership;
3. per-codebase state isolation and incremental sync hardening;
4. shared daemon mode;
5. compatibility bridge and operational hardening.

## Constraints and Decisions

- Correctness before architecture expansion.
- Deletion must win over stale in-memory copies from another process.
- Only one live MCP owner may hold `indexing` for a given codebase at a time.
- Migration must not silently lose valid indexed absolute paths.
- Repository-specific ignore rules and custom extensions must not leak across codebases.
- Do not ship a shared multi-repo runtime before per-codebase mutable state is isolated.
- Keep collection-per-codebase storage semantics in the near term.
- Preserve STDIO compatibility during rollout instead of making daemon mode a prerequisite.
- Runtime status files are observability artifacts, not the source of truth for correctness decisions such as index ownership.
- Start daemon mode as stateless-first for tool calls; introduce server-side session state only when notifications, resume, or other MCP semantics require it.

## Architecture Contracts

### 1. Ownership Authority

- Snapshot persistence is the source of truth for cross-process `indexing` ownership.
- Runtime registry files are diagnostic only and must never be used as the authoritative lock.
- Ownership acquisition, heartbeat refresh, stale-owner recovery, and ownership release must all happen through snapshot-controlled writes.

### 2. Per-Codebase Session Durability

- `CodebaseSession` is split into:
  - runtime state that may be recreated in memory;
  - persisted per-codebase sync configuration that survives restart.
- Persisted configuration must include any setting that changes indexing or incremental sync behavior, at minimum:
  - custom ignore patterns;
  - custom extensions;
  - future per-codebase indexing options.
- If persisted per-codebase sync configuration is unavailable after restart, the runtime must not silently continue with different semantics. It must either recover the same effective configuration or surface an explicit degraded state that requires reindex.

### 3. Path Governance

- Daemon mode must not accept arbitrary absolute paths merely because they are local.
- Indexing and search operations must be constrained by client-approved roots or another explicit local allowlist model.
- VS Code and other clients must preserve the actual indexed codebase identity instead of inferring it from workspace order.

### 4. Cloud Recovery Boundary

- Cloud/vector DB state may be used to recover index presence and recoverable statistics.
- Cloud/vector DB state is not the source of truth for repository-specific sync configuration.
- Self-heal must not reconstruct ignore patterns, custom extensions, or other repo-specific behavior from cloud metadata heuristics.

## Phase 0: Diagnostics and Observability Baseline

Goal: make current failures observable before changing behavior.

### Work items

- Confirm that background sync actually runs in MCP and capture current failure modes:
  - `startBackgroundSync()` is called;
  - `handleSyncIndex()` runs periodically;
  - repeated `No codebases indexed. Skipping sync.` is explained, not treated as noise.
- Verify workspace snapshot state end-to-end:
  - file exists at `~/.context/mcp/<workspace-hash>/mcp-codebase-snapshot.json`;
  - target codebase is present as a normalized absolute path;
  - JSON is valid and status is `indexed` when expected.
- Add explicit sync diagnostics:
  - log skip reason per codebase;
  - log change-set sizes (`added`, `removed`, `modified`) before and after processing.
- Add minimal runtime observability from the shared-service plan:
  - runtime status file such as `~/.context/mcp/runtime/<pid>.json`;
  - process metadata that lets operators map process -> runtime -> known codebases.
- Keep observability and correctness separate:
  - runtime status files may be stale after crashes and must not be used as the authoritative lock for `indexing`;
  - correctness must continue to come from snapshot state and explicit ownership metadata.

### Exit criteria

- Operators can explain why sync ran, skipped, or failed for a codebase without reading code.
- Operators can identify which process/runtime owns which repositories.

## Phase 1: Snapshot Correctness and Cross-Process Ownership

Goal: make snapshot persistence safe under concurrent MCP processes.

### Work items

- Fix stale-state resurrection after delete in `packages/mcp/src/snapshot.ts`.
- Replace the current read-merge-write behavior so stale local memory cannot recreate a deleted entry.
- Either persist delete tombstones durably enough for concurrent writers or reload authoritative state under lock before applying local mutations.
- Remove or narrow unconditional post-load migration saves so startup does not rewrite older data unless something changed.
- Restore cross-process `indexing` ownership:
  - persist owner metadata such as session id, pid, and heartbeat timestamp;
  - reject concurrent indexing when a live owner already exists;
  - define deterministic stale-owner recovery and logging.
- Extend the snapshot schema so `indexing` entries can carry ownership metadata explicitly instead of overloading plain status:
  - stable runtime identity;
  - pid;
  - client/session identity when available;
  - last heartbeat timestamp.
- Fix workspace migration semantics:
  - preserve supported absolute paths from legacy global snapshot files;
  - if any filtering is intentional, document it explicitly as a compatibility rule.
- Rebase this work on top of the upstream snapshot consistency direction already discussed around PR #283.

### Likely files

- `packages/mcp/src/snapshot.ts`
- `packages/mcp/src/handlers.ts`
- `packages/mcp/src/sync.ts`
- docs updates if migration behavior is documented

### Exit criteria

- Delete in process A cannot be resurrected by a later unrelated save from process B.
- A second MCP process refuses to start indexing the same codebase while a live owner exists.
- Stale ownership is recoverable deterministically.
- Valid indexed absolute paths survive migration unless a documented rule says otherwise.

### Verification

- Add focused automated tests for:
  - delete in process A + unrelated save in process B;
  - persisted `indexing` state blocking a second process;
  - stale owner recovery;
  - legacy snapshot migration preserving supported paths.
- Manual checks:
  - `pnpm --filter @zilliz/claude-context-mcp typecheck`
  - `pnpm --filter @zilliz/claude-context-mcp build`
  - multi-process repros for delete/save race, concurrent index start, and startup migration.

## Phase 2: Per-Codebase State Isolation and Incremental Sync Hardening

Goal: eliminate cross-repo state bleed and make incremental sync recoverable and debuggable.

### Work items

- Extract repository-specific mutable state out of global `Context` in `packages/core/src/context.ts`.
- Introduce a per-codebase state holder such as `CodebaseSession` that owns:
  - normalized `codebasePath`;
  - effective ignore patterns;
  - effective custom extensions;
  - `FileSynchronizer`;
  - indexing/sync status metadata.
- Persist the sync-relevant part of per-codebase session state across restarts:
  - custom extensions;
  - custom ignore patterns;
  - any future config that changes incremental sync semantics.
- Stop mutating shared process-wide indexing state from `handleIndexCodebase()`.
- Fix ignore-pattern leakage:
  - rebuild the baseline ignore set before loading project-level ignore data;
  - store and use the effective ignore configuration per codebase.
- Add snapshot self-healing for background sync:
  - if the local snapshot is empty or corrupted, attempt to recover indexed codebases from the authoritative cloud/index state;
  - do not require a later `search`, `status`, or `index` call to repair state.
- Define the recovery boundary clearly:
  - cloud/index state may restore index presence and recoverable statistics;
  - repository-specific sync configuration must come from persisted local session data, not be inferred from cloud metadata.
- Ensure path normalization is consistent across snapshot storage, sync, and handler entrypoints.
- Verify incremental sync handles:
  - file addition;
  - file modification;
  - file deletion with stale chunks removed.
- Fix VS Code multi-root behavior so all index-related operations target the same codebase that the user indexed instead of assuming `workspaceFolders[0]`:
  - sync;
  - search status checks;
  - open-file resolution from search results;
  - clear-index actions.
- Persist the selected/indexed codebase identity in extension state where needed so UI and background sync agree on the same target.

### Likely files

- `packages/core/src/context.ts`
- `packages/mcp/src/handlers.ts`
- `packages/mcp/src/sync.ts`
- `packages/mcp/src/snapshot.ts`
- relevant VS Code extension files

### Exit criteria

- Ignore patterns and custom extensions do not leak between codebases in one process.
- After snapshot corruption or loss, background sync can recover automatically without a manual full reindex.
- After restart, codebases indexed with custom ignore patterns or custom extensions still sync with the same effective configuration, or the runtime reports an explicit degraded state that requires reindex.
- After editing a file, search results update without `force reindex`.
- After MCP restart, incremental sync resumes automatically.
- Logs explain clearly why sync was executed, skipped, or repaired.
- Multi-root VS Code workspaces sync the intended indexed folder.

### Verification

- Add targeted regression tests for:
  - ignore-pattern isolation across codebases;
  - snapshot self-heal without manual intervention;
  - add/modify/delete incremental sync behavior;
  - multi-root workspace targeting.
- Manual checks on a real indexed repository:
  - change a file and confirm search reflects the update;
  - delete a file and confirm stale chunks disappear;
  - restart MCP and confirm automatic sync continues.

## Phase 3: Shared Multi-Repo Daemon Foundations

Goal: move from one-client-one-subprocess operation to one long-lived local runtime serving multiple repositories.

### Work items

- Add daemon runtime mode while keeping the existing STDIO mode.
- Use a local-only transport endpoint such as `127.0.0.1`.
- Prefer `Streamable HTTP` as the primary shared-service transport.
- Keep the first daemon iteration stateless for ordinary tool calls unless a concrete MCP workflow requires resumable server-side sessions.
- Define daemon access control explicitly instead of relying on localhost binding alone:
  - require a local authorization token or an OS-restricted IPC mechanism;
  - validate request origin/session according to MCP transport security guidance;
  - restrict indexing/search operations to client-approved roots or another explicit local allowlist model.
- Add a runtime registry backed by the observability work from Phase 0.
- Introduce explicit workload controls:
  - bounded indexing concurrency;
  - separate search concurrency limits;
  - job queue with repository identity;
  - optional repository priority and backoff.
- Define daemon-owned snapshot semantics:
  - runtime-global snapshot for daemon-managed codebases;
  - stable codebase identity based on normalized absolute path;
  - migration from workspace-scoped snapshots when practical.

### Exit criteria

- One daemon can serve multiple repositories on one machine.
- The daemon does not mix repository-specific sync/index behavior.
- Idle resource usage is lower than the current one-subprocess-per-repo model for a multi-repo workstation.

### Verification

- Run a multi-repo manual scenario with at least two repositories in one runtime:
  - one repo indexing while another is searchable;
  - bounded queueing instead of uncontrolled parallel indexing;
  - unauthorized or out-of-scope path requests rejected by policy.
- Verify daemon restart semantics:
  - runtime registry is recreated cleanly;
  - stale ownership is recovered correctly;
  - persisted per-codebase sync configuration is preserved or explicit degraded state is reported.

## Phase 4: Compatibility Layer and Operational Hardening

Goal: make shared mode usable in existing client setups and maintainable in daily operation.

### Work items

- Add a lightweight STDIO bridge/proxy that forwards MCP calls to the daemon.
- Add daemon discovery and fallback behavior when the daemon is absent.
- Add daemon compatibility/version handshake so incompatible bridge and daemon versions fail closed instead of issuing partially compatible tool calls.
- Add graceful stop/restart, stale runtime cleanup, and job cancellation.
- Harden lock recovery, snapshot recovery, and diagnostics for long-lived runtime operation.
- Document operational workflows:
  - list active runtimes;
  - list known repositories and active jobs;
  - stop one repository workload without guessing which process to kill.

### Exit criteria

- Existing STDIO-oriented clients can reuse the daemon without manual rewiring in the common case.
- Operators can inspect and manage shared runtime behavior without log spelunking.
- Shared mode is stable enough for daily development.

## Cross-Phase Dependencies

- Phase 1 depends on Phase 0 observability for reliable diagnosis and regression proof.
- Phase 2 depends on Phase 1 snapshot semantics; self-healing on top of unsafe persistence will be non-deterministic.
- Phase 3 depends on Phase 2 isolation; otherwise a shared runtime will amplify cross-repo state bleed.
- Phase 4 depends on Phase 3 runtime semantics being stable enough to proxy and administer.

## Entry Gates

### Gate For Phase 3

Do not begin daemon rollout until all of the following are true:

- multi-process ownership tests pass;
- delete resurrection regression tests pass;
- per-codebase ignore and extension isolation is implemented and covered by tests;
- restart after snapshot loss/corruption preserves sync semantics or reports explicit degraded state;
- VS Code multi-root flows no longer depend on `workspaceFolders[0]` for indexed-target identity.

### Gate For Phase 4

Do not build the STDIO compatibility bridge until all of the following are true:

- daemon discovery format is stable;
- daemon auth/allowlist behavior is specified;
- daemon failure modes and fallback behavior are documented;
- incompatible daemon versions are detectable by the bridge before forwarding tool calls.

## Risks

### Cross-Repo State Bleed

This is the main blocker for any shared runtime. If repository-specific mutable state remains process-global, correctness will stay non-deterministic even when transport changes.

### Larger Blast Radius

One daemon serving many repositories increases the cost of a crash, deadlock, or runaway sync loop.

### Background Work Amplification

The current timer-driven sync model can become a persistent CPU source when many repositories are indexed.

### Migration Ambiguity

If workspace scoping and absolute-path support are not defined clearly, migration fixes can still produce silent data loss or surprising behavior.

## Open Decisions

- What is the authoritative recovery source for snapshot self-heal when local snapshot state is missing or corrupted?
- What heartbeat interval and stale-owner timeout define a dead `indexing` owner?
- Is indexing codebases outside `process.cwd()` a supported product behavior or a compatibility mode that needs explicit documentation?

## Final Delivery Rule

Do not treat the shared multi-repo MCP service as ready until all of the following are true:

- snapshot concurrency is safe;
- cross-process indexing ownership is enforced;
- per-codebase mutable state is isolated;
- incremental sync is recoverable and observable;
- daemon mode has bounded concurrency and operational controls.
