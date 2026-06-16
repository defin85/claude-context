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
