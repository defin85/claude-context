# Verification

## Commands

- `pnpm --filter @zilliz/claude-context-core test -- one-c-scope.test.ts`
  - Pass: 1 suite, 4 tests.
- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/one-c-scope-profile.test.ts`
  - Pass: 4 tests.
- `pnpm --filter @zilliz/claude-context-core test`
  - Pass: 8 suites, 86 tests.
- `pnpm lint`
  - Pass with existing workspace warnings.
- `pnpm typecheck`
  - Pass.
- `pnpm build`
  - Pass. Chrome extension build reports existing asset-size warnings for icon PNGs.
- `pnpm --filter @zilliz/claude-context-mcp build`
  - Pass after the final MCP status-warning test change.
- `pnpm exec openspec validate indexing-perf-05-add-1c-indexing-scope-profiles --strict`
  - Pass: change is valid.
- `node scripts/measure-indexing-baseline.js --self-test-compact-output`
  - Pass.
- `node scripts/measure-indexing-baseline.js --help | rg -- '--one-c-index-scope-profile|1C_INDEX_SCOPE_PROFILE'`
  - Pass: benchmark script exposes the 1C scope profile option.

## Traversal Counts

Command:

```bash
node --input-type=module -e "import { traversePreIndex } from './packages/core/dist/index.js'; const roots=['examples/demo-1c','examples/demo-do30-1c']; for (const root of roots) { for (const profile of ['full','developer','minimal']) { const r=await traversePreIndex(root,{supportedExtensions:['.bsl','.xml','.html','.md'], diagnostics:true, oneCIndexScopeProfile:profile}); const s=r.diagnostics?.oneCIndexScope; console.log(JSON.stringify({root,profile,files:r.files.length,included:s?.includedFiles,excluded:s?.excludedFiles,recognized:s?.recognized,active:s?.active,includedByReason:s?.includedByReason,excludedByReason:s?.excludedByReason})); } }"
```

Results:

| Fixture | Profile | Files | Included | Excluded |
|---------|---------|------:|---------:|---------:|
| `examples/demo-1c` | `full` | 811 | 811 | 0 |
| `examples/demo-1c` | `developer` | 362 | 362 | 449 |
| `examples/demo-1c` | `minimal` | 129 | 129 | 682 |
| `examples/demo-do30-1c` | `full` | 22837 | 22837 | 0 |
| `examples/demo-do30-1c` | `developer` | 11655 | 11655 | 11182 |
| `examples/demo-do30-1c` | `minimal` | 6595 | 6595 | 16242 |

## Benchmark

Artifact:

- `.artifacts/indexing-perf-05/demo-do30-traversal-benchmark.json`

Benchmark scope:

- `traversePreIndex` only, no embedding/vector writes.
- Fixture: `examples/demo-do30-1c`.
- Supported extensions: `.bsl`, `.xml`, `.html`, `.md`.
- Iterations: 5 per profile.

Summary:

| Profile | Median traversal ms | Min ms | Max ms | Files |
|---------|--------------------:|-------:|-------:|------:|
| `full` | 791.98 | 668.90 | 990.26 | 22837 |
| `developer` | 351.04 | 345.82 | 555.98 | 11655 |

Live embedding/vector benchmark was not run in this verification pass because it depends on the live daemon/vector/embedding service state and would be substantially more expensive than the required pre-split scope comparison. The benchmark harness now records `oneCIndexScopeProfile` and can run full live indexing with `--one-c-index-scope-profile full|developer|minimal`.

## Notes

- Reduced 1C scope profiles are explicit through `1C_INDEX_SCOPE_PROFILE` or MCP `oneCIndexScopeProfile`.
- Existing indexes with no persisted scope are treated as `full`.
- `get_indexing_status` and `search_code` include reduced-coverage warning fields when the persisted profile is `developer` or `minimal`.
