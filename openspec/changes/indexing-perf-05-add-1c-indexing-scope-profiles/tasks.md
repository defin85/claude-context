## 1. Scope Contract

- [ ] 1.1 Define `1C_INDEX_SCOPE_PROFILE` values `full`, `developer`, and `minimal`.
- [ ] 1.2 Define path-based include/exclude rules for each profile.
- [ ] 1.3 Decide whether per-call MCP override is supported in the first version.
- [ ] 1.4 Add documentation for coverage tradeoffs and expected use cases.

## 2. Traversal Integration

- [ ] 2.1 Add 1C exported-configuration detection based on stable path conventions.
- [ ] 2.2 Apply scope filtering before splitting and embedding.
- [ ] 2.3 Record include/exclude counts by reason.
- [ ] 2.4 Preserve default full traversal for existing users and non-1C repositories.

## 3. Persistence and Compatibility

- [ ] 3.1 Persist selected 1C scope profile with codebase index metadata.
- [ ] 3.2 Expose scope profile and reduced-coverage warning in indexing/search status.
- [ ] 3.3 Reject incompatible scope changes without `force=true`.
- [ ] 3.4 Add tests for full-to-reduced and reduced-to-full compatibility behavior.

## 4. Verification

- [ ] 4.1 Add unit tests for 1C path classification and profile filters.
- [ ] 4.2 Run `examples/demo-1c` and `examples/demo-do30-1c` traversal counts for all profiles without embedding first.
- [ ] 4.3 Benchmark at least `full` versus `developer` scope on `examples/demo-do30-1c`.
- [ ] 4.4 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [ ] 4.5 Run `pnpm exec openspec validate indexing-perf-05-add-1c-indexing-scope-profiles --strict`.
