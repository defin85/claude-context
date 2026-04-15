# Unified MCP Stability and Shared Service Plan

Status: in_progress  
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

## Current Execution Slice

Implemented on 2026-04-15:

- Phase 0 baseline is now partially landed:
  - runtime status file at `~/.context/mcp/runtime/<pid>.json`;
  - explicit sync skip reasons and per-codebase sync outcome logging.
- Phase 1 is now partially landed:
  - snapshot-owned `indexing` ownership with runtime id, pid, and heartbeat metadata;
  - second-runtime rejection while a live owner exists;
  - deterministic stale-owner reclaim;
  - startup recovery that preserves live owners and converts stale owners to `indexfailed`;
  - legacy global snapshot migration now preserves valid absolute codebase paths and canonicalizes aliased paths instead of filtering by `process.cwd()`;
  - delete protection is now durable across processes via persisted snapshot tombstones instead of process-local memory only;
  - regression smoke now covers real separate-process delete/save race and live-owner blocking, not only multiple `SnapshotManager` instances in one PID;
  - manual acceptance is complete:
    - `pnpm --filter @zilliz/claude-context-mcp typecheck` passes;
    - `pnpm --filter @zilliz/claude-context-mcp build` passes;
    - manual multi-process repros for delete/save race, concurrent index start, and startup migration were re-run successfully against the current implementation.
- Phase 2 is now partially landed:
  - `Context` now keeps per-codebase session state instead of reusing one mutable ignore/extensions bag across repositories;
  - custom extensions and custom ignore patterns are persisted per codebase under the workspace-scoped MCP state directory;
  - background sync restores persisted per-codebase config before `reindexByChange()`;
  - background sync can now self-heal an empty local snapshot from persisted per-codebase config plus cloud-backed index presence;
  - if persisted per-codebase config is missing, sync now fails closed with an explicit degraded-state reason instead of silently continuing with different semantics;
  - VS Code now persists the indexed codebase identity in extension state and routes search, sync, clear-index, status checks, and search-result open-file actions through that identity instead of inferring the target from `workspaceFolders[0]`;
  - regression smoke now covers an actual add/modify/delete incremental sync lifecycle on a temporary repository, not only handler-level or `SyncManager`-level stubs;
  - restart-safe sync semantics are now covered end-to-end for persisted custom extensions and ignore patterns, including new `.vue` files and ignored paths after a fresh `Context` + `SyncManager` startup;
  - corrupted local snapshot recovery is now covered end-to-end: `SyncManager` can self-heal from persisted config plus existing index state and still preserve per-codebase sync semantics;
  - manual acceptance is complete:
    - on a real indexed repository, file add/modify/delete all propagated to search without `force reindex`;
    - after MCP restart, automatic incremental sync resumed and removed stale chunks as expected;
    - the fresh-index race between live indexing ownership and startup self-heal was fixed and re-verified on a live MCP runtime.
