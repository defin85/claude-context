## 1. Provider Contract

- [ ] 1.1 Define provider response and candidate schema in `rlm-tools-bsl` with a schema version constant.
- [ ] 1.2 Define documented provider status values such as `available`, `missing_index`, `stale`, `busy`, and `error`.
- [ ] 1.3 Add pure response-shaping helpers that convert method, object, and file lookup rows into provider candidates.
- [ ] 1.4 Include `sourceRoot`, capabilities, elapsed timings, and compact diagnostics in every provider response.

## 2. Query Implementation

- [ ] 2.1 Reuse existing `IndexReader.search_methods` and helper-level `search_methods` behavior for method candidates.
- [ ] 2.2 Reuse existing `search_objects` behavior for object and synonym candidates.
- [ ] 2.3 Reuse indexed file path lookup where available for path/module candidates.
- [ ] 2.4 Enforce bounded result limits per candidate kind and for the final merged candidate list.
- [ ] 2.5 Return structured missing/stale/error status without building, updating, dropping, or migrating indexes.

## 3. Transport

- [ ] 3.1 Add a machine-readable provider transport, preferably a CLI JSON command if it is the least invasive v1 integration point.
- [ ] 3.2 Ensure CLI JSON mode writes parseable JSON only to stdout.
- [ ] 3.3 Ensure warnings, tracebacks, and human-readable diagnostics do not corrupt stdout JSON.
- [ ] 3.4 Parse CLI inputs from argv arguments and never require shell-interpolated query/path strings.
- [ ] 3.5 If an MCP/server endpoint is added, make it return the same response schema as the CLI transport.

## 4. Tests

- [ ] 4.1 Add unit tests for provider response shaping from method, object, and file rows.
- [ ] 4.2 Add CLI/server transport tests proving successful output is parseable JSON.
- [ ] 4.3 Add tests for Cyrillic queries and paths with spaces.
- [ ] 4.4 Add tests for missing index, stale index, busy/error status, and query-only non-mutation behavior.
- [ ] 4.5 Add compatibility tests or assertions that existing `search_methods`, `search_objects`, and index management behavior remains unchanged.

## 5. Documentation and Integration Notes

- [ ] 5.1 Document the provider command or endpoint, request parameters, response schema, and status values.
- [ ] 5.2 Document that the provider API is query-only and never builds or updates indexes.
- [ ] 5.3 Add an example provider response for `ПараметрыЗаполненияЗаписейСкладскогоЖурнала`.
- [ ] 5.4 Document how `claude-context` should use `sourceRoot` plus `relativePath` for nested-root mapping.
- [ ] 5.5 Run the relevant `rlm-tools-bsl` test suite, for example `pytest`, after implementation.
