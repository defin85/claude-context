## Why

The web dashboard currently rebuilds the whole application root during periodic status refreshes. During active indexing this can happen every few seconds and clears normal text selection in results, logs, paths, and diagnostics.

## What Changes

- Replace the single full-root dashboard render path with stable section containers for metrics, codebase list, operations, worker telemetry, operator log, profile diagnostics, search controls, and search results.
- Track section-level fingerprints during refresh so unchanged sections keep their existing DOM nodes.
- Update frequently changing status sections independently during polling while leaving search results, logs, and diagnostic text untouched when their content has not changed.
- Preserve text selection in selectable content areas whenever the selected text belongs to an unchanged section.
- Keep the current lightweight TypeScript and `innerHTML` section-template approach.
- Non-goals:
  - Do not introduce React, Svelte, or another UI framework.
  - Do not change dashboard API response shapes or daemon polling behavior.
  - Do not change indexed collections, search ranking, indexing behavior, or MCP tool contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: Dashboard refresh rendering must preserve unchanged section DOM instead of replacing the entire application root on every status update.

## Impact

- Affected code:
  - `packages/web-dashboard/src/main.ts`
  - focused dashboard tests under `packages/web-dashboard/src`
- APIs and dependencies:
  - No API changes.
  - No new runtime dependency.
- Migration impact:
  - Existing indexed collections and daemon state are unaffected.
  - Existing dashboard URLs, authentication, polling interval, and backend routes remain unchanged.
