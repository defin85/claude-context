## Context

Profile-related behavior is currently observable through separate response fragments:

- daemon status exposes the configured and resolved retrieval defaults;
- indexing status exposes persisted retrieval profile, retrieval mode, schema version, 1C scope, and RLM BSL enrichment when available;
- search responses expose the requested ranking profile and partial retrieval context;
- the dashboard formats these fields independently.

This makes operator interpretation fragile. A daemon can currently default to `fast` while a selected repository was indexed with `quality`; a repository can have reduced 1C coverage; and a search can use `generic` ranking against a 1C-scoped index. Those are valid states, but they need to be visible as different layers rather than collapsed into one label.

The design must distinguish dense-only BGE-M3 from full BGE-M3 dense+sparse+ColBERT because the storage cost, indexing latency, query latency, and quality expectations are different. Dense-only BGE-M3 keeps indexing and insert cost lower and avoids ColBERT storage. Full BGE-M3 stores additional sparse and ColBERT token vectors and enables late-interaction reranking, which improves quality in selected cases but increases storage and latency.

## Goals / Non-Goals

**Goals:**

- Provide one structured profile-state contract for daemon defaults, selected repository index-time state, and latest search-time state.
- Make the dashboard show profile state without reimplementing compatibility logic in the browser.
- Preserve backward compatibility for current MCP and dashboard response fields.
- Make mismatches explicit without treating them as errors unless existing indexing compatibility rules already do.
- Keep ranking profile visibly separate from retrieval profile and 1C indexing scope.
- Avoid exposing secret-bearing configuration values.

**Non-Goals:**

- Add new retrieval, ranking, 1C scope, or RLM enrichment modes.
- Reindex existing codebases automatically.
- Persist search-time `rankingProfile` as repository configuration.
- Replace existing status, search, or diagnostic response fields immediately.
- Add a new external dependency.

## Decisions

### Decision: Add a server-owned `profileState` contract

MCP status and search handlers will build a normalized `profileState` object. The web dashboard will render that object and use existing fields only as a fallback.

Alternative considered: let the dashboard infer profile state from existing fields. This would duplicate compatibility rules in TypeScript browser code and would make future MCP clients less consistent.

### Decision: Represent three scopes separately

`profileState` will contain separate sections:

- `daemon`: active defaults and runtime capability state;
- `codebase`: persisted index-time profile state for the selected repository;
- `search`: latest request-time ranking state when available.

This prevents a current daemon default from being mistaken for the profile used by an existing index. It also prevents `rankingProfile` from being shown as if it were persisted repository state.

### Decision: Use explicit status and compatibility labels

Profile fragments will include machine-readable states such as `effective`, `unknown`, `mismatch`, `requires-force`, `reduced-coverage`, `disabled`, `enabled`, `partial`, and `unavailable` where applicable.

The dashboard can then render neutral, warning, and degraded states without parsing prose.

### Decision: Preserve existing fields during migration

Existing top-level fields remain in place:

- daemon `retrievalConfiguration`;
- indexing status `retrievalProfile`, `retrievalMode`, `retrievalSchemaVersion`, `oneCIndexScopeProfile`, `oneCIndexScope`, and `rlmBslEnrichment`;
- search response `rankingProfile` and retrieval context fields.

`profileState` becomes the preferred structured source, but current clients remain compatible.

### Decision: Redact sources instead of exposing raw configuration

Profile state may expose non-secret source labels such as `environment`, `request`, `persisted-config`, `collection-metadata`, `default`, or `inferred`. It must not expose raw command lines, tokens, API keys, bearer tokens, or full environment dumps.

## Risks / Trade-offs

- **Risk: Operator confuses daemon defaults with persisted index state** -> Mitigation: separate dashboard sections and labels for daemon, repository, and latest search.
- **Risk: Older indexes lack profile metadata** -> Mitigation: emit `unknown` or `inferred` states and keep search/status working.
- **Risk: Browser-side logic drifts from MCP compatibility rules** -> Mitigation: build compatibility and mismatch labels in MCP.
- **Risk: Full BGE-M3 profile state implies quality but hides cost** -> Mitigation: show storage/search shape, including dense-only versus dense+sparse+ColBERT, and preserve existing retrieval documentation.
- **Risk: RLM BSL command configuration leaks implementation details** -> Mitigation: expose only mode, configured boolean, status, and non-secret diagnostics.

## Migration Plan

1. Add shared TypeScript types and builders for daemon, codebase, and search profile state in `packages/mcp/src`.
2. Add `profileState` to daemon status, indexing status, and search responses while preserving existing fields.
3. Update dashboard state and rendering to prefer `profileState`.
4. Add tests for old metadata, reduced 1C coverage, retrieval mismatch, and search ranking diagnostics.
5. Update documentation after implementation if operator labels or response examples change.

Rollback is straightforward: dashboard can fall back to existing fields, and MCP can continue returning existing response shapes even if `profileState` rendering is disabled.

## Open Questions

- Should `profileState.codebase.retrieval.compatibility` compare only against current daemon defaults, or also against an explicit pending indexing request when the dashboard form includes one?
- Should the dashboard remember the last search `profileState.search` across refreshes, or clear it when the selected repository changes?
