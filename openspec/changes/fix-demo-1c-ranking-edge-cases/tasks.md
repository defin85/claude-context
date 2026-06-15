## 1. Baseline And Residual Evidence

- [ ] 1.1 Preserve the final residual baseline artifacts from `.artifacts/hybrid-code-symbol-retrieval/live-demo-1c/residual-ranking-2026-06-15-final/` as the comparison baseline for this change.
- [ ] 1.2 Record current residual evidence for `r01`, `r05`, `r06`, and `r28`, including top-10 paths, score diagnostics, duplicate penalties, first relevant rank, and residual comparison status.
- [ ] 1.3 Verify the `examples/demo-1c` index state before tuning: Qdrant availability, `indexed` status, BGE-M3 full retrieval mode, schema version, file count, chunk count, and `oneCIndexScopeProfile=developer`.
- [ ] 1.4 Confirm production ranking code has no references to `r01`, `r05`, `r06`, `r28`, expected path prefixes, residual labels, or demo label fields.

## 2. Residual Acceptance Tooling

- [ ] 2.1 Extend relevance scoring or live runner options to express required residual outcomes such as hit within top 10, no regression, and path ordering assertions.
- [ ] 2.2 Add tests proving aggregate Hit@10 cannot pass the follow-up when a required residual assertion fails.
- [ ] 2.3 Add tests proving residual assertions are supplied by evaluation configuration or runner options and are not read by production ranking code.
- [ ] 2.4 Update Markdown and JSON reports to include required residual assertion outcomes, failure reasons, top paths, and comparison status.

## 3. Product-Card Ordering

- [ ] 3.1 Add a focused regression test matching the live `r06` shape where `Catalogs/Товары/Commands/ПечатьШтрихкода` currently outranks `Catalogs/Товары/Ext/ObjectModule.bsl`.
- [ ] 3.2 Refine generic product-card intent scoring so product item forms and product object modules outrank barcode print or scanner commands when the query is about card attributes.
- [ ] 3.3 Add a counter-test proving explicit barcode print queries still support barcode print commands and preserve exact-symbol or provider-backed chunks.
- [ ] 3.4 Confirm the live `r06` query ranks a product item form or product object module above barcode print and scanner commands.

## 4. Stock-Report And Common-Form Ranking

- [ ] 4.1 Add focused tests for `r01`-style stock-report queries where reports, stock-balance common commands, and stock list forms compete with broad document modules.
- [ ] 4.2 Implement bounded stock-report path/name/content/provider support that surfaces at least one expected stock context in top 10 without hard-coded residual IDs.
- [ ] 4.3 Add focused tests for `r28`-style mobile-device settings queries where `CommonForms/НастройкиМобильногоУстройства` competes with generic settings, selection, storage, and mobile catalog contexts.
- [ ] 4.4 Implement common-form compact-name and query-term support that surfaces exact or near-exact common-form names while keeping unknown customized layouts neutral.
- [ ] 4.5 Verify duplicate diversity diagnostics still expose broad-file penalties and do not remove exact-symbol or provider-backed chunks solely due to same-file duplication.

## 5. Print Residual Label Decision

- [ ] 5.1 Re-inspect `r05` top paths and source content for the command module, object module, layouts, forms, reports, manager modules, and common modules involved in printing.
- [ ] 5.2 Decide whether `r05` evaluation truth should include `Documents/РасходТовара/Ext/ObjectModule.bsl` as a legitimate print context or remain command-only.
- [ ] 5.3 If broadening the label, update `evaluation/retrieval/demo-1c-relevance.json` and scorer/report tests to record the audit decision.
- [ ] 5.4 If keeping command-only truth, refine generic print-command support until `Documents/РасходТовара/Commands/ПечатьРасходнойНакладной` appears in the top 10.
- [ ] 5.5 Add a regression test proving print evaluation truth does not become production routing logic.

## 6. Automated Verification

- [ ] 6.1 Run `node --test scripts/run-demo-1c-relevance-eval.test.js`.
- [ ] 6.2 Run `pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand`.
- [ ] 6.3 Run `pnpm --filter @zilliz/claude-context-core typecheck`.
- [ ] 6.4 Run `pnpm --filter @zilliz/claude-context-core lint`.
- [ ] 6.5 Run `pnpm build:core`.
- [ ] 6.6 Run `git diff --check`.
- [ ] 6.7 Run `openspec validate fix-demo-1c-ranking-edge-cases --strict`.

## 7. Live Acceptance

- [ ] 7.1 Restart or otherwise verify the MCP daemon is running freshly built code.
- [ ] 7.2 Verify Qdrant is available on `http://127.0.0.1:6333` and the `examples/demo-1c` index is complete with `oneCIndexScopeProfile=developer`.
- [ ] 7.3 Run the 30-query live MCP acceptance set against Qdrant default with baseline comparison to the final `27/30` residual run.
- [ ] 7.4 Confirm the live run has `0` MCP tool errors and `0` missing ColBERT vector errors.
- [ ] 7.5 Confirm the live run reaches at least Hit@10 `27/30` and has no residual regressions.
- [ ] 7.6 Confirm required residual assertions pass for `r01`, `r05`, `r06`, and `r28`, including the product-card ordering assertion for `r06`.
- [ ] 7.7 Save raw JSON, scored JSON, Markdown, label validation, comparison, residual assertion results, and daemon evidence under `.artifacts/hybrid-code-symbol-retrieval/`.

## 8. Finalization

- [ ] 8.1 Create `verification.md` with commands, artifacts, final metrics, residual outcomes, print-label decision, and known remaining risks.
- [ ] 8.2 Update this checklist only after each task is actually verified.
- [ ] 8.3 Prepare a commit containing implementation, tests, scripts, evaluation changes if any, documentation, artifact references, and OpenSpec updates when the user requests landing.
