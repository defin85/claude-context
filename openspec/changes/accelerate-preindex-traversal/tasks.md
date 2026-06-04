## 1. Baseline And Test Fixtures

- [x] 1.1 Add fixture coverage for nested directories, hidden paths, root-anchored ignores, directory ignores, filename globs, unsupported extensions, and unreadable entries.
- [x] 1.2 Capture the current sequential synchronizer selected-file and hash behavior on fixtures as compatibility expectations.
- [x] 1.3 Add a benchmark or diagnostic harness that reports pre-index scan, hash, file-list, split, embedding, and insert timing separately.

## 2. Shared Traversal Core

- [x] 2.1 Implement a reusable pre-index traversal result type containing relative path, absolute path, extension, file hash when requested, and stable ordering metadata.
- [x] 2.2 Implement a bounded-concurrency directory and file work queue with configurable concurrency and a safe default.
- [x] 2.3 Replace repeated glob-to-regex work with a compiled per-session ignore matcher while preserving current ignore semantics.
- [x] 2.4 Ensure traversal output is deterministic where required by sorting before merkle DAG construction and index processing.

## 3. Synchronizer Integration

- [x] 3.1 Update `FileSynchronizer` to build cold snapshots from the shared traversal result.
- [x] 3.2 Preserve loading and writing compatibility for existing merkle snapshot JSON.
- [x] 3.3 Keep incremental change detection behavior equivalent for added, removed, and modified files.
- [x] 3.4 Add rollback/config behavior that can run with concurrency `1` for sequential-equivalent operation.

## 4. Indexer Integration

- [x] 4.1 Update initial and force indexing to reuse the synchronizer traversal result as the code file list.
- [x] 4.2 Avoid the second full `getCodeFiles()` walk when a fresh traversal result is already available.
- [x] 4.3 Keep background incremental sync conservative unless explicitly proven safe for the new traversal path.
- [x] 4.4 Ensure accelerator status is reset for the current indexing job before embedding begins so stale previous-run snapshots are not reported.

## 5. Observability And Configuration

- [x] 5.1 Add config/env options for pre-index traversal concurrency with documented defaults and bounds.
- [x] 5.2 Expose aggregate pre-index timing in logs and indexing status without adding per-file log noise.
- [x] 5.3 Include selected file count, hashed file count, and pre-index duration in completion diagnostics.

## 6. Verification

- [x] 6.1 Run focused core tests for synchronizer, ignore matching, and indexer file selection.
- [x] 6.2 Run `pnpm --filter @zilliz/claude-context-core typecheck` and build validation.
- [x] 6.3 Run a smoke force-index on a small repo and confirm snapshots remain compatible.
- [x] 6.4 Run a large-repo benchmark on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` comparing pre-index time and total time before and after the change.
- [x] 6.5 Confirm BGE-M3 worker pool starts receiving embedding batches sooner after force indexing starts.
