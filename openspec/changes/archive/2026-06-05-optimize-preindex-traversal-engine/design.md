## Context

The preceding diagnostic change, `profile-preindex-traversal-hotspots`, establishes the measurement contract for the first pre-index traversal pass. This change uses those measurements to reduce wall time on large repositories such as the 1C configuration at `bp-unicom-sdd`.

The current evidence shows that raising Node async concurrency from 1 to 8 did not materially reduce elapsed time. That points away from selected-file hashing as the only bottleneck and toward traversal, path processing, ignore matching, or unsupported-entry work across the full tree.

## Goals / Non-Goals

**Goals:**
- Reduce pre-index traversal wall time on large repositories without changing selected files.
- Preserve ignore semantics, selected-file ordering, and file hashes.
- Prefer TypeScript optimizations first so the default path remains portable and easy to debug.
- Add a native/Rust traversal engine only if diagnostics show TypeScript cannot meet the accepted threshold cleanly.
- Keep fallback behavior explicit and safe.

**Non-Goals:**
- Changing which extensions are indexed.
- Skipping directories only to improve benchmark numbers.
- Changing embedding, reranking, Milvus schemas, collection names, or search behavior.
- Replacing the whole indexing pipeline.

## Decisions

1. Optimize the TypeScript traversal path first.
   - Apply measured fixes such as unsupported-extension fast paths, reduced path normalization, directory ignore decision caching, and matcher bucketing.
   - Rationale: the TypeScript path is already deployed everywhere and avoids native build/runtime complexity.
   - Alternative considered: immediately rewriting traversal in Rust. That adds packaging and fallback cost before proving the exact hotspot.

2. Preserve a golden compatibility contract.
   - Every optimized engine must match the baseline TypeScript traversal for selected path set, selected path order, and file hashes under the same effective configuration.
   - Rationale: traversal speed must not silently change what gets indexed.

3. Gate native/Rust implementation on measured need.
   - If TypeScript optimizations do not achieve the accepted threshold, introduce a native helper with a small JSON-compatible interface and an automatic TypeScript fallback.
   - Rationale: native traversal can help CPU-heavy path/matcher loops, but only if the diagnostics justify the extra build and maintenance surface.

4. Add explicit engine selection.
   - Supported modes will be equivalent to `ts`, `native`, and `auto` if a native helper is introduced.
   - Rationale: deployments need a predictable fallback path, and benchmarks need to identify the engine under test.

5. Use `bp-unicom-sdd` as the primary large-repository acceptance target.
   - The acceptance benchmark compares against the profiled baseline from `profile-preindex-traversal-hotspots`.
   - Rationale: this is the real workload that exposed the issue and contains the unsupported-file-heavy tree shape that simple concurrency did not solve.

## Risks / Trade-offs

- Fast-path filtering could accidentally bypass ignore semantics -> compare selected path set/order/hash against the baseline traversal in tests and benchmark output.
- Directory decision caching could mishandle root-anchored or negated ignore patterns -> include targeted tests for anchored, globbed, hidden, and negated patterns before enabling the cache.
- Native helper packaging could make installs fragile -> keep TypeScript as the default fallback and only require native when explicitly selected or proven available in `auto`.
- Benchmarks can be distorted by OS cache state -> require multiple runs and report run metadata rather than relying on a single elapsed value.
- Extra diagnostics add minor overhead -> use the observability change to separate diagnostic overhead from normal optimized traversal timing.
