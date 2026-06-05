## Why

The previous traversal acceleration work did not prove a meaningful wall-time win on the large 1C repository case. On `bp-unicom-sdd`, concurrency 1 and 8 produced nearly the same elapsed time, so the next pass must optimize the traversal engine itself instead of only increasing asynchronous file-stat/hash parallelism.

This change follows `profile-preindex-traversal-hotspots`: it uses the new diagnostics to reduce cold first-pass traversal wall time while preserving the exact indexed-file contract.

## What Changes

- Optimize the TypeScript traversal path based on measured hotspots from `profile-preindex-traversal-hotspots`.
- Add safe fast paths for unsupported file entries, path normalization, and ignore matching where the existing semantics allow it.
- Restructure ignore evaluation to avoid repeated full matcher work for common directory/file cases, including directory decision caching and matcher bucketing where applicable.
- Keep selected file set, selected file order, file hashes, and downstream indexing behavior stable against the current TypeScript traversal.
- Add an optional native/Rust traversal engine only if the measured TypeScript optimizations do not meet the accepted performance threshold, or if diagnostics show a clear CPU-bound path that TypeScript cannot remove cleanly.
- Add an explicit traversal engine selection and fallback model, for example `ts`, `native`, and `auto`, with TypeScript as the safe fallback.
- Require benchmark evidence on the large 1C repository path before calling the change complete.
- Non-goals:
  - no expansion of indexed extensions such as XML, HTML, or ST,
  - no default policy that skips directories merely to make benchmarks faster,
  - no embedding, reranking, Milvus schema, or search-result changes,
  - no migration of existing indexed collections.

## Capabilities

### New Capabilities
- `preindex-traversal-performance`: performance and compatibility requirements for the optimized pre-index traversal engine.

### Modified Capabilities

## Impact

- Affected code: `packages/core` traversal, ignore matching, hashing orchestration, diagnostics, and benchmark tooling. A native helper may add a small Rust/native package or build artifact if TypeScript-only optimization is insufficient.
- Affected systems: MCP and daemon indexing can report which traversal engine was used and the measured traversal timings.
- APIs: normal `index_codebase` behavior remains compatible. Optional configuration may be added for traversal engine selection and benchmark diagnostics.
- Existing indexed collections: no migration impact; selected files and hashes must match the existing traversal for the same effective configuration.
