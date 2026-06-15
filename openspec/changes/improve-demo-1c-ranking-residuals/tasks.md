## 1. Baseline And Label Audit

- [x] 1.1 Preserve or regenerate the current post-commit `examples/demo-1c` live baseline with Hit@10 `26/30`, `0` MCP tool errors, and `0` missing ColBERT errors.
- [x] 1.2 Record residual query details for `r01`, `r05`, `r06`, and `r28`, including expected prefixes, current top-10 paths, score diagnostics, duplicate penalties, and first relevant rank.
- [x] 1.3 Validate residual expected path prefixes against the indexed `examples/demo-1c` fixture and record whether each prefix is reachable.
- [x] 1.4 Inspect highly ranked non-labeled paths for the residual queries and classify each residual as ranking defect, label ambiguity, stale label, or intentionally narrow label.
- [x] 1.5 Decide and document whether `r05` should remain command-only or whether additional print contexts should be added to evaluation labels.
- [x] 1.6 Define the post-audit target threshold before tuning; do not raise the hard target above `26/30` until residual labels are validated.
- [x] 1.7 Define the live-run comparison mode for this follow-up as non-regression against `26/30`, distinct from strict improvement over older baselines.

## 2. Residual-Focused Tests

- [x] 2.1 Add focused tests for stock-report intent so report, stock command, or stock list form paths outrank broad document modules when evidence is comparable.
- [x] 2.2 Add focused tests for product-card intent so `Catalogs/Товары/Forms/ФормаЭлемента` and product object modules outrank scanner setup or barcode print commands for card-style queries.
- [x] 2.3 Add focused tests for common-form exact or near-exact name matching, covering `CommonForms/НастройкиМобильногоУстройства`.
- [x] 2.4 Add focused tests for print command intent after the `r05` label decision, ensuring print commands are supported without excluding legitimate print modules by fixed layout.
- [x] 2.5 Add or extend duplicate-control tests for third-and-later chunks from one broad file while preserving exact-symbol and provider-backed chunks.
- [x] 2.6 Add a regression test proving production code still does not read `demo-1c` query IDs, expected path prefixes, or residual labels.
- [x] 2.7 Add scorer or runner tests proving equality with a supplied `26/30` baseline can pass in non-regression mode while any result below `26/30` fails.
- [x] 2.8 Add scorer or runner tests proving residual query IDs are provided by evaluation configuration or command options, not by production ranking code.

## 3. Ranking Implementation

- [x] 3.1 Extend generic 1C query-intent parsing for report/stock-balance, product-card, common-form-name, and print-command residual intents.
- [x] 3.2 Implement bounded path/name/content/provider score support for stock-report contexts without hard-coding `r01` or expected prefixes.
- [x] 3.3 Implement bounded product-card support without mapping business terms to one fixed object unless result evidence supports it.
- [x] 3.4 Implement common-form name matching for exported 1C paths while keeping unknown or customized layouts neutral.
- [x] 3.5 Tune print-command support only after label audit and keep commands, forms, reports, modules, layouts, and code text as candidate contexts.
- [x] 3.6 Refine duplicate diversity if residual evidence shows repeated broad chunks still crowd out distinct expected files.
- [x] 3.7 Keep diagnostics compact and continue excluding dense, sparse, and ColBERT vector payloads.
- [x] 3.8 Implement or configure a non-regression baseline comparison mode in the relevance runner so this change can compare against `26/30` without requiring strict `> baseline` improvement.
- [x] 3.9 Parameterize residual query reporting instead of relying on permanent hard-coded residual IDs in generic scoring output.

## 4. Automated Verification

- [x] 4.1 Run `node --test scripts/run-demo-1c-relevance-eval.test.js`.
- [x] 4.2 Run focused core tests for code-symbol retrieval ranking and diagnostics.
- [x] 4.3 Run `pnpm --filter @zilliz/claude-context-core typecheck`.
- [x] 4.4 Run `pnpm --filter @zilliz/claude-context-core lint`.
- [x] 4.5 Run `pnpm build:core`.
- [x] 4.6 Run `git diff --check`.

## 5. Live Acceptance

- [x] 5.1 Restart or otherwise verify the MCP daemon is running the freshly built code.
- [x] 5.2 Verify Qdrant is available on `http://127.0.0.1:6333` and the `examples/demo-1c` index is complete with `oneCIndexScopeProfile=developer`.
- [x] 5.3 Run the 30-query live MCP acceptance set against Qdrant default with a non-regression baseline comparison to the current `26/30` run.
- [x] 5.4 Confirm the tuned run has `0` MCP tool errors and `0` missing ColBERT vector errors.
- [x] 5.5 Confirm the tuned run reaches the documented post-audit Hit@10 threshold and does not regress below `26/30`.
- [x] 5.6 Confirm residual query outcomes for `r01`, `r05`, `r06`, and `r28` are explicitly reported.
- [x] 5.7 Save raw JSON, scored JSON, Markdown, label validation, and comparison artifacts under `.artifacts/hybrid-code-symbol-retrieval/`.

## 6. Finalization

- [x] 6.1 Update `verification.md` with commands, artifacts, residual-label decisions, final metrics, and known remaining misses or regressions.
- [x] 6.2 Run `openspec validate improve-demo-1c-ranking-residuals --strict`.
- [x] 6.3 Update this checklist only after each task is actually verified.
- [x] 6.4 Prepare a commit containing implementation, tests, scripts, documentation, artifacts references, and OpenSpec updates when the user requests landing.
