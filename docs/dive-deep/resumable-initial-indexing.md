# Resumable Initial Indexing

Initial indexing writes a durable manifest before vector collection preparation and before any force-mode collection replacement. The manifest records the effective codebase identity, selected file fingerprint, batch states, and document ids confirmed by successful vector writes.

## Automatic Modes

`index_codebase` uses these modes:

- `initial_full`: no compatible resumable manifest exists, or `force=true` starts a new rebuild.
- `initial_resume`: a compatible incomplete manifest exists; already confirmed document ids are skipped and only unconfirmed chunks are processed again.
- `incremental_changes`: the index is complete and has a synchronizer snapshot, so ordinary change detection can run.
- `incompatible_requires_reindex`: persisted state does not match the effective retrieval mode, file selection, backend, splitter, or write-safety requirements.

`force=true` never resumes. If a matching manifest exists, it is marked `superseded` before the collection is replaced.

## Resume Semantics

Resume is conservative:

- only document ids listed in `confirmedDocumentIds` are skipped;
- batches left in `planned`, `embedding`, `inserting`, `failed`, or `cancelled` state are reprocessed;
- vector insert errors fail the run instead of being treated as skipped files;
- the synchronizer snapshot is written only after all selected chunks are confirmed.

`CODE_CHUNK_LIMIT` produces `limit_reached`, not `completed`. The partial index can remain searchable, but incremental sync stays ineligible until a later run confirms every selected chunk and writes the synchronizer snapshot.

## Legacy State

Completed indexes created before manifests can continue through existing snapshot and collection checks. Failed or partial pre-manifest runs are not resumed silently because there is no durable list of confirmed document ids. Re-run indexing; use `force=true` when the existing collection or retrieval profile is incompatible.

`get_indexing_status` exposes initial-indexing details for the requested codebase path, including manifest compatibility, resume eligibility, confirmed and unconfirmed document counts, failed batch counts, and selected file counts.
