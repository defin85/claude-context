## Verification

### Focused checks

- `node --test scripts/run-demo-1c-relevance-eval.test.js`
  - Result: 17 passed.
- `pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts`
  - Result: 38 passed.
- `node --check scripts/run-demo-do30-1c-live-mcp-eval.js && node --check scripts/run-demo-1c-live-mcp-eval.js`
  - Result: passed.

### Live relevance runs

- `node scripts/run-demo-1c-live-mcp-eval.js --run-name 2026-06-16T-improve-1c-scenario-ranking-demo-1c --acceptance-threshold 24 --ranking-profile one-c`
  - Result: `hitAt10Count=30/30`, `toolErrors=0`, `missingColbertErrors=0`.
  - Artifacts: `.artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-1c/`.
- `node scripts/run-demo-do30-1c-live-mcp-eval.js --run-name 2026-06-16T-improve-1c-scenario-ranking-demo-do30-final`
  - Result: strict Top-1 `21/30`, strict Top-5 `24/30`, strict Top-10 `24/30`, acceptable Top-1 `22/30`, `toolErrors=0`, `missingColbertErrors=0`.
  - Artifacts: `.artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/`.

### Final checks

- `pnpm build:core`
  - Result: passed.
- `pnpm typecheck`
  - Result: passed.
- `pnpm lint`
  - Result: passed without warnings.
- `pnpm build`
  - Result: passed without warnings.
- `openspec validate --type change improve-1c-scenario-ranking --strict`
  - Result: passed.
