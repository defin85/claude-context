## Overview

This change introduces a durable initial-indexing manifest and a mode planner in front of indexing. The planner decides whether the next `index_codebase` request should run a full initial index, resume an interrupted initial index, run ordinary changed-file indexing, or fail closed because stored state is incompatible.

The core rule is simple: resume only skips work that the system has durably confirmed after a successful vector write. Anything unconfirmed is recomputed and written through idempotent document identifiers or backend-safe upsert behavior.

## Goals

- Resume interrupted initial indexing without rewriting already confirmed chunks.
- Support all repository types, retrieval modes, acceleration settings, and 1C scope profiles.
- Make the decision automatic for normal `index_codebase` calls.
- Fail closed when state is incompatible or write success is ambiguous.
- Expose enough status for operators to understand whether indexing started from scratch, resumed, or applied ordinary changes.

## Non-Goals

- No legacy repair of partial indexes that predate the manifest.
- No concurrent writers for the same codebase and collection.
- No retrieval ranking or vector schema redesign.
- No promise of transactional rollback for vector database requests already sent.

## Mode Planner

Add an `IndexingModePlanner` in `packages/core` that reads persisted codebase state before indexing starts.

Inputs:

- normalized codebase path;
- effective ignore patterns and supported extensions;
- effective 1C scope profile, if any;
- embedding provider/model/profile metadata;
- retrieval mode and vector schema identity;
- target collection name;
- synchronizer snapshot state;
- initial-indexing manifest state;
- request flags such as `force`.

Outputs:

- `initial_full`: no compatible completed index exists and no compatible resumable manifest exists.
- `initial_resume`: compatible interrupted manifest exists and the target collection identity still matches.
- `incremental_changes`: completed index and synchronizer snapshot are compatible.
- `incompatible_requires_reindex`: persisted completed or partial state exists but compatibility checks fail.

`force=true` keeps its existing meaning of rebuilding the target index. It must not silently resume an old manifest unless an explicit future option requests that behavior.

The planner must run before collection preparation or synchronizer snapshot writes. In the current flow, collection preparation can drop data in force mode and `FileSynchronizer.initializeFromTraversal()` writes the merkle snapshot before vector insertion completes; V2 must defer any completed-index snapshot commit until the manifest reaches `completed`.

## Manifest Model

Store one manifest per codebase/configuration/collection identity under the existing persistence root. The manifest should be written atomically.

Required fields:

- manifest version;
- normalized codebase path;
- collection name and vector backend identity;
- retrieval mode and vector schema fingerprint;
- embedding profile fingerprint;
- effective supported extensions, ignore patterns, and 1C scope profile;
- chunker/splitter fingerprint;
- selected-file fingerprint and traversal counters;
- run state: `planning`, `indexing`, `interrupted`, `failed`, `completed`, `cancelled`;
- batch records with stable batch identifier, file paths, chunk/document identifiers, state, timestamps, and error context;
- confirmed inserted document identifiers or confirmed inserted document ranges;
- last completed synchronizer snapshot pointer when the run completes.

Batch states:

- `planned`: chunks are known but no durable vector write has completed.
- `embedding`: embedding request started, not durable success.
- `inserting`: vector write request started, outcome may still be ambiguous.
- `inserted`: vector write completed successfully and document identifiers are durable.
- `failed`: batch failed before confirmed insertion.
- `cancelled`: batch was not completed because the job stopped.

Only `inserted` batches may be skipped during resume.

## Stable Document Identity

Resume safety depends on stable document identifiers. The implementation must verify that document IDs are deterministic for the same normalized relative path, chunk range, content hash, retrieval mode, and chunker profile.

If any existing path generates nondeterministic IDs, that bug must be fixed before enabling skip-on-resume for that path. Tests should cover dense, hybrid, BGE-M3 full, accelerated, and non-accelerated runs.

## Resume Flow

For `initial_resume`:

