## Verification

Date: 2026-06-15

## Commands

- `pnpm --filter @zilliz/claude-context-core test -- --runTestsByPath src/context.code-symbol-retrieval.test.ts` - passed, 25 tests.
- `pnpm --filter @zilliz/claude-context-core typecheck` - passed.
- `pnpm build:core` - passed.
- `pnpm --filter @zilliz/claude-context-mcp typecheck` - passed.
- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/one-c-scope-profile.test.ts` - passed, 7 tests.
- `pnpm --filter @zilliz/claude-context-core lint` - passed with existing warnings.
- `pnpm --filter @zilliz/claude-context-mcp lint` - passed.
- `pnpm typecheck` - passed.
- `pnpm build:mcp` - passed.
- `node --check scripts/run-demo-1c-live-mcp-eval.js` - passed.
- `node --test scripts/run-demo-1c-relevance-eval.test.js` - passed, 9 tests.
- `node scripts/run-demo-1c-live-mcp-eval.js --ranking-profile one-c --run-name add-retrieval-ranking-profiles-live --allow-below-acceptance-threshold --allow-no-baseline-improvement` - passed with Hit@10 `27/30`, tool errors `0`, missing ColBERT errors `0`.
- `node scripts/run-demo-1c-relevance-eval.js --results .artifacts/hybrid-code-symbol-retrieval/add-retrieval-ranking-profiles-live/raw-results.json --out .artifacts/hybrid-code-symbol-retrieval/add-retrieval-ranking-profiles-live/summary.json --markdown-out .artifacts/hybrid-code-symbol-retrieval/add-retrieval-ranking-profiles-live/summary.md --compare-out .artifacts/hybrid-code-symbol-retrieval/add-retrieval-ranking-profiles-live/comparison.json --baseline .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/summary.json --baseline-mode non-regression --ranking-profile one-c --acceptance-threshold 27 --validate-labels-against examples/demo-1c` - passed, comparable with baseline `27/30`, regressions `0`.
- `git diff --check` - passed.
- `openspec validate add-retrieval-ranking-profiles --strict` - passed.

## Profile Behavior

- `generic` disables 1C-specific object-kind, object-name, and intent boosts while preserving semantic, lexical, exact-symbol, path, provider-rank, and duplicate-diversity behavior.
- `one-c` remains eligible for bounded 1C boosts on recognized exported 1C paths.
- Omitted profile and explicit `auto` preserve the previous path-based behavior.
- `rankingProfile` is reported in fused result metadata and in MCP `structuredContent`.
- MCP `search_code` accepts `auto`, `generic`, and `one-c`; invalid values fail before search.
- `rankingProfile` is independent from `oneCIndexScopeProfile`.
- Persisted ranking-profile defaults were not added because there is no explicit configuration operation for them in this change; search-time override is implemented and no silent inference or persistence was introduced.

## Artifacts

- Live runner artifact directory:
  `.artifacts/hybrid-code-symbol-retrieval/add-retrieval-ranking-profiles-live/`
- Raw JSON records `rankingProfile: "one-c"`.
- Scored JSON records `run.rankingProfile: "one-c"`.
- Markdown report records `Ranking profile: one-c`.
- Comparison JSON records a comparable non-regression result against `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/summary.json`: baseline `27/30`, tuned `27/30`, regressions `0`.

## Live Validation Limit

The first live attempt failed because Qdrant was stopped and the BGE-M3 sidecar virtual environment was missing `httpx`. The environment was repaired by:

- starting the existing `qdrant-bge-m3-benchmark` container;
- installing missing `httpx` into `python/.venv-bge-m3`;
- correcting `python/requirements-bge-m3-sidecar.txt` from `httpx2` to `httpx`;
- restarting `bge-m3-sidecar.service`;
- restarting `claude-context-mcp.service` so the live daemon used the rebuilt MCP/Core code.

## Remaining Risk

- The live result is a non-regression against the current accepted `27/30` baseline, not an improvement.
