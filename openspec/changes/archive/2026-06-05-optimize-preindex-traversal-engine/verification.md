## Verification

### Commands

- `pnpm --filter @zilliz/claude-context-core typecheck`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-core test -- context.ignore-patterns.test.ts --runInBand`
  - Result: passed with exit code 0 after making `AstCodeSplitter` load the native tree-sitter splitter only when AST splitting is actually used.
- `node -e "require('./packages/core/dist/splitter'); console.log('splitter ok')" && node -e "require('./packages/core/dist'); console.log('core ok')"`
  - Result: passed with exit code 0; import-only paths no longer trigger native tree-sitter teardown.
- `pnpm --filter @zilliz/claude-context-core test`
  - Result: passed; 6 suites and 46 tests completed with exit code 0 and no post-PASS native teardown crash.
- `pnpm --filter @zilliz/claude-context-core build`
  - Result: passed.
- `node scripts/preindex-diagnostic.js <temp-fixture> --extensions .ts --engine native --concurrency 1 --json`
  - Result: passed; reported `requestedEngine=native`, `engine=ts`, and a fallback reason.
- `node scripts/preindex-diagnostic.js /run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd --concurrency 8 --repeat 3 --json`
  - Raw JSON saved during this run at `/tmp/optimize-preindex-traversal-engine-bp-unicom-sdd-final-ts-layer.json`.
- `pnpm lint && pnpm build && pnpm typecheck`
  - Result: passed. Lint still reports existing warnings; no lint errors.

### Compatibility

The optimized matcher is covered by a fixture harness that compares traversal output against a baseline implementation of the previous ignore algorithm. Coverage includes:
- directory ignores,
- file ignores,
- root-anchored patterns,
- glob patterns,
- hidden paths,
- unsupported extensions,
- stable ordering,
- current negation-pattern behavior.

Selected paths and hashes match the baseline fixture output.

### Large 1C Benchmark

Target: `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd`

Recorded baseline from `profile-preindex-traversal-hotspots`:
- concurrency 8 totalMs: 70403
- selectedPathFingerprint: `300f3a0fa4b5e478b729a21e87b7dfcc1f821097348750f080cc4321978c2689`
- selectedPathHashFingerprint: `084a73158fef4c3371d457bb5c059f5c93a085d28c556522772263c20568ea1e`

Optimized TypeScript traversal, concurrency 8, repeat 3:
- totals: 34145, 34528, 34682
- median: 34528
- improvement vs baseline: 50.96 percent
- improvement vs the first optimized median of 42696: 19.13 percent
- selectedFileCount: 18686
- hashedFileCount: 18686
- selectedPathFingerprint: `300f3a0fa4b5e478b729a21e87b7dfcc1f821097348750f080cc4321978c2689`
- selectedPathHashFingerprint: `084a73158fef4c3371d457bb5c059f5c93a085d28c556522772263c20568ea1e`
- matcherMs values: 26094, 25784, 26185
- matcherPatternEvaluations: 22116730 for each run
- matcherCacheHits: 494226 for each run
- matcherCacheMisses: 65165 for each run

### Native Engine Decision

The TypeScript optimization exceeded the 25 percent acceptance threshold, so no Rust/native helper was added in this change. The traversal engine selection path still accepts `native` and `auto` requests and safely falls back to TypeScript traversal with an explicit fallback reason.

### Migration

No vector database schema, collection naming, embedding input format, or search behavior changed. The benchmark preserved selected path and selected path+hash fingerprints, so unchanged selected files remain unchanged to the existing indexing pipeline.
