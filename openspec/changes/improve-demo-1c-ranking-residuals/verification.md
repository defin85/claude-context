# Verification

## Summary

- Final live run: `27/30` Hit@10, `0` MCP tool errors, `0` missing ColBERT errors.
- Baseline: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/post-commit-43207c6/summary.json`, `26/30`, `0` MCP tool errors, `0` missing ColBERT errors.
- Comparison mode: `non-regression`; equality with `26/30` is allowed, below `26/30` fails.
- Final live artifacts: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/`.
- The final run improved `r06`, `r09`, and `r15`; it had no regressions.
- Remaining misses after the final run: `r01`, `r05`, `r28`.

## Commands

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core typecheck
pnpm --filter @zilliz/claude-context-core lint
pnpm build:core
git diff --check
```

Results:

- `node --test scripts/run-demo-1c-relevance-eval.test.js`: passed, `8` tests.
- `pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand`: passed, `19` tests.
- `pnpm --filter @zilliz/claude-context-core typecheck`: passed.
- `pnpm --filter @zilliz/claude-context-core lint`: passed with existing warnings and `0` errors.
- `pnpm build:core`: passed.
- `git diff --check`: passed.

Final daemon and live acceptance:

```bash
node scripts/run-demo-1c-live-mcp-eval.js \
  --backend-label qdrant-residual-live \
  --codebase-path examples/demo-1c \
  --acceptance-threshold 26 \
  --baseline .artifacts/hybrid-code-symbol-retrieval/live-demo-1c/post-commit-43207c6/summary.json \
  --baseline-mode non-regression \
  --residual-query-ids r01,r05,r06,r28 \
  --run-name live-demo-1c/residual-ranking-2026-06-15-final \
  --limit 10
```

Result:

- Hit@10: `27/30`.
- Tool errors: `0`.
- Missing ColBERT errors: `0`.
- Comparison improvements: `r06`, `r09`, `r15`.
- Comparison regressions: none.

Qdrant and index state before final live run:

- Qdrant endpoint `http://127.0.0.1:6333` responded with collections.
- `examples/demo-1c` status: `indexed`.
- Retrieval mode: `bge_m3_full`, schema version `1`.
- 1C scope profile: `developer`.
- Indexed files: `129`.
- Chunks: `893`.

## Artifacts

Final run:

- Raw JSON: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/raw-results.json`
- Summary JSON: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/summary.json`
- Markdown report: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/summary.md`
- Label validation: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/label-validation.json`
- Comparison: `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/comparison.json`
- Daemon restart log: `.artifacts/hybrid-code-symbol-retrieval/daemon/restart-final-2026-06-15.log`

Earlier exploratory run kept for comparison:

- `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15/`

## Residual Label Audit

All residual expected prefixes are reachable in `examples/demo-1c`; `label-validation.json` reports `unreachablePrefixCount: 0`.

### r01

- Query: `остатки товаров на складах отчет по складу`.
- Expected prefixes are reachable:
  - `Reports/ОстаткиТоваровНаСкладах`
  - `Reports/ОстаткиТоваровНаСкладахМобильный`
  - `CommonCommands/ОстаткиТоваровНаСкладахКоманда`
  - `Catalogs/Товары/Forms/ФормаСпискаСОстатками`
- Classification: ranking defect remains.
- Final outcome: unchanged miss.
- Evidence: final summary lists top paths and compact score diagnostics, including object-name, intent, fusion, and diversity metadata.

### r05

- Query: `печать расходной накладной документ расход товара`.
- Expected prefix is reachable:
  - `Documents/РасходТовара/Commands/ПечатьРасходнойНакладной`
- Audit decision: keep the label command-only for this change, but classify it as intentionally narrow.
- Reason: `Documents/РасходТовара/Ext/ObjectModule.bsl` is a legitimate print context because it exports `ПечатнаяФорма(ТабличныйДокумент)` and uses `ПолучитьМакет("МакетПечати")`; the command module delegates to `Документ.ПечатнаяФорма(ТабличныйДокумент)`.
- Final outcome: unchanged miss, not credited as a ranking improvement.
- Production ranking does not route by this label; print support stays generic across commands, reports, forms, object modules, manager modules, common modules, templates, and layouts.

### r06

- Query: `карточка товара реквизиты цена артикул штрихкод`.
- Expected prefixes are reachable:
  - `Catalogs/Товары/Forms/ФормаЭлемента`
  - `Catalogs/Товары/Ext/ObjectModule.bsl`
- Classification: ranking defect improved.
- Final outcome: improved from miss to rank `2` via `Catalogs/Товары/Ext/ObjectModule.bsl`.

### r28

- Query: `настройки мобильного устройства форма настройки`.
- Expected prefix is reachable:
  - `CommonForms/НастройкиМобильногоУстройства`
- Classification: ranking defect remains.
- Final outcome: unchanged miss.
- Evidence: final top results still favor generic settings, selection form, and mobile-device manager contexts; the expected common form is reachable but not in top 10.

## Implementation Notes

- `scripts/run-demo-1c-relevance-eval.js` now supports `baselineMode: non-regression`; strict improvement remains the default.
- Residual query reporting is parameterized through runner options and run metadata.
- Markdown reports now include an explicit residual query table.
- `scripts/run-demo-1c-live-mcp-eval.js` passes residual IDs and baseline mode into scoring and acceptance.
- Production ranking changes are bounded generic 1C signals based on query, path, content, provider, and score evidence.
- Production ranking does not contain residual IDs, `expectedPathPrefixes`, `labelsAreProductionRules`, or `residualQueryIds`; this is covered by a runner test.
- Duplicate diversity remains soft and preserves exact-symbol or provider-backed chunks; duplicate diagnostics remain in metadata.

## Remaining Risk

- `r01` and `r28` are still ranking defects after this change.
- `r05` remains a miss under the command-only label, but the audit shows the top object module is a legitimate print context. Changing the label set would be an evaluation-data decision, not a production-ranking rule.
- The daemon log records an unrelated background sync failure for the repository root collection `bge_m3_code_chunks_a68b9b04`; `examples/demo-1c` itself was indexed and unchanged, and the live acceptance run completed against that index.
