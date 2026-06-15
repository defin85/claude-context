## 1. Contract And Profile Resolution

- [x] 1.1 Add a typed ranking profile enum or union with values `auto`, `generic`, and `one-c`.
- [x] 1.2 Add profile parsing and validation helpers with clear errors for invalid values.
- [x] 1.3 Define precedence: explicit search-time profile, explicitly persisted codebase default if available, then `auto`.
- [x] 1.4 Ensure omitted profile preserves current behavior for existing callers.
- [x] 1.5 Ensure no profile is inferred and persisted silently from path shape, index scope, query text, or previous search results.

## 2. Core Retrieval Implementation

- [x] 2.1 Extend `Context.semanticSearch` or its options object to accept `rankingProfile` without breaking existing call sites.
- [x] 2.2 Pass the resolved profile into `fuseCodeSearchResults` and 1C signal scoring.
- [x] 2.3 Make 1C object-kind, object-name, and intent boosts return zero under `generic`.
- [x] 2.4 Keep `one-c` eligible for bounded 1C boosts on recognized 1C exported-configuration paths.
- [x] 2.5 Keep `auto` behavior compatible with current path-based detection.
- [x] 2.6 Add resolved `rankingProfile` to compact diagnostics or result metadata without exposing vector payloads.

## 3. MCP And Configuration Wiring

- [x] 3.1 Add `rankingProfile` to the MCP `search_code` input schema with enum values `auto`, `generic`, and `one-c`.
- [x] 3.2 Validate `rankingProfile` in the search handler and return a clear error for invalid values.
- [x] 3.3 Pass the resolved profile from `search_code` into core retrieval.
- [x] 3.4 Leave persisted codebase default profile out of this implementation because there is no explicit configuration operation; keep search-time override without index schema changes or reindexing.
- [x] 3.5 Keep `rankingProfile` independent from `oneCIndexScopeProfile` in handler logic, messages, and diagnostics.

## 4. Evaluation And Scripts

- [x] 4.1 Add `--ranking-profile` to `scripts/run-demo-1c-live-mcp-eval.js` and pass `one-c` in 1C live acceptance commands.
- [x] 4.2 Record the profile used in raw JSON, scored JSON, comparison JSON, and Markdown reports.
- [x] 4.3 Add scorer tests proving profile metadata is preserved in reports.
- [x] 4.4 Ensure residual-query reporting and assertions remain evaluation-only and do not become production ranking inputs.

## 5. Regression Tests

- [x] 5.1 Add core tests proving non-1C paths such as `src/Documents/Foo.ts`, `src/Catalogs/Product.ts`, and `src/Reports/Sales.ts` receive no 1C boosts under `generic`.
- [x] 5.2 Add core tests proving `one-c` still applies bounded 1C boosts for recognized exported 1C paths.
- [x] 5.3 Add core tests proving omitted profile or `auto` preserves current behavior.
- [x] 5.4 Add MCP tests proving valid profile values are accepted and invalid values fail cleanly.
- [x] 5.5 Add tests proving exact-symbol and provider-backed ordering remains stable under `generic`.

## 6. Automated Verification

- [x] 6.1 Run `node --test scripts/run-demo-1c-relevance-eval.test.js`.
- [x] 6.2 Run focused core code-symbol retrieval tests.
- [x] 6.3 Run focused MCP handler or schema tests for `search_code`.
- [x] 6.4 Run `pnpm --filter @zilliz/claude-context-core typecheck`.
- [x] 6.5 Run `pnpm --filter @zilliz/claude-context-core lint`.
- [x] 6.6 Run `pnpm build:core`.
- [x] 6.7 Run `git diff --check`.
- [x] 6.8 Run `openspec validate add-retrieval-ranking-profiles --strict`.

## 7. Live And Compatibility Validation

- [x] 7.1 Run the `examples/demo-1c` live MCP relevance set with `rankingProfile=one-c` and compare against the current accepted baseline.
- [x] 7.2 Run or simulate a generic non-1C search with misleading path segments using `rankingProfile=generic` and verify no 1C boosts appear.
- [x] 7.3 Confirm existing live or scripted calls that omit `rankingProfile` still behave as `auto`.
- [x] 7.4 Save relevant raw JSON, scored JSON, Markdown, comparison, and diagnostics artifacts.

## 8. Finalization

- [x] 8.1 Update documentation or examples that describe 1C live retrieval validation to pass `rankingProfile=one-c`.
- [x] 8.2 Create `verification.md` with commands, artifacts, final profile behavior, compatibility notes, and remaining risks.
- [x] 8.3 Update this checklist only after each task is actually verified.
- [x] 8.4 Do not prepare a commit until the user requests landing; implementation, tests, docs, artifacts references, and OpenSpec updates are ready for that step.
