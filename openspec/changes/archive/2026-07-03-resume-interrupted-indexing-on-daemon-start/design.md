## Overview

The current manual recovery path is already the correct one: `handleIndexCodebase()` performs allowlist checks, ownership checks, persisted configuration checks, manifest compatibility checks, and queueing. Startup auto-resume should reuse that path instead of creating a parallel indexer.

The daemon startup sequence should run a lightweight recovery pass after daemon state migration and before background sync is started. The pass identifies interrupted indexing entries, filters them through conservative local checks, and calls `handleIndexCodebase()` with persisted settings.

## Eligibility

Eligible entries are codebases with one of these states:

- `indexfailed` with the exact daemon-shutdown interruption message.
- `indexfailed` created from stale `indexing` ownership recovery, where the error message starts with `Indexing was interrupted or abandoned`.

The pass must not treat every failed index as resumable. Most failures represent real indexing, embedding, configuration, or vector backend errors and should remain operator-visible.

## Startup Flow

1. Load/migrate daemon snapshot state.
2. Read failed codebase entries from snapshot.
3. For each candidate:
   - reject if the path is outside the current daemon allowlist;
   - reject if the directory no longer exists;
   - reject if there is no persisted per-codebase configuration;
   - reject if workload manager already has active or queued indexing for the same path;
   - build `index_codebase` args from persisted configuration, with `force=false`.
4. Call `handleIndexCodebase()` and let the existing path decide whether the manifest is compatible.
5. Record queued/skipped/error outcomes in daemon logs and runtime status.
6. Start normal background sync.

## Configuration Preservation

Startup resume must use the stored per-codebase configuration:

- custom extensions;
- custom ignore patterns;
- retrieval profile when present;
- 1C scope profile when present;
- enrichment configuration remains in the persisted session and is applied by the indexing path.

If the persisted configuration is missing, startup recovery must skip the codebase and report that manual reindexing is required.

## Failure Handling

If `handleIndexCodebase()` rejects the request because the manifest is incompatible, the index is missing, the persisted profile conflicts, or the path is invalid, the daemon must not force a rebuild. It should leave the failed state visible and log the rejection.

Startup recovery is best effort. One failed candidate must not prevent the daemon from serving requests or processing other candidates.

## Observability

Daemon startup logs should include:

- number of candidates found;
- path-level queued/skipped/error outcome;
- skip or error reason.

Runtime status may store a compact last startup recovery summary for the dashboard and `get_daemon_status`.

## Risks

- Restart unexpectedly resumes a large index: mitigated by limiting eligibility to daemon-interrupted states and using normal workload concurrency.
- Wrong configuration resumes wrong corpus: mitigated by persisted config and existing manifest compatibility checks.
- Startup blocks daemon availability: mitigated by queueing through existing background jobs and treating the pass as best effort.

