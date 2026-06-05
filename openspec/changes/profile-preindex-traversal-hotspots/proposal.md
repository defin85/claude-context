## Why

The first cold pre-index pass on large 1C repositories still spends about a minute before useful indexing work starts. Recent measurements on `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd` showed roughly 69-72 seconds for selecting and hashing 18,686 supported files, while simple Node concurrency changes did not materially improve wall time.

We need a reliable, repo-local way to see where traversal time is going before making another optimization pass. Without that visibility, it is too easy to optimize hashing, ignore checks, or file filtering based on guesses instead of the real cold-path costs.

## What Changes

- Add detailed pre-index traversal diagnostics for the first pass:
  - directory entries visited,
  - files seen before support filtering,
  - unsupported files counted by extension,
  - ignored directories/files,
  - selected files,
  - hashed files and bytes,
  - matcher call counts and matcher timing,
  - traversal, selection, hashing, and ordering timings,
  - effective concurrency and queue activity.
- Add a diagnostic benchmark command or script that can run against an arbitrary codebase path using the same effective ignore and extension configuration as normal indexing.
- Emit diagnostics as structured JSON/NDJSON so runs can be compared across concurrency settings and implementation changes.
- Preserve existing indexing behavior: diagnostics must not change the selected file set, selected file order, hashes, embedding, or vector database writes.
- Make the diagnostics available from pre-index logs and accelerator/daemon status snapshots where practical.
- Non-goals:
  - no Rust or native traversal helper in this change,
  - no default ignore policy changes,
  - no change to which extensions are indexed,
  - no migration of existing indexed collections.

## Capabilities

### New Capabilities
- `preindex-traversal-observability`: diagnostics and benchmark behavior for measuring the first pre-index traversal pass.

### Modified Capabilities

## Impact

- Affected code: `packages/core` pre-index traversal, diagnostics/logging utilities, and benchmark or script entry points.
- Affected systems: MCP indexing logs and daemon/runtime status may include richer diagnostic fields.
- APIs: internal TypeScript diagnostic interfaces will be added or extended. Public MCP tool inputs should remain compatible.
- Existing indexed collections: no migration impact; collection names, schemas, payloads, and search behavior are unchanged.
