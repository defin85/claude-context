## Context

The committed `tune-demo-1c-retrieval-ranking` work moved the live Qdrant default `examples/demo-1c` score from the recorded `18/30` ranking baseline to `26/30` with `0` MCP tool errors and `0` missing ColBERT vector errors. The follow-up target is not backend correctness; BGE-M3 full retrieval already uses dense, sparse, and ColBERT late-interaction reranking successfully on this fixture.

The remaining quality gap is concentrated in four query IDs from the fixed relevance set:

- `r01`: `остатки товаров на складах отчет по складу` misses report/common-command/list-form stock-balance paths.
- `r05`: `печать расходной накладной документ расход товара` misses the print command label while repeatedly ranking the расход document object module.
- `r06`: `карточка товара реквизиты цена артикул штрихкод` misses the product item form and product object module.
- `r28`: `настройки мобильного устройства форма настройки` misses the common form named `НастройкиМобильногоУстройства`.

The current `26/30` run is the baseline for this change. The older `18/30` run is useful historical context but is no longer the bar for completion.

## Goals / Non-Goals

**Goals:**

- Improve or explicitly classify the four residual misses without reducing the current live Hit@10 below `26/30`.
- Revalidate residual labels before tuning against them, especially `r05`, where an object module may be a legitimate print-related context but the expected prefix is narrower.
- Add focused regression tests for report/stock-balance intent, product-card intent, common-form name matching, print-command intent, and duplicate crowding.
- Keep all production ranking signals path-, query-, content-, provider-, and score-derived; evaluation labels remain test truth only.
- Keep live acceptance fail-closed with the existing hard threshold and add a follow-up target threshold only after residual labels are validated.

**Non-Goals:**

- No Qdrant schema, vector insertion, BGE-M3 storage, ColBERT retrieval, daemon lifecycle, or index-scope changes.
- No reindex requirement for existing collections.
- No hard-coded mapping from residual query IDs or expected path prefixes to production result boosts.
- No broad rewrite of semantic retrieval or provider integration.

## Decisions

### Decision: Treat `26/30` as the regression baseline

This change SHALL compare against the post-commit live run `live-demo-1c/post-commit-43207c6` or a freshly regenerated equivalent. Completion requires preserving aggregate Hit@10 at least `26/30` and preserving `0` tool errors and `0` missing ColBERT errors. The acceptance runner must support a non-regression comparison for this follow-up: equality with the `26/30` baseline is acceptable while the residual work is being classified or improved, but a result below `26/30` is not.

Rationale:

- The older `18/30` run no longer protects the current quality level.
- The residual work is a quality follow-up, so regressions from `26/30` must be visible and should fail the change.
- The existing strict improvement check is useful when comparing to the older `18/30` baseline, but it is too strong for a follow-up whose first mandatory outcome is "do not go below the current 26/30".

Alternative considered: keep `24/30` as the only gate. That would allow useful current behavior to regress while still passing the old acceptance threshold.

Alternative considered: keep strict `> baseline` semantics for all comparisons. That would force the first residual implementation to reach `27/30` even if label audit proves that one residual is intentionally narrow or should be excluded before tuning.

### Decision: Validate residual labels before tuning weights

The implementation SHALL inspect the expected path prefixes and fixture content for `r01`, `r05`, `r06`, and `r28` before accepting score changes. If `r05` or another residual label is too narrow, the dataset or report must document the ambiguity before ranking changes are credited.

Rationale:

- Tuning against a narrow or ambiguous label can penalize a useful result.
- Label updates are allowed only in evaluation data; they must not become production ranking rules.

Alternative considered: increase boosts until all four labels pass. That risks overfitting and can damage general 1C search behavior.

### Decision: Prefer bounded residual-intent signals over fixed object routing

Ranking changes should extend the existing bounded 1C signals:

- report and stock-balance intent for `Reports`, stock-balance common commands, and list forms with stock context;
- product-card intent for catalog item forms and product object modules when query terms indicate card attributes;
- common-form exact or near-exact name matching for paths under `CommonForms`;
- print-command intent only when command/form/module evidence independently supports print context.

Rationale:

- The residual misses are caused by common 1C navigation intents, not by a missing vector backend feature.
- Bounded signals keep unfamiliar layouts neutral and avoid turning demo labels into production routing.

Alternative considered: add a table of query-term to expected-path mappings. That would improve the fixed eval but fail outside the fixture and violate the label isolation contract.

### Decision: Strengthen diversity only after score evidence is assembled

The implementation should evaluate whether repeated chunks from a broad file still crowd out distinct files after base fusion. If needed, duplicate control can increase penalties for third and later chunks or prefer distinct files in the final top-10 presentation while preserving exact-symbol and provider-backed evidence.

Rationale:

- Current misses still show repeated `Documents/РасходТовара/Ext/ObjectModule.bsl` and duplicated common-command/form chunks in top-10.
- A soft post-fusion policy is safer than removing duplicates before score evidence is visible.

Alternative considered: hard one-result-per-file deduplication. That can hide legitimate line-specific hits and should not be the default for code search.

## Risks / Trade-offs

- Overfitting to four queries -> require generic 1C intent/path tests and no production reads of dataset labels.
- Narrow label drift -> validate `r01`, `r05`, `r06`, and `r28` labels before raising the target threshold.
- Diversity can hide useful repeated chunks -> keep exact-symbol and provider-backed chunks eligible, and expose duplicate diagnostics.
- Stronger path/name boosts can hurt semantic-only search -> cap residual-intent boosts and require aggregate live comparison against `26/30`.
- Extra diagnostics can enlarge responses -> keep score metadata compact and continue excluding dense, sparse, and ColBERT vector payloads.

## Migration Plan

1. Keep existing indexes in place; no reindex is required.
2. Preserve or regenerate the current post-commit `26/30` live baseline.
3. Validate residual labels and document ambiguity or corrections.
4. Add focused tests for residual intents and duplicate crowding.
5. Implement bounded ranking changes in `packages/core/src/code-symbol-retrieval.ts`.
6. Run focused core tests, scorer tests, typecheck, build, lint, strict OpenSpec validation, and the live 30-query acceptance runner with a non-regression baseline comparison against `26/30`.
7. If ranking worsens, rollback is a code revert only; existing vector collections remain usable.

## Open Questions

- Is `r05` intentionally narrow to the print command only, or should the object module be accepted when it contains print-form logic for the same document?
- Should the next hard target be `27/30` or `28/30` after residual label validation?
