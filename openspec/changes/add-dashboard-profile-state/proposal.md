## Why

Operators cannot currently see a single, reliable view of the special profile state that affects indexing, search, and daemon behavior. Retrieval performance profiles, search ranking profiles, 1C indexing scope, RLM BSL enrichment, and daemon retrieval defaults are exposed in different places, so it is hard to tell whether a selected repository matches the current daemon defaults or was indexed with domain-specific flags.

## What Changes

- Add a structured profile-state contract that summarizes daemon defaults, selected repository index-time profiles, and latest search-time ranking profile state.
- Surface profile state in the web dashboard with clear separation between daemon defaults, persisted repository state, and latest search request state.
- Report compatibility signals for selected repositories, including retrieval profile mismatches, schema differences, reduced 1C coverage, and unavailable or partial RLM BSL enrichment state.
- Extend search diagnostics so the dashboard can show requested versus resolved ranking profile without treating ranking profile as a persisted repository setting.
- Preserve existing top-level status fields for compatibility while making the new `profileState` object the preferred dashboard source.
- Non-goals:
  - Do not introduce new retrieval, ranking, 1C scope, or enrichment modes.
  - Do not automatically reindex repositories when daemon defaults change.
  - Do not persist `rankingProfile` as a repository setting.
  - Do not expose command lines, credentials, tokens, or secret-bearing environment values in the dashboard.

## Capabilities

### New Capabilities

- `dashboard-profile-state`: Structured observability for daemon, repository, and latest-search profile state in MCP responses and the web dashboard.

### Modified Capabilities

- `web-dashboard`: The dashboard must render profile state for the daemon and selected repository, including mismatch and degraded-state indicators.
- `dashboard-search-diagnostics`: Search diagnostics must expose requested and resolved ranking profile state for dashboard display.
- `retrieval-performance-profiles`: Retrieval profile status must be represented in the unified profile-state contract for daemon defaults and persisted repository indexes.
- `code-symbol-retrieval`: Ranking profile observability must remain separate from 1C indexing scope while exposing resolved 1C-aware ranking behavior.

## Impact

- Affected code:
  - `packages/mcp/src` status handlers, search handlers, daemon status assembly, and related tests.
  - `packages/web-dashboard/src` dashboard state, rendering, and search diagnostics.
  - OpenSpec specs for dashboard, diagnostics, retrieval profiles, and symbol retrieval.
- API impact:
  - Adds structured `profileState` fields to MCP/dashboard responses.
  - Existing fields such as `retrievalConfiguration`, `retrievalProfile`, `rankingProfile`, `oneCIndexScopeProfile`, and `rlmBslEnrichment` remain available during migration.
- Migration impact:
  - Existing indexed collections remain valid.
  - Older collections without profile metadata must show `unknown` or inferred states rather than failing status rendering.
  - Reindexing is required only when existing retrieval-profile compatibility rules already require it; this change does not add a new migration requirement.
