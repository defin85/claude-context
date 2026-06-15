## Context

The current `examples/demo-1c` Qdrant default live run reaches Hit@10 `27/30` with `0` MCP tool errors and `0` missing ColBERT errors. That is a valid aggregate improvement, but the final report still shows three misses (`r01`, `r05`, `r28`) and one partially fixed product-card case (`r06`) where the expected product object is rank `2` while `Catalogs/Товары/Commands/ПечатьШтрихкода` remains rank `1`.

This change is a quality follow-up on the BGE-M3 full retrieval path. It keeps dense, sparse, and ColBERT storage unchanged and focuses on bounded generic 1C ranking signals, evaluation labels, residual reporting, and live acceptance checks.

## Goals / Non-Goals

**Goals:**

- Make stock-report queries surface stock reports, stock commands, and stock list forms above broad unrelated document modules when evidence is comparable.
- Make mobile-device settings queries surface `CommonForms` exact or near-exact name matches above generic settings, selection, storage, or mobile catalog contexts.
- Make product-card queries rank product item forms or product object modules above scanner and barcode print commands when the query intent is card attributes rather than printing.
- Resolve the `r05` audit into an explicit evaluation decision: either broaden the label set to include the legitimate object-module print context or keep the command-only label and make the print command discoverable.
- Preserve or improve the final live baseline of `27/30` with no tool errors, no missing ColBERT errors, and no residual regressions.
- Keep production `search_code` independent from demo query IDs, expected prefixes, and relevance labels.

**Non-Goals:**

- No Qdrant schema, vector insertion, BGE-M3 storage, ColBERT reranking, daemon lifecycle, or 1C indexing-scope changes.
- No reindex requirement for existing collections.
- No fixture-specific production routing by `r01`, `r05`, `r06`, `r28`, or expected path prefixes.
- No requirement to make every residual query rank first if the audit documents a narrower evaluation label or a legitimate competing context.

## Decisions

### Decision: Treat `27/30` as the new regression baseline

This change SHALL compare live acceptance against the final `improve-demo-1c-ranking-residuals` run at `27/30`, not the earlier `26/30` or `18/30` baselines.

Rationale:

- The previous follow-up already raised aggregate quality and proved no regressions.
- Accepting a return to `26/30` would hide quality drift while addressing edge cases.

Alternative considered: keep `26/30` as the gate. That is too weak for a follow-up whose purpose is closing remaining quality risk.

### Decision: Add residual-specific acceptance checks outside production ranking

The live runner should continue accepting residual IDs from evaluation options, but it should fail the follow-up when required residual outcomes are not met. These checks belong in evaluation and report tooling, not in `packages/core` ranking code.

Rationale:

- The previous implementation could pass aggregate non-regression while leaving the product-card ordering issue visible only in the report.
- Explicit evaluation assertions prevent aggregate metrics from masking residual regressions.

Alternative considered: inspect residual IDs inside production ranking. That would violate label isolation and overfit the fixture.

### Decision: Prefer candidate-context gating over larger global boosts

Ranking changes should refine when path/name/content boosts apply. Product-card, stock-report, and common-form boosts should require supporting evidence from object kind, area, path name, content terms, semantic score, lexical score, or provider candidates.

Rationale:

- Larger global boosts can improve one residual while damaging broad semantic search.
- Context gating keeps unfamiliar 1C layouts neutral.

Alternative considered: add high hard-coded boosts for the known expected paths. That would pass the fixed eval but fail general 1C search behavior.

### Decision: Make the print-label audit produce a durable testable outcome

The `r05` object module is a legitimate print context because it owns the exported print procedure and print layout use. The implementation must either update evaluation labels to include this context or keep command-only truth and add enough generic command evidence to place the command in top 10.

Rationale:

- Leaving the case as an intentionally narrow miss makes future score changes hard to interpret.
- The decision belongs to evaluation truth, while production ranking remains generic.

Alternative considered: keep documenting ambiguity without changing tests or labels. That preserves uncertainty and does not reduce risk.

## Risks / Trade-offs

- Stronger 1C path/name signals can hurt semantic-only behavior -> keep boosts bounded, require aggregate live comparison, and add focused negative tests.
- Product-card deboosting of barcode commands can hide valid print-barcode tasks -> apply it only for product-card attribute intent, not for print-barcode intent.
- Common-form exact-name support can overboost generic forms -> require multiple matched name terms or compacted-name evidence.
- Label changes for `r05` can inflate metrics without improving search -> record the audit decision, compare top paths before and after, and keep production code label-free.
- Live metrics can drift with daemon/index state -> capture Qdrant status, index status, raw JSON, scored JSON, comparison JSON, label validation, and Markdown report for the final run.

## Migration Plan

1. Keep existing indexes in place; no reindex is required.
2. Add focused tests for stock-report, mobile-device common-form, product-card ordering, and print-label decision behavior.
3. Implement bounded ranking or evaluation changes.
4. Run focused core tests, scorer tests, typecheck, lint, build, strict OpenSpec validation, and the live 30-query acceptance runner against Qdrant default.
5. If live ranking worsens, rollback is a code and evaluation-data revert only; existing vector collections remain usable.

## Open Questions

- Should `r05` be broadened to include `Documents/РасходТовара/Ext/ObjectModule.bsl`, or should command-only truth remain the target?
- Should completion require `28/30`, `29/30`, or only `27/30` plus explicit residual outcome checks?
