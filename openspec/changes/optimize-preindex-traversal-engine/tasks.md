## 1. Baseline And Compatibility Harness

- [x] 1.1 Read the baseline diagnostic output from `profile-preindex-traversal-hotspots` and identify the dominant traversal hotspots.
- [x] 1.2 Add a compatibility harness that compares baseline TypeScript traversal against optimized traversal for selected path count, ordered selected-path fingerprint, and file hashes.
- [x] 1.3 Add fixture coverage for directory ignores, file ignores, root-anchored patterns, glob patterns, hidden paths, negated patterns, unsupported file extensions, and stable ordering.

## 2. TypeScript Traversal Optimization

- [x] 2.1 Implement measured TypeScript fast paths for unsupported file entries while preserving file ignore semantics.
- [x] 2.2 Reduce repeated path normalization and string allocation in traversal hot paths.
- [x] 2.3 Add safe ignore matcher restructuring, such as directory decision caching or matcher bucketing, where compatibility tests prove baseline equivalence.
- [x] 2.4 Report traversal engine name and optimized diagnostics in logs and benchmark output.

## 3. Native Engine Decision

- [x] 3.1 Benchmark the optimized TypeScript traversal on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` against the recorded baseline.
- [x] 3.2 If the optimized TypeScript path does not reach at least 25 percent median wall-time reduction, implement an optional native/Rust traversal helper with a small JSON-compatible interface.
- [x] 3.3 If native traversal is added, implement `ts`, `native`, and `auto` engine selection with TypeScript fallback on unavailable native helper or native errors.
- [x] 3.4 If native traversal is added, include packaging/build behavior in the workspace without making normal TypeScript fallback installs fail.

## 4. Validation

- [x] 4.1 Run compatibility tests showing optimized traversal matches baseline selected paths, order, and hashes.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 4.3 Run the large 1C repository benchmark and record median wall-time improvement, selected-path fingerprint, selected-file count, and hash compatibility.
- [x] 4.4 Verify existing indexed collections require no migration and unchanged selected files remain unchanged in the indexing pipeline.