- Phase 3 is now partially landed:
  - the MCP entrypoint now supports both `stdio` mode and a daemon mode instead of being hard-wired to one subprocess-per-client;
  - daemon mode binds `Streamable HTTP` on `127.0.0.1` and keeps the first transport iteration stateless for ordinary tool calls;
  - daemon access is fail-closed with explicit bearer-token authentication, local web-origin/session guards, and per-request rejection of unexpected `mcp-session-id` headers;
  - daemon-managed codebase operations are restricted to an explicit local allowlist and the handlers now reject out-of-scope paths before touching filesystem or cloud state;
  - daemon-managed snapshot/config state now lives under dedicated `~/.context/mcp/daemon/...` paths instead of reusing workspace-scoped state implicitly;
  - a daemon registry file now publishes endpoint/auth fingerprint/allowed-root metadata without storing the bearer token in plaintext;
  - daemon workload controls are now partially wired:
    - bounded indexing/sync concurrency with a queue keyed by codebase identity;
    - separate bounded search concurrency;
    - interactive indexing requests are prioritized ahead of background sync work when both are queued;
    - recently interactive repositories now get a bounded priority boost for queued background sync work;
    - background sync retries now apply per-repository backoff instead of immediately competing for the indexing lane again after a failure;
    - queued indexing now keeps ownership heartbeat alive while waiting for an execution slot;
    - runtime status now records daemon workload state for active and queued jobs;
  - graceful stop is now fail-closed for current-runtime indexing ownership:
    - background sync timers are stopped during shutdown;
    - any `indexing` entries still owned by the current runtime are proactively converted to `indexfailed` instead of waiting for a later stale-owner recovery pass;
  - reproducible idle resource evidence now exists in-repo:
    - `pnpm benchmark:daemon-idle` spins up one daemon runtime and a comparable one-subprocess-per-repo stdio set against temporary repositories and a temporary `HOME`, then measures idle `VmRSS` from `/proc/<pid>/status`;
    - the benchmark uses a dedicated `MCP_BENCHMARK_IDLE_STUBS=1` startup mode so the measurement captures MCP runtime overhead rather than requiring live `Milvus`/embedding services;
    - on 2026-04-15, the local benchmark with 3 simulated repositories measured `110308 KiB` total RSS for one daemon versus `330592 KiB` across 3 stdio runtimes, so daemon idle usage was lower by `66.6%`;
  - regression smoke now covers daemon runtime config parsing, daemon registry metadata, collision-safe runtime status writes, dedicated daemon state paths, allowlist rejection, queue ordering, queued indexing responses, and bounded search concurrency.
  - manual multi-repo daemon acceptance is now partially complete:
    - one live daemon runtime served `vk-turn-proxy`, `bsl-gradual-types`, and `codex-cli-profiles` concurrently;
    - while `bsl-gradual-types` held the single indexing lane, `vk-turn-proxy` remained searchable and a second `force` index request for `codex-cli-profiles` was queued instead of starting uncontrolled parallel indexing;
    - out-of-scope `/tmp` requests were rejected by the daemon allowlist, and runtime status published the expected active/queued job state.
  - manual daemon restart acceptance is now complete:
    - on an isolated temporary `HOME`, the daemon registry was recreated cleanly on restart and removed again on graceful shutdown;
    - stale `indexing` ownership with a dead PID was recovered to explicit `indexfailed` state during startup snapshot load;
    - persisted per-codebase `.vue` extension and ignore-pattern config survived restart-safe sync, and when the persisted config file was deleted the daemon reported an explicit degraded sync state instead of silently diverging.
- Phase 4 is now partially landed:
  - daemon discovery now publishes direct-connect bootstrap data for updated clients in `~/.context/mcp/daemon/client-config.json`, including endpoint, bearer token, allowlist roots, and compatibility version;
  - daemon-side client/bootstrap helpers now exist:
    - `connectToDiscoveredDaemon()` for updated clients;
    - `--daemon-discover` and `--daemon-status` for direct bootstrap and operator inspection;
    - `--daemon-cancel <path>`, `--daemon-stop`, `--daemon-cleanup-stale`, and `--daemon-restart` for operational control;
  - the VS Code extension now consumes the daemon discovery/bootstrap path directly:
    - `semanticCodeSearch.runtime.mode` supports `auto`, `embedded`, and `daemon`;
    - `auto` prefers a compatible local daemon and falls back to embedded runtime when discovery is absent;
    - `daemon` fails closed before tool calls when no compatible daemon is available;
    - index/search/clear/status flows now consume structured daemon responses instead of extension-local prose parsing;
    - the extension sidebar settings now expose runtime-mode selection instead of assuming embedded-only operation;
  - daemon startup now performs a fail-closed first-boot migration from workspace-scoped snapshot/config state into daemon-scoped state, limited to existing allowlisted repositories;
  - workload cancellation now propagates into queued and active indexing/background-sync work via `AbortSignal`, instead of only dropping queue metadata;
  - explicit stale daemon cleanup now exists without requiring daemon startup:
    - `--daemon-cleanup-stale` removes dead registry/discovery/runtime-status artifacts;
    - the same cleanup path also replays daemon-scope snapshot recovery so stale `indexing` ownership is converted to `indexfailed` without waiting for a later daemon boot;
  - restart UX is now partially landed:
    - `--daemon-restart` asks a live daemon to shut down, waits for discovery removal, cleans stale artifacts, and relaunches daemon mode;
    - restart can reuse active discovery metadata for host/port/path/token/allow-roots when those flags are omitted on the restart command line;
  - live daemon acceptance is now complete for the current Phase 4 slice:
    - on an isolated temporary `HOME`, daemon discovery and redacted operator status were both readable after startup;
    - the migrated workspace-scoped repository and its daemon-scoped per-codebase config were visible after first boot;
    - one active indexing job plus one queued indexing job were observed through daemon status;
    - operator cancel moved the queued repository to `indexfailed` without killing the active job;
    - operator shutdown removed discovery/registry state and converted the still-active repository to explicit `indexfailed`.
  - checked-in regression smoke now also covers:
    - explicit stale daemon artifact cleanup plus snapshot stale-owner recovery without daemon restart;
    - restart argument synthesis so admin flags are stripped and discovery metadata backfills missing daemon options.
  - live operator restart/cleanup acceptance is now complete:
    - on 2026-04-15, `--daemon-restart` was re-run end-to-end against an isolated temporary `HOME`, producing a new daemon `runtimeId`/`pid` while preserving endpoint and allowlist metadata;
    - `--daemon-cleanup-stale` was then verified live to remove orphan daemon `runtime/*.json` artifacts left by prior stopped runtimes;
    - the same cleanup command was also verified live to persist stale snapshot ownership recovery to disk, so a dead `indexing` owner remained `indexfailed` after rereading `mcp-codebase-snapshot.json`.

