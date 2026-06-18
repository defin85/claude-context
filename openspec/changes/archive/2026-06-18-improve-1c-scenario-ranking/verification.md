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
- `node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/raw-results.json --dataset evaluation/retrieval/demo-do30-1c-scenarios.json --baseline .artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30/summary.json --out .artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/summary.json --compare-out .artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/comparison.json --markdown-out .artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/summary.md --label-validation-out .artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/label-validation.json --validate-labels-against examples/demo-do30-1c --ranking-profile one-c --codebase-path examples/demo-do30-1c --strict-hit-at1-threshold 18 --strict-hit-at5-threshold 24 --baseline-mode non-regression`
  - Result: baseline Hit@10 `20/30`, tuned Hit@10 `24/30`, comparable `true`, improvements `7`, regressions `0`.
  - Comparison artifact: `.artifacts/hybrid-code-symbol-retrieval/2026-06-16T-improve-1c-scenario-ranking-demo-do30-final/comparison.json`.

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
