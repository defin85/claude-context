## Why

Daemon restarts currently mark runtime-owned indexing jobs as `indexfailed` with an interruption message. The existing resumable initial-indexing manifest lets an operator continue that work by calling `index_codebase` again, but agents can miss this and treat the failed state as a hard failure.

The daemon should make restart recovery explicit and automatic for the narrow safe case: indexing work that was interrupted by daemon shutdown or a stale previous owner and still has compatible persisted state.

## What Changes

- On daemon startup, scan tracked codebases for indexing states that represent daemon-interrupted work.
- Automatically enqueue resume attempts for eligible interrupted codebases through the existing `index_codebase` path, preserving persisted per-codebase settings and never using `force=true`.
- Skip ordinary failures, incompatible manifests, missing paths, disallowed roots, missing persisted settings, and active or queued work.
- Expose startup resume attempts in daemon logs/runtime status so operators can see which codebases were queued or skipped.

Non-goals:

- Do not retry arbitrary `indexfailed` entries caused by indexing errors, embedding failures, configuration mismatches, or collection incompatibility.
- Do not rebuild indexes automatically.
- Do not bypass allowlist checks or persisted codebase configuration.
- Do not add a second indexing implementation path.

## Capabilities

- `daemon-interrupted-indexing-resume`: Daemon startup recovery for previously interrupted indexing jobs.

## Impact

- A daemon restart may enqueue safe resume work that previously required a manual `index_codebase` call.
- Existing completed indexes and ordinary background sync behavior are unchanged.
- Existing failed entries are only reconsidered when their error clearly indicates daemon interruption or stale abandoned ownership recovery.
- Implementation touches MCP daemon startup, snapshot inspection, status/log reporting, and targeted tests.

