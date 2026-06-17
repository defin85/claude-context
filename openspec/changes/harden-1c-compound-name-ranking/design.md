## Context

`improve-1c-scenario-ranking` made `rankingProfile=one-c` useful on the large `examples/demo-do30-1c` fixture: the final live run reached strict Top-1 `21/30`, strict Top-5 `24/30`, strict Top-10 `24/30`, and query-level comparison showed `7` improvements with `0` regressions against the recorded `20/30` baseline. The remaining strict misses are concentrated in compound 1C metadata names and neighboring-context confusion:

- `ПроверкаКонтрагентовКлиентСервер` for saved counterparty state by INN/KPP;
- `АдресРеестраМЧД` constant manager for registry address queries;
- email journal forms such as `ПечатьПисьма` and `ПросмотрВложенногоПисьма`;
- `ПередачаДелВАрхив` object module versus manager module;
- `СообщениеЭДО/Forms/Подписи` versus broad EDI document contexts.

The current live path uses Qdrant with full BGE-M3 dense, sparse, and ColBERT retrieval. This change is a ranking and evaluation hardening step. It must not change storage shape, vector payloads, indexing scope, worker scheduling, or require reindexing.

## Goals / Non-Goals

**Goals:**

- Improve generic matching between natural Russian query phrases and compound 1C metadata names.
- Add holdout and negative-control evaluation so improvements are not only tuned to the six known misses.
- Preserve the current `demo-do30-1c` tuned baseline and existing `demo-1c` acceptance behavior.
- Require query-level comparison and explicit regression review before acceptance.
- Keep production ranking independent from expected prefixes, scenario IDs, fixture notes, and evaluation labels.

**Non-Goals:**

- No Qdrant schema, dense/sparse/ColBERT storage, chunking, indexing scope, or worker-scheduling changes.
- No hard-coded mapping from the known six residual query IDs to target paths.
- No strict `30/30` Top-1 requirement as an acceptance gate.
- No label broadening for metric gains unless source inspection proves the alternate is a legitimate development entry point.

## Decisions

### Decision: Normalize compound 1C metadata names into weighted terms

The ranking layer should split exported 1C names such as `ПросмотрВложенногоПисьма`, `АдресРеестраМЧД`, and `ПроверкаКонтрагентовКлиентСервер` into normalized terms, stems, abbreviations, and adjacent phrases. Query phrases should be matched against these normalized name terms before applying bounded support.

Rationale:

- The remaining misses are not random: the right object is named in the path, but the query uses natural Russian spacing and inflection.
- A name-term matcher is reusable across configurations and does not depend on fixture labels.

Alternative considered: add special-case scenario intent branches for each missed file. That would improve the local score but would be hard to defend as general search behavior.

### Decision: Require supporting evidence before applying compound-name boosts

Compound-name support should apply only when the candidate has additional evidence from path kind, object kind, content, semantic score, lexical score, exact-symbol evidence, or provider evidence. The boost must be bounded and should reorder close candidates rather than override strongly supported unrelated results.

Rationale:

- Exact-looking name fragments can collide across large 1C configurations.
- The existing `one-c` profile already combines semantic, lexical, path, object-kind, object-name, provider, and diversity signals; compound-name matching should be one component in that fusion.

Alternative considered: make compound-name match a dominant score. That would risk over-ranking exact-looking but semantically wrong forms.

### Decision: Add holdout and negative-control evaluation

Create a new evaluation dataset under `evaluation/retrieval/` for queries not used as the original acceptance labels. It should include:

- held-out positive queries for compound names and neighboring contexts;
- negative controls where generic domain terms must not force an exact-name-looking candidate;
- current residual classes as tracked cases, but not as production rules.

Rationale:

- The user explicitly called out the risk of fitting to the known answers.
- Holdout and negative controls make the acceptance gate about general behavior rather than fixture-specific lookup.

Alternative considered: only raise `demo-do30` thresholds. That would not distinguish real ranking improvement from local score chasing.

### Decision: Keep full BGE-M3 retrieval unchanged

The implementation should operate after retrieval and reranking candidate collection. Full BGE-M3 dense+sparse+ColBERT retrieval stays as-is; no new vector fields, no reindex, and no storage migration are required.

Rationale:

- The known failure mode is ordering among retrieved neighboring candidates, not missing storage.
- Avoiding storage changes keeps rollback simple and keeps live validation focused on ranking quality.

Alternative considered: reindex with extra metadata fields. That may be useful later, but it would widen scope and make acceptance depend on collection migration.

## Risks / Trade-offs

- [Risk] Compound-name support can over-rank exact-looking names for broad conceptual queries. Mitigation: require concrete query evidence and add negative controls.
- [Risk] Stronger name matching can hurt semantic discovery when the query is broad. Mitigation: keep broad common modules eligible and require no-regression comparisons.
- [Risk] Holdout labels can themselves be too narrow. Mitigation: validate all strict and acceptable prefixes and require source inspection before accepting label changes.
- [Risk] Live Qdrant results can drift with daemon/index state. Mitigation: record raw results, summary, comparison, label validation, backend label, ranking profile, and index status.
- [Risk] Larger candidate pools can increase latency. Mitigation: keep default production search behavior unchanged unless evaluation wrappers explicitly request a wider limit, and record latency in reports.

## Migration Plan

1. Add holdout and negative-control datasets with label validation tests.
2. Add focused unit tests for compound-name matching and negative cases before changing ranking.
3. Implement bounded compound-name signals in `code-symbol-retrieval.ts`.
4. Run scorer tests, focused core tests, existing `demo-1c`, current `demo-do30`, and new holdout live evaluations.
5. Compare against current tuned `demo-do30` final report and require `0` regressions before acceptance.
6. Rollback is limited to ranking and evaluation files because existing vector collections remain compatible.

## Open Questions

None. Acceptance should prioritize robust holdout quality and no regressions over forcing strict `30/30` on the original 30-query set.
