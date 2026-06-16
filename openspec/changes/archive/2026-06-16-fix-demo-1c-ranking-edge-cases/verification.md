# Verification

Date: 2026-06-16

## Baseline And Environment

- Baseline artifacts: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/`
- Baseline used for comparison: `summary.json`, Hit@10 `27/30`.
- Live final artifacts: `.artifacts/hybrid-code-symbol-retrieval/fix-demo-1c-ranking-edge-cases-live-final/`
- Required residual assertions: `.artifacts/hybrid-code-symbol-retrieval/fix-demo-1c-ranking-edge-cases/required-residual-assertions.json`
- MCP daemon restarted from freshly built `packages/mcp/dist/index.js`; daemon evidence: `.artifacts/hybrid-code-symbol-retrieval/fix-demo-1c-ranking-edge-cases/daemon-fresh.log`
- Qdrant was available on `http://127.0.0.1:6333`; BGE-M3 sidecar was available on `http://127.0.0.1:8000/health`.
- `examples/demo-1c` index status before live acceptance: `indexed`, `retrievalMode=bge_m3_full`, schema version `1`, `oneCIndexScopeProfile=developer`, `indexedFiles=129`, `totalChunks=893`.

## Final Live Acceptance

Command:

```bash
ASSERTIONS=$(tr -d '\n' < .artifacts/hybrid-code-symbol-retrieval/fix-demo-1c-ranking-edge-cases/required-residual-assertions.json)
node scripts/run-demo-1c-live-mcp-eval.js \
  --run-name fix-demo-1c-ranking-edge-cases-live-final \
  --baseline .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/summary.json \
  --residual-query-ids r01,r05,r06,r28 \
  --required-residual-assertions-json "$ASSERTIONS" \
  --acceptance-threshold 27 \
  --baseline-mode non-regression \
  --ranking-profile one-c \
  --one-c-index-scope-profile developer
```

Result:

- Hit@10: `30/30`
- Tool errors: `0`
- Missing ColBERT vector errors: `0`
- Compared baseline Hit@10: `27/30`
- Regressions: `0`
- Label validation: all expected prefixes reachable

Residual outcomes:

| id | assertion | first relevant rank | comparison | top result |
| --- | --- | ---: | --- | --- |
| r01 | passed | 1 | improved | `Reports/ОстаткиТоваровНаСкладах/Commands/ОстаткиПоСкладу/Ext/CommandModule.bsl` |
| r05 | passed | 1 | improved | `Documents/РасходТовара/Ext/ObjectModule.bsl` |
| r06 | passed | 1 | improved | `Catalogs/Товары/Ext/ObjectModule.bsl` |
| r28 | passed | 1 | improved | `CommonForms/НастройкиМобильногоУстройства/Ext/Form/Module.bsl` |

The `r06` ordering assertion passed: `Catalogs/Товары/Ext/ObjectModule.bsl` ranked before `Catalogs/Товары/Commands/ПечатьШтрихкода`.

## Print Label Decision

`r05` truth was broadened to include `Documents/РасходТовара/Ext/ObjectModule.bsl` as a legitimate print context. The command module `Documents/РасходТовара/Commands/ПечатьРасходнойНакладной/Ext/CommandModule.bsl` calls `Документ.ПечатнаяФорма(ТабличныйДокумент)`, while `Documents/РасходТовара/Ext/ObjectModule.bsl` defines exported `ПечатнаяФорма(ТабличныйДокумент)` and loads `МакетПечати`.

This is an evaluation-label change only. Production ranking code does not read query ids, expected path prefixes, residual labels, demo labels, or assertion configuration.

## Automated Checks

Passed:

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core typecheck
pnpm --filter @zilliz/claude-context-core lint
pnpm build:core
git diff --check
openspec validate fix-demo-1c-ranking-edge-cases --strict
```

Additional finish-to-100 closure:

- Required residual `noRegression` assertions now fail closed when no baseline comparison row is available.
- `node --test scripts/run-demo-1c-relevance-eval.test.js` includes the regression check `requires baseline comparison when residual no-regression assertions are configured`.

Additional build used for live daemon:

```bash
pnpm build:core && pnpm build:mcp
```

`pnpm --filter @zilliz/claude-context-core lint` completed with exit code `0` and existing repository warnings.

## Known Risks

- The live proof depends on the existing Qdrant collection for `examples/demo-1c`; no reindex was performed by this change.
- `.artifacts/` evidence is local and ignored by git; committed files reference the artifact paths rather than storing the raw payloads.
- The BGE-M3 rerank pool default is now wider when `BGE_M3_RERANK_LIMIT` is unset. Returned result count still follows caller `topK`.
