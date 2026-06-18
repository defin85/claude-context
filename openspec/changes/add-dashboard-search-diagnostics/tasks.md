## 1. Search Contract

- [x] 1.1 Inspect dashboard search structured content and result metadata shapes.
- [x] 1.2 Add frontend types for extension filters, ranking profile, retrieval context, and result diagnostics.
- [x] 1.3 Add tests for extension filters, ranking profile forwarding, and not-indexed errors.

## 2. Search UI

- [x] 2.1 Add extension filter input.
- [x] 2.2 Add ranking profile selector.
- [x] 2.3 Display retrieval profile, retrieval mode, schema version, and 1C scope profile.
- [x] 2.4 Render result diagnostics in expandable details.
- [x] 2.5 Add copy-location and copy-snippet actions.
- [x] 2.6 Keep unindexed search as an error state without implicit indexing.

## 3. Validation

- [x] 3.1 Run frontend typecheck and build.
- [x] 3.2 Run dashboard API tests for search.
- [x] 3.3 Smoke-test search with indexed and unindexed codebases.
- [x] 3.4 Run `pnpm exec openspec validate add-dashboard-search-diagnostics --strict`.
