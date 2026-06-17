## 1. Search Contract

- [ ] 1.1 Inspect dashboard search structured content and result metadata shapes.
- [ ] 1.2 Add frontend types for extension filters, ranking profile, retrieval context, and result diagnostics.
- [ ] 1.3 Add tests for extension filters, ranking profile forwarding, and not-indexed errors.

## 2. Search UI

- [ ] 2.1 Add extension filter input.
- [ ] 2.2 Add ranking profile selector.
- [ ] 2.3 Display retrieval profile, retrieval mode, schema version, and 1C scope profile.
- [ ] 2.4 Render result diagnostics in expandable details.
- [ ] 2.5 Add copy-location and copy-snippet actions.
- [ ] 2.6 Keep unindexed search as an error state without implicit indexing.

## 3. Validation

- [ ] 3.1 Run frontend typecheck and build.
- [ ] 3.2 Run dashboard API tests for search.
- [ ] 3.3 Smoke-test search with indexed and unindexed codebases.
- [ ] 3.4 Run `pnpm exec openspec validate add-dashboard-search-diagnostics --strict`.
