# Verification

## 2026-06-16

Implemented retrieval performance profile plumbing through core, MCP config,
per-codebase persistence, status output, and documentation.

Commands run:

```bash
pnpm --filter @zilliz/claude-context-core test -- retrieval-profile.test.ts --runInBand
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts
pnpm --filter @zilliz/claude-context-core test -- context.retrieval-mode.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core build
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/one-c-scope-profile.test.ts
pnpm --filter @zilliz/claude-context-core typecheck
pnpm --filter @zilliz/claude-context-mcp typecheck
pnpm --filter @zilliz/claude-context-core build
pnpm --filter @zilliz/claude-context-mcp build
pnpm --filter @zilliz/claude-context-core test -- retrieval-profile.test.ts context.retrieval-mode.test.ts --runInBand
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts src/one-c-scope-profile.test.ts
pnpm exec openspec validate retrieval-performance-profiles --strict
```

Results:

- Core resolver tests passed: 5 tests in `retrieval-profile.test.ts`.
- Core retrieval-mode tests passed: 12 tests in `context.retrieval-mode.test.ts`.
- Combined targeted core run passed: 17 tests across resolver and context tests.
- MCP config tests passed: 5 tests in `config.test.ts`.
- MCP handler/codebase-config tests passed: 13 tests in `one-c-scope-profile.test.ts`.
- Combined targeted MCP run passed: 18 tests across config and handler/codebase-config tests.
- Core and MCP typechecks passed.
- Core and MCP builds passed.
- `openspec validate retrieval-performance-profiles --strict` passed.
- Small-repository smoke passed:
  - `fast`: `retrievalProfile=fast`, `retrievalMode=bge_m3_dense`,
    `retrievalSchemaVersion=1`, collection
    `bge_m3_dense_code_chunks_72d57a29`, `indexedFiles=1`,
    `totalChunks=1`, insert counts `regular=1`, `hybrid=0`, `bgeM3=0`,
    `rowCount=1`, `searchStatus=ok`, first result `index.ts`.
  - `quality`: `retrievalProfile=quality`, `retrievalMode=bge_m3_full`,
    `retrievalSchemaVersion=1`, collection `bge_m3_code_chunks_6363a534`,
    `indexedFiles=1`, `totalChunks=1`, insert counts `regular=0`,
    `hybrid=0`, `bgeM3=1`, `rowCount=1`, `searchStatus=ok`, first result
    `index.ts`.

Final rerun after the last handler and verification updates:

```bash
pnpm --filter @zilliz/claude-context-core test -- retrieval-profile.test.ts context.retrieval-mode.test.ts --runInBand
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts src/one-c-scope-profile.test.ts
pnpm --filter @zilliz/claude-context-core typecheck
pnpm --filter @zilliz/claude-context-mcp typecheck
pnpm --filter @zilliz/claude-context-core build
pnpm --filter @zilliz/claude-context-mcp build
pnpm exec openspec validate retrieval-performance-profiles --strict
```

Final rerun results:

- Core targeted tests passed: 17 tests across 2 suites.
- MCP targeted tests passed: 18 tests, 0 failed.
- Core and MCP typechecks passed.
- Core and MCP builds passed.
- `openspec validate retrieval-performance-profiles --strict` passed.

## 2026-06-16 Review Closure

Closed the post-review mandatory gaps:

- Legacy persisted configs with `retrievalMode` and `retrievalSchemaVersion` but
  no `retrievalProfile` now infer the profile from the persisted retrieval mode
  before applying the daemon default profile.
- Explicit `BGE_M3_STORE_COLBERT=true` now conflicts with BGE-M3 dense-only
  retrieval profiles (`fast` and `balanced`) instead of being silently
  normalized to `false`.

TDD red checks:

```bash
pnpm --filter @zilliz/claude-context-core test -- retrieval-profile.test.ts context.retrieval-mode.test.ts --runInBand
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts
```

Expected failures were observed before implementation:

- `context.retrieval-mode.test.ts`: legacy persisted `bge_m3_full` config was
  resolved as `fast` / `bge_m3_dense`.
- `retrieval-profile.test.ts` and `config.test.ts`: explicit
  `BGE_M3_STORE_COLBERT=true` with `RETRIEVAL_PROFILE=fast` did not throw.

Final verification:

```bash
pnpm --filter @zilliz/claude-context-core test -- retrieval-profile.test.ts context.retrieval-mode.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core typecheck
pnpm build:core
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts src/one-c-scope-profile.test.ts
pnpm --filter @zilliz/claude-context-mcp typecheck
pnpm --filter @zilliz/claude-context-mcp build
pnpm exec openspec validate retrieval-performance-profiles --strict
```

Final verification results:

- Core targeted tests passed: 18 tests across 2 suites.
- Core typecheck passed.
- Core build passed.
- MCP targeted tests passed: 18 tests, 0 failed.
- MCP typecheck passed.
- MCP build passed.
- `openspec validate retrieval-performance-profiles --strict` passed.

## 2026-06-16 Finish To 100 Closure

Closed the final review blocker for `Incompatible profile without force`:

- `index_codebase` now rejects incompatible retrieval profile changes from the
  persisted per-codebase config even when the local snapshot entry is missing.
  The synchronous MCP response reports `force=true` instead of starting a
  background job that later fails during collection preparation.

TDD red check:

```bash
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/one-c-scope-profile.test.ts
```

Expected failure before implementation:

- `index_codebase rejects incompatible retrieval profile when snapshot is missing`
  returned a started background indexing response (`isError` was undefined)
  instead of the expected `forceRequired=true` error.

Green check after implementation:

```bash
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/one-c-scope-profile.test.ts
```

Result:

- MCP handler/codebase-config tests passed: 14 tests, 0 failed.
