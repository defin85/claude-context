## Context

The current pre-index phase walks the repository, applies ignore and extension filters, orders selected files, and hashes selected content before embedding/indexing begins. On the large 1C repository `bp-unicom-sdd`, the measured first-pass cost is dominated by this pre-index phase even though only 18,686 files are selected from a tree containing many more XML, HTML, and ST files.

The existing metrics show aggregate timings such as traversal and hashing, but they are not enough to explain whether time is spent in directory walking, ignore matching, path normalization, unsupported file processing, queue scheduling, hashing, or ordering. This change adds observability only; it deliberately avoids changing traversal behavior.

## Goals / Non-Goals

**Goals:**
- Capture enough structured metrics to identify real pre-index traversal hotspots.
- Make benchmark runs reproducible against the same effective ignore and extension configuration used by normal indexing.
- Keep diagnostic output suitable for comparing multiple runs and concurrency settings.
- Preserve exact selected-file behavior, including selected paths, order, and hashes.

**Non-Goals:**
- Optimizing traversal performance.
- Adding a native/Rust helper.
- Changing default indexed extensions or ignore policies.
- Changing embedding, Milvus writes, search behavior, or collection schemas.

## Decisions

1. Extend the existing traversal diagnostics instead of adding a separate walker.
   - Rationale: diagnostics must describe the same code path used by indexing.
   - Alternative considered: standalone benchmark-only traversal. That would be easier to instrument but could drift from production behavior.

2. Measure counters and timings at decision boundaries.
   - The diagnostics will include directory entries visited, files seen, unsupported files by extension, ignored entries, matcher calls, matcher time, selected files, hashed files, hash bytes, queue/concurrency activity, and elapsed timings for scan, filtering, hashing, and ordering.
   - Rationale: these categories separate filesystem work, matcher CPU work, unsupported-entry overhead, and selected-file hashing.

3. Load effective indexing configuration in the benchmark command.
   - The benchmark must be able to run with the same ignore patterns, extension filters, and accelerator settings as `index_codebase`.
   - Rationale: prior one-off diagnostics are useful but easy to misconfigure. This change makes the comparison path repeatable.

4. Emit structured JSON/NDJSON diagnostics.
   - Rationale: repeated runs need machine-readable comparison, not only log lines.
   - Alternative considered: human-only logs. That is insufficient for before/after regression checks.

## Risks / Trade-offs

- Instrumentation overhead could distort short runs -> keep expensive timers optional or aggregated, and compare diagnostic runs against normal pre-index elapsed time.
- Metrics could become noisy across cold/warm OS cache states -> record run metadata and compare multiple runs with the same command.
- Additional diagnostic fields could clutter logs -> keep detailed dumps behind explicit diagnostics mode while preserving a concise summary in normal logs.
- Incorrect config loading could benchmark the wrong file set -> include selected-file count and optional selected-path fingerprint so benchmark runs can be validated.
