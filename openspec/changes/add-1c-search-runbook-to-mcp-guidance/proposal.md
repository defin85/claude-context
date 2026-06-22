## Why

The 1C semantic search runbook and scenario-matrix work showed that useful 1C answers usually require a small context bundle, not a single broad `search_code` hit. Today that knowledge lives in repo documentation and evaluations, but the MCP `search_code` guidance does not teach agents the generic 1C search workflow at tool-discovery time.

## What Changes

- Add concise agent-facing 1C search guidance to the MCP `search_code` tool description or adjacent MCP guidance.
- Document the generic 1C context-bundle workflow: start from the user task, then use focused searches for library API, client usage, server usage, applied usage, and metadata/state.
- Warn agents that some root XML metadata or configuration state may be outside indexed `search_code` coverage and may require checking index scope or filesystem context.
- Link MCP documentation to the universal 1C semantic search runbook without copying scenario-specific evaluation labels into runtime guidance.

Non-goals:

- No ranking, scoring, query rewriting, or provider behavior changes.
- No production use of scenario matrix labels, query IDs, expected path prefixes, or fixture answers.
- No new MCP request or response parameters.
- No dependency on `rlm-tools-bsl` for this guidance.
- No index migration, rebuild, or collection schema change.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `code-symbol-retrieval`: extend the MCP `search_code` agent-facing contract with generic 1C runbook guidance while preserving existing ranking-profile and evaluation-label boundaries.

## Impact

- Affected code: MCP `search_code` tool registration/description and related tests.
- Affected docs: `packages/mcp/README.md` or equivalent MCP-facing search documentation, with a pointer to `docs/dive-deep/one-c-semantic-search-runbook.md`.
- APIs: no request/response schema change.
- Dependencies: none.
- Existing indexed collections: no migration or rebuild required.
