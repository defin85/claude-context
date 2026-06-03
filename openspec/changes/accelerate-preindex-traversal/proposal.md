## Why

Large initial and force indexing runs spend several minutes before embedding starts because the pre-index phase performs cold filesystem traversal, ignore matching, hashing, and file-list discovery sequentially. This leaves BGE-M3 sidecars and GPU capacity idle while one Node.js thread is saturated.

## What Changes

- Add a bounded-concurrency pre-index traversal path for directory walking, supported-extension filtering, ignore matching, and file hashing.
- Reuse pre-index traversal results for both synchronizer state and the indexer file list so cold initial/force indexing avoids duplicate full-tree walks.
- Compile or cache ignore-pattern matching work so each candidate path does not rebuild equivalent glob logic repeatedly.
- Preserve existing synchronizer snapshots and change detection semantics for incremental sync.
- Add configuration for pre-index concurrency with conservative defaults suitable for normal MCP/Codex operation.
- Add instrumentation for pre-index scan/hash/list phases so indexing status can distinguish pre-index time from split, embed, and insert time.
- Non-goals: no Rust/native rewrite in this change, no retrieval-quality or embedding-model changes, no change to Milvus collection schema, and no change to search result semantics.

## Capabilities

### New Capabilities

- `preindex-traversal`: Covers bounded-parallel pre-index filesystem traversal, synchronizer snapshot generation, file-list reuse, and observability for initial and force indexing.

### Modified Capabilities

- None.

## Impact

- Affected code: `packages/core/src/sync/synchronizer.ts`, `packages/core/src/context.ts`, ignore-pattern matching helpers, and accelerator/indexing status snapshots.
- Affected APIs: internal core APIs may expose a reusable pre-index file snapshot/result; MCP tool input/output should remain backward compatible.
- Migration impact: existing indexed collections and Milvus schemas do not need migration. Existing merkle snapshots remain valid; the new traversal path must be able to read old snapshots and write compatible snapshot data.
- Operational impact: initial and force indexing should begin embedding sooner and use configured BGE-M3 worker capacity more consistently. Defaults must avoid exhausting disk I/O, CPU, or memory on normal interactive Codex/MCP sessions.
