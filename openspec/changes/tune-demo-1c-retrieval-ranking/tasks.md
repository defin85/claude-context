## 1. Measurement Gate

- [x] 1.1 Preserve or regenerate the current Qdrant default `examples/demo-1c` baseline report with Hit@10 18/30, 0 MCP tool errors, and 0 missing ColBERT errors.
- [x] 1.2 Add a committed live MCP evaluation runner that executes every query from `evaluation/retrieval/demo-1c-relevance.json` against `search_code`.
- [x] 1.3 Make the runner save raw JSON results, a scored JSON summary, and a Markdown report under `.artifacts/hybrid-code-symbol-retrieval/`.
- [x] 1.4 Include backend label, codebase path, dataset version, query count, latency, and acceptance threshold in generated artifacts.
- [x] 1.5 Ensure the runner can compare a tuned report against a baseline report and list per-query regressions and improvements.
- [x] 1.6 Validate every expected path prefix against the indexed `examples/demo-1c` fixture before setting the final Hit@10 gate; fix stale labels in the dataset or document unreachable/ambiguous query IDs in the report.
- [x] 1.7 Define one canonical live-result schema and normalize both existing `results[].top10[].path` artifacts and new runner output before scoring.
- [x] 1.8 Add a regression check that `scripts/run-demo-1c-relevance-eval.js` or its replacement scores the current fixed Qdrant live report as the recorded 18/30 baseline, not as a format-induced 0/30 miss set.
- [x] 1.9 Document the post-label-validation acceptance threshold before implementing ranking changes; use Hit@10 24/30 only if the validated dataset supports it.
- [x] 1.10 Enforce the configured acceptance threshold as a non-zero exit condition unless a baseline or measurement run explicitly allows a below-threshold result.

## 2. Ranking Diagnostics

- [x] 2.1 Extend top-result metadata or report extraction to include semantic score, lexical score, exact-symbol boost, path boost, and final fusion score.
- [x] 2.2 Add metadata for new 1C-aware score signals, such as object-kind boost, metadata-object-name boost, form-intent boost, and duplicate penalty or diversity reason.
- [x] 2.3 Verify diagnostics do not include dense, sparse, or ColBERT vector payloads.
- [x] 2.4 Add focused tests that assert diagnostics are present for fused code-symbol retrieval results.

## 3. 1C-Aware Ranking Signals

- [x] 3.1 Add tests for object-kind intent matching, covering catalogs, documents, registers, reports, commands, item forms, list forms, document forms, and print commands.
- [x] 3.2 Add tests for metadata object name matching in `relativePath`, covering representative names such as `Контрагенты`, `Склады`, `Пользователи`, `ЕдиницыИзмерения`, `ОстаткиТоваров`, and `РасходТовара`.
- [x] 3.3 Implement general 1C path parsing helpers for exported configuration paths without depending on `demo-1c` labels.
- [x] 3.4 Implement bounded ranking hints for object-kind, object-name, and form/command/print intent matches; ensure these hints cannot dominate semantic, lexical, exact-symbol, or provider-rank evidence by themselves.
- [x] 3.5 Keep unknown, customized, or non-1C paths neutral so generic code search behavior does not fail on unfamiliar layouts.
- [x] 3.6 Add tests proving print-related queries consider commands, forms, reports, object modules, manager modules, common modules, layouts, and code text as candidate contexts rather than one fixed exported path.
- [x] 3.7 Add cross-layout sanity fixtures representing at least two different 1C configuration styles or customized placement patterns, and verify 1C hints remain neutral or bounded when layout assumptions do not hold.

## 4. Duplicate Control And Fusion Tuning

- [x] 4.1 Add a deterministic test where repeated chunks from one broad file cannot crowd out a more specific matching file in the top 10, while exact-symbol or provider-backed chunks from the repeated file are still allowed to survive diversity control.
- [x] 4.2 Implement soft post-fusion duplicate control or diversity reranking while preserving legitimate multi-chunk hits.
- [x] 4.3 Rebalance fusion weights so broad lexical matches do not dominate specific path/object matches while bounded 1C hints also cannot override clearly stronger semantic/provider evidence.
- [x] 4.4 Verify production code never reads query IDs, expected path prefixes, or relevance labels during `search_code`.

## 5. Automated Verification

- [x] 5.1 Run focused core tests for code-symbol retrieval ranking and diagnostics.
- [x] 5.2 Run the committed relevance evaluation runner against a saved or live baseline and confirm it reports the known 18/30 baseline.
- [x] 5.3 Run `pnpm --filter @zilliz/claude-context-core typecheck`.
- [x] 5.4 Run `pnpm build:core`.
- [x] 5.5 Run relevant lint for changed TypeScript packages.

## 6. Live Acceptance

- [x] 6.1 Verify Qdrant is available on `http://127.0.0.1:6333` and the target `examples/demo-1c` index is complete or force-reindex it with `oneCIndexScopeProfile=developer`.
- [x] 6.2 Run the tuned 30-query live MCP acceptance set through the committed runner.
- [x] 6.3 Confirm the tuned run has 0 MCP tool errors and 0 missing ColBERT vector errors.
- [x] 6.4 Confirm the tuned run improves over Hit@10 18/30 and reaches the documented post-label-validation threshold.
- [x] 6.5 Save tuned JSON and Markdown artifacts under `.artifacts/hybrid-code-symbol-retrieval/` and reference them from the task completion notes.
- [x] 6.6 Enforce live acceptance as a non-zero exit condition when MCP tool errors, missing ColBERT errors, or lack of baseline improvement are present unless an explicit non-acceptance override is provided.

## 7. Finalization

- [x] 7.1 Update this checklist only after each task is actually verified.
- [x] 7.2 Summarize ranking changes, baseline-vs-tuned metrics, final threshold rationale, remaining ambiguous labels, and every baseline Hit@10 query that regressed.
- [x] 7.3 Run `openspec validate tune-demo-1c-retrieval-ranking --strict`.
- [x] 7.4 Prepare a commit containing implementation, tests, scripts, docs or artifacts references, and OpenSpec updates.
