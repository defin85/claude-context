## 1. Diagnostics Model

- [x] 1.1 Locate the current pre-index traversal, ignore matching, file selection, ordering, and hashing code paths in `packages/core`.
- [x] 1.2 Add a `PreIndexTraversalDiagnostics` model with counters for entries visited, files seen, unsupported files by extension, ignored directories/files, selected files, hashed files, hash bytes, matcher calls, queue activity, and elapsed timings.
- [x] 1.3 Thread diagnostics collection through normal pre-index traversal without changing selected paths, selected path order, or hashes.
- [x] 1.4 Add concise normal log output and detailed JSON/NDJSON diagnostic output behind an explicit diagnostics mode.

## 2. Benchmark Command

- [x] 2.1 Add or extend a pre-index diagnostic benchmark command/script that accepts a codebase path and loads the same effective ignore and supported-extension configuration as normal indexing.
- [x] 2.2 Add benchmark options for repeated runs, traversal concurrency values, JSON/NDJSON output, and selected-path fingerprint reporting.
- [x] 2.3 Ensure benchmark output records run metadata needed to compare cold/warm runs, including engine, concurrency, selected count, selected fingerprint, elapsed timings, matcher work, hash work, and unsupported-extension counts.

## 3. Validation

- [x] 3.1 Add unit or integration tests proving diagnostics disabled/enabled produce the same selected paths and hashes.
- [x] 3.2 Add tests for unsupported-extension counting and machine-readable output parsing.
- [x] 3.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 3.4 Run the diagnostic benchmark on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` with at least concurrency 1 and 8, and save the structured baseline summary in the change notes or verification artifact.