Still open after this slice:

- additional first-party client rewiring is only needed if new daemon-aware clients are introduced beyond the now-migrated VS Code extension.
- optional future polish is now mostly around richer admin UX beyond the current CLI surface.

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
5. client migration and operational hardening.

## Constraints and Decisions

- Correctness before architecture expansion.
- Deletion must win over stale in-memory copies from another process.
- Only one live MCP owner may hold `indexing` for a given codebase at a time.
- Migration must not silently lose valid indexed absolute paths.
- Repository-specific ignore rules and custom extensions must not leak across codebases.
- Do not ship a shared multi-repo runtime before per-codebase mutable state is isolated.
- Keep collection-per-codebase storage semantics in the near term.
- Treat daemon mode as the supported client path once migration is complete; do not carry legacy STDIO compatibility as a phase gate.
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

- Add daemon runtime mode as the primary shared-service path; existing STDIO mode may remain for local/debug use but is not a rollout requirement.
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
  - completed on 2026-04-15 against an isolated temporary `HOME` and temporary `.vue` repository:
    - runtime registry was recreated cleanly;
    - stale ownership was recovered correctly;
    - persisted per-codebase sync configuration was preserved, and explicit degraded state was reported when that config was removed.

## Phase 4: Client Migration and Operational Hardening

Goal: make shared mode the supported client path and maintainable in daily operation.

### Work items

- Add daemon discovery or explicit client configuration for updated clients.
  - completed for the current first-party client surface on 2026-04-15 via `client-config.json`, `connectToDiscoveredDaemon()`, `--daemon-discover`, and direct VS Code consumption of discovery metadata.
- Add daemon/client compatibility-version handshake so incompatible clients and daemon builds fail closed before issuing tool calls.
  - completed for the current slice via `compatibilityVersion` in discovery metadata plus client-side validation before connect.
- Add graceful stop/restart, stale runtime cleanup, and job cancellation.
  - partially completed:
    - graceful stop exists through `shutdown_daemon` / `--daemon-stop`;
    - per-repository cancellation exists through `cancel_codebase_workload` / `--daemon-cancel`;
    - explicit stale-runtime cleanup now exists through `--daemon-cleanup-stale`;
    - CLI restart orchestration now exists through `--daemon-restart`;
    - live end-to-end restart and cleanup acceptance completed on 2026-04-15 against an isolated temporary `HOME`, including orphan runtime-status cleanup and persisted stale-owner recovery.