1. Re-run traversal using the current effective configuration.
2. Compare the new selected-file fingerprint and compatibility fields against the manifest.
3. Rebuild chunk plans with stable document identifiers.
4. Mark chunks whose document IDs are in confirmed `inserted` manifest state as complete.
5. Process only missing, failed, cancelled, or unconfirmed chunks.
6. Persist newly confirmed inserted document IDs only after vector insertion succeeds.
7. Write the synchronizer snapshot and mark the manifest `completed` only when all selected chunks are confirmed.

If traversal output, profile, schema, collection, or embedding compatibility no longer matches, planner must return `incompatible_requires_reindex`.

## Vector Write Semantics

The vector insertion path must be safe for retries:

- Prefer idempotent upsert semantics when the backend supports them.
- If a backend only supports plain insert and an insert outcome is ambiguous, fail closed and do not mark that batch `inserted`.
- If a later resume sees an unconfirmed batch that may have partially reached the backend, either use upsert/delete-then-upsert semantics or require full reindex for that backend/mode.
- Coalesced insert batches must preserve per-document confirmation data so a large write cannot hide which document IDs are safe to skip.

Write safety is mode-specific, not backend-global. Dense, hybrid, and BGE-M3 full insert paths must each declare whether they can safely reprocess unconfirmed document IDs through upsert or delete-then-upsert. `initial_resume` may process unconfirmed chunks only for insert modes with a declared safe write path; otherwise it must fail closed and require full reindexing.

## Interaction With Acceleration

Accelerated indexing may process batches out of order. The manifest must tolerate out-of-order completion by using stable batch/document identifiers rather than array position.

The accelerator status should include resume-aware counters:

- planned chunks;
- already confirmed chunks skipped;
- remaining chunks;
- in-flight embedding batches;
- in-flight insert batches;
- failed/unconfirmed batches.

Existing fallback behavior remains valid, but fallback must not change manifest compatibility or document identifiers.

## 1C Scope Profiles

The compatibility fingerprint must include the effective 1C indexing scope profile. This is required for `full`, `developer`, `minimal`, and `v8unpack`, because each profile can select a different file set.

Changing the 1C scope profile, selected extension set, or ignore behavior invalidates initial resume. The planner must fail closed with an operator-facing message that a full reindex is required.

## Status and Operator Contract

`get_indexing_status` and completion output should report:

- selected indexing mode;
- whether resume was eligible;
- manifest path or manifest identifier;
- manifest compatibility result;
- confirmed/skipped/missing chunk counts;
- reason when resume is rejected;
- whether the current index is complete, partial/interrupted, failed, or incompatible.

Status must be scoped to the requested codebase path. It must not report stale batch data from another codebase.

## Risks and Mitigations

- Manifest lies about inserted data: update confirmed state only after successful vector write; write manifest atomically; test crash windows.
- Stable IDs are not actually stable: add deterministic-ID regression tests for all retrieval/indexing modes.
- Backend insert outcome is ambiguous: fail closed unless the backend path is idempotent.
- Coalescing hides partial success: require per-document confirmation or treat the whole coalesced batch as unconfirmed.
- Profile changes accidentally resume wrong file set: include effective profile, extension, ignore, splitter, and selected-file fingerprints in compatibility checks.
- Manifest grows too large: allow compact representation of confirmed IDs by batch while preserving enough evidence to skip safely.
- Existing failed indexes cannot resume: report this explicitly as migration behavior instead of pretending legacy state is safe.

## Verification Strategy

- Unit tests for planner decisions across empty, completed, interrupted, incompatible, and force states.
- Unit tests for manifest state transitions and atomic writes.
- Regression tests for stable document IDs across dense, hybrid, BGE-M3 full, accelerated, and non-accelerated paths.
- Integration test that interrupts initial indexing after at least one successful insert, reruns `index_codebase`, and verifies only unconfirmed chunks are embedded/inserted.
- Matrix tests for 1C scope profiles: `full`, `developer`, `minimal`, and `v8unpack`.
- Failure tests for ambiguous insert outcome and backend paths without safe upsert.
- Status tests proving `get_indexing_status` reports the selected mode and never leaks another codebase's manifest or accelerator batches.
