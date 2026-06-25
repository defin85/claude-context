## 1. MCP Profile State Contract

- [x] 1.1 Add shared TypeScript types for daemon, codebase, and search `profileState` in `packages/mcp/src`.
- [x] 1.2 Implement daemon profile-state builder from resolved retrieval configuration, provider shape flags, accelerator, and worker planning snapshots.
- [x] 1.3 Implement codebase profile-state builder from persisted codebase config, snapshot metadata, 1C scope status, RLM BSL enrichment status, and current daemon defaults.
- [x] 1.4 Implement search profile-state builder that records requested ranking profile, resolved ranking profile when available, and 1C ranking-signal activation without persisting search-time state.
- [x] 1.5 Ensure all profile-state builders redact raw commands, credentials, tokens, and secret environment values.

## 2. MCP Response Integration

- [x] 2.1 Add `profileState.daemon` to daemon status structured content while preserving existing `retrievalConfiguration`.
- [x] 2.2 Add `profileState.codebase` to `get_indexing_status` structured content for indexed, indexing, not-indexed, and metadata-recovered states.
- [x] 2.3 Add `profileState.search` to `search_code` and dashboard search responses while preserving existing `rankingProfile` and retrieval context fields.
- [x] 2.4 Classify retrieval profile differences between current daemon defaults and persisted codebase state without marking the existing index invalid solely because defaults differ.
- [x] 2.5 Return `unknown` or `inferred` profile states for older indexes with incomplete metadata instead of failing status rendering.

## 3. Dashboard Rendering

- [x] 3.1 Extend dashboard response types and state to accept `profileState` from daemon status, selected-codebase status, and search results.
- [x] 3.2 Add a compact profile-state section that separates daemon defaults, selected repository state, and latest-search state.
- [x] 3.3 Render mismatch, reduced 1C coverage, RLM BSL enrichment, and unknown metadata states using server-provided classifications.
- [x] 3.4 Keep fallback rendering from existing retrieval, ranking, 1C scope, and enrichment fields when `profileState` is absent.
- [x] 3.5 Replace mixed-language profile labels in the affected dashboard surface with clear operator-facing labels while preserving exact mode identifiers.

## 4. Tests and Verification

- [x] 4.1 Add MCP unit tests for daemon profile state, including dense-only BGE-M3 and full BGE-M3 dense+sparse+ColBERT cases.
- [x] 4.2 Add MCP unit tests for codebase profile state with matching profile, daemon-default mismatch, missing metadata, reduced 1C scope, and RLM BSL enrichment states.
- [x] 4.3 Add MCP or dashboard API tests proving search profile state reports requested and resolved ranking profile without changing persisted codebase config.
- [x] 4.4 Add web-dashboard tests for profile-state rendering and fallback behavior.
- [x] 4.5 Run `pnpm --filter @zilliz/claude-context-mcp test`, `pnpm --filter @zilliz/claude-context-mcp typecheck`, and the relevant web-dashboard test or typecheck commands.

## 5. Documentation and OpenSpec Validation

- [x] 5.1 Update operator documentation if response examples, dashboard labels, or profile-state troubleshooting guidance change.
- [x] 5.2 Run `openspec validate add-dashboard-profile-state --strict` and fix any proposal/spec/task drift.
- [x] 5.3 Record verification commands and outcomes in the change notes or implementation summary.