- Harden lock recovery, snapshot recovery, and diagnostics for long-lived runtime operation.
  - partially completed through daemon-scoped startup migration, cancellation-aware workload shutdown, and redacted operator status.
- Document client bootstrap behavior when the daemon is absent or unhealthy.
  - completed for the current VS Code client slice in CLI error paths, `packages/mcp/README.md`, the extension README, and fail-closed extension error messages when `runtime.mode = daemon`.
- Document operational workflows:
  - completed for the current daemon slice:
    - list active runtimes;
    - list known repositories and active jobs;
    - stop one repository workload without guessing which process to kill;
    - clean dead daemon artifacts and recover stale snapshot ownership without manual file surgery;
    - restart daemon mode without reconstructing host/port/path/allow-root flags by hand when discovery metadata is available.

### Exit criteria

- Updated first-party clients can target the daemon directly through one documented discovery/configuration path.
- Operators can inspect and manage shared runtime behavior without log spelunking.
- Shared mode is stable enough for daily development.

### Verification

- Completed on 2026-04-15 against an isolated temporary `HOME` plus three temporary repositories:
  - daemon discovery returned direct-connect bootstrap data with compatibility version;
  - operator status returned redacted metadata and reflected a migrated workspace-scoped repository plus daemon-scoped config;
  - one active indexing job and one queued indexing job were both visible in daemon workload state;
  - `--daemon-cancel <path>` moved the queued repository to explicit `indexfailed` while the active repository kept running;
  - `--daemon-stop` removed discovery/registry state and converted the still-active repository to explicit `indexfailed` during shutdown.
- Completed on 2026-04-15 for the VS Code client integration slice:
  - `semanticCodeSearch.runtime.mode = auto` prefers a live compatible daemon and otherwise falls back to the embedded runtime;
  - `semanticCodeSearch.runtime.mode = daemon` fails closed when discovery is absent or incompatible;
  - search/index/clear/status now use structured daemon tool responses instead of parsing text;
  - extension-local startup sync and periodic auto-sync are skipped when the active runtime resolves to daemon mode.
- Completed on 2026-04-15 for daemon ops regression coverage:
  - `cleanupStaleDaemonState()` removes dead registry/discovery/runtime-status artifacts and recovers stale daemon-scope `indexing` ownership to explicit `indexfailed`;
  - restart argument synthesis strips admin-only flags and reuses discovery metadata for daemon host/port/path/token/allow-roots when explicit restart flags are absent.

## Cross-Phase Dependencies

- Phase 1 depends on Phase 0 observability for reliable diagnosis and regression proof.
- Phase 2 depends on Phase 1 snapshot semantics; self-healing on top of unsafe persistence will be non-deterministic.
- Phase 3 depends on Phase 2 isolation; otherwise a shared runtime will amplify cross-repo state bleed.
- Phase 4 depends on Phase 3 runtime semantics being stable enough to migrate clients onto the daemon and administer it.

## Entry Gates

### Gate For Phase 3

Do not begin daemon rollout until all of the following are true:

- multi-process ownership tests pass;
- delete resurrection regression tests pass;
- per-codebase ignore and extension isolation is implemented and covered by tests;
- restart after snapshot loss/corruption preserves sync semantics or reports explicit degraded state;
- VS Code multi-root flows no longer depend on `workspaceFolders[0]` for indexed-target identity.

### Gate For Phase 4

Do not begin the client-migration/operations layer until all of the following are true:

- daemon discovery format is stable;
- daemon auth/allowlist behavior is specified;
- daemon failure modes and client bootstrap/error behavior are documented;
- incompatible daemon versions are detectable by updated clients before forwarding tool calls.

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
- Is indexing codebases outside `process.cwd()` a supported product behavior or a constrained mode that needs explicit documentation?

## Final Delivery Rule

Do not treat the shared multi-repo MCP service as ready until all of the following are true:

- snapshot concurrency is safe;
- cross-process indexing ownership is enforced;
- per-codebase mutable state is isolated;
- incremental sync is recoverable and observable;
- daemon mode has bounded concurrency and operational controls.
