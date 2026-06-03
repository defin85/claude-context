## Context

Cold initial and force indexing currently start with a pre-index phase that is independent of BGE-M3 embedding. The synchronizer walks the tree, filters ignored paths, hashes supported files, writes a merkle snapshot, and then the indexer performs another tree walk to build the code file list. In a large 1C repository this kept one Node.js thread busy for several minutes while GPU-backed BGE-M3 sidecars were idle.

The existing full BGE-M3 retrieval path stores model-generated dense vectors, sparse lexical weights, and ColBERT token vectors. This change does not alter dense-only or full BGE-M3 semantics; it only reduces the time before split/embed/insert work can begin.

## Goals / Non-Goals

**Goals:**

- Make cold initial and force pre-index traversal bounded-parallel in Node.js.
- Avoid duplicate full-tree walks by reusing traversal output for synchronizer snapshots and index file selection.
- Keep existing merkle snapshot storage compatible with snapshots already on disk.
- Add pre-index metrics so status/logs show scan, hash, file-list, split, embedding, and insert time separately.
- Use conservative defaults that improve large repositories without harming normal MCP responsiveness.

**Non-Goals:**

- No Rust or native helper rewrite in this change.
- No changes to retrieval ranking, BGE-M3 dense/sparse/ColBERT vectors, Milvus schema, or collection migration.
- No attempt to parallelize embedding beyond the existing BGE-M3 worker pool change.
- No change to ignore-file semantics except where existing behavior is preserved with faster compiled matching.

## Decisions

1. **Use a Node.js bounded work queue for traversal first.**

   The current bottleneck is mostly sequential control flow, not proof that JavaScript cannot handle the workload. A bounded queue for directories and files lets the implementation overlap `readdir`, filtering, reads, and hashing while preserving backpressure. The default concurrency should be low enough for interactive use, with env/config override for benchmarking.

   Alternative considered: move the whole walker to Rust. Rust could be faster, but it adds build, packaging, ABI, and protocol complexity before measuring how much speed is available from algorithmic fixes.

2. **Return a reusable pre-index result.**

   The traversal result should contain relative path, absolute path, extension, hash when requested, and enough metadata to feed both `FileSynchronizer` and `Context.processFileList()`. This removes the current synchronizer walk followed by `getCodeFiles()` walk.

   Alternative considered: optimize only `FileSynchronizer.generateFileHashes()`. That leaves the second code-file scan in place and limits the impact on cold force indexing.

3. **Compile ignore matching per traversal.**

   Ignore patterns should be normalized and compiled once per codebase session, then reused for every candidate path. The compiled matcher must preserve current behavior for hidden paths, root-anchored patterns, directory patterns, path patterns, and filename patterns.

   Alternative considered: replace ignore matching with a third-party package. That may improve correctness, but it risks changing semantics and should be a separate compatibility change if needed.

4. **Use worker threads only if hashing is measured as CPU-bound after queueing.**

   Node's `crypto` and filesystem APIs can benefit from I/O concurrency without introducing worker-thread coordination. If benchmarks show SHA256 hashing saturates the main thread, add a small optional hashing worker pool behind the same bounded concurrency settings.

   Alternative considered: always hash in worker threads. That increases memory transfer and lifecycle complexity and may not help if the filesystem or ignore matching dominates.

5. **Preserve snapshot format.**

   Existing merkle JSON snapshots remain readable. New code can build the same `fileHashes` and `merkleDAG` output from the parallel traversal result, so rollback only requires disabling the new traversal path.

## Risks / Trade-offs

- Higher traversal concurrency can increase disk I/O pressure and reduce workstation responsiveness. Mitigation: conservative defaults, upper bounds, and explicit env/config tuning.
- Parallel traversal can produce nondeterministic order. Mitigation: sort paths before merkle DAG construction and before indexing when deterministic processing order is required.
- Reusing traversal output can accidentally diverge synchronizer and indexer filtering semantics. Mitigation: one shared matcher and tests that compare old and new selected-file sets on fixture trees.
- Full file hashing still reads all supported files on cold force indexing. Mitigation: retain compatible hashing for correctness first, then benchmark whether deferred or incremental snapshot writing is safe as a follow-up.
- Extra metrics can add log noise. Mitigation: expose aggregate timings in status and keep per-file logging unchanged or reduced, not expanded.

## Migration Plan

1. Introduce the new traversal implementation behind an internal code path and keep snapshot format compatible.
2. Add tests comparing old and new traversal/filter/hash results on representative fixtures.
3. Enable the new path by default with conservative concurrency once tests pass.
4. Benchmark cold force indexing on a large repository and compare pre-index time, total time, CPU, memory, and responsiveness.
5. Rollback: set concurrency to `1` or disable the new path to restore sequential behavior without changing persisted snapshots or Milvus collections.

## Open Questions

- What default concurrency gives the best balance on this workstation: 8, 16, or CPU-count bounded?
- Should cold force indexing be allowed to defer merkle snapshot hashing until after embedding starts, or must the snapshot be complete before indexing begins?
- Should worker-thread hashing be included in the first implementation or only after benchmark evidence from the bounded I/O queue?
