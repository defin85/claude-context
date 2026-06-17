## Why

The dashboard search view can submit queries and show results, but it does not yet help operators understand why a result ranked highly or whether the selected retrieval/ranking mode matches the codebase. Search diagnostics will make ranking and retrieval behavior inspectable from the UI.

## What Changes

- Add search controls for extension filters and ranking profile selection.
- Display selected codebase retrieval profile, retrieval mode, schema version, and 1C scope profile near search controls.
- Show search result metadata such as source path, line range, language, score, retrieval sources, ranking profile, and score breakdown when available.
- Add copy actions for `relativePath:startLine` and result snippets.
- Preserve the current behavior that search does not implicitly start indexing.
- Non-goals:
  - Do not change ranking algorithms.
  - Do not add a file browser or editor.
  - Do not expose raw vector payloads.
  - Do not require re-indexing.

## Capabilities

### New Capabilities
- `dashboard-search-diagnostics`: Defines dashboard search filters, ranking profile selection, retrieval mode visibility, and result diagnostics.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/web-dashboard`: search controls, result rendering, copy actions, diagnostics UI.
  - `packages/mcp`: dashboard search API typing only if current search structured content needs normalization.
- Runtime impact:
  - Search uses existing `search_code` behavior.
  - Existing collections remain compatible.
