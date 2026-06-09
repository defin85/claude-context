## Why

Large 1C configurations include many files that are expensive to index and may have lower search value for common developer workflows. Runtime optimization alone cannot beat the cost of indexing unnecessary chunks. A 1C-aware scope profile gives operators an explicit way to trade coverage for speed while preserving full indexing as the default-safe option.

## What Changes

- Add optional 1C indexing scope profiles such as `full`, `developer`, and `minimal`.
- Classify 1C configuration paths by metadata/object/module role using path conventions.
- Allow profile-based includes/excludes before splitting and embedding.
- Persist the selected scope profile with indexing status.
- Document coverage tradeoffs and require explicit profile selection for reduced scopes.

Non-goals:

- Do not silently skip files under the existing default.
- Do not change retrieval ranking.
- Do not depend on EDT or Designer being installed.

## Capabilities

### New Capabilities

- `1c-indexing-scope-profiles`: Covers explicit 1C-aware file-scope profiles, filtering rules, persistence, status, and verification.

### Modified Capabilities

- `preindex-traversal`: Adds profile-aware filtering before split/embedding for recognized 1C configuration trees.

## Impact

- Affected code:
  - `packages/core`: file discovery/preindex traversal, 1C path classification, tests.
  - `packages/mcp`: optional per-indexing scope input, config/status exposure.
  - Docs and benchmark harness.
- Runtime impact:
  - Lower file/chunk count when reduced profiles are selected.
  - Search results become intentionally scoped.
- Sequence:
  - Step 5 of the throughput series. Should follow pipeline-level optimization so remaining performance problems are not confused with deliberate coverage reduction.
