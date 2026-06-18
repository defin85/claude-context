## Context

The current large-fixture live probe used `examples/demo-do30-1c`, Qdrant, BGE-M3 full retrieval, and `rankingProfile=one-c`. Indexing completed with `6595` indexed files and `113988` chunks. A manually inspected 30-query scenario set produced `14/30` strict Top-1 hits and `20/30` strict Top-5 hits.

The misses are concentrated in two patterns:

- broad subsystem files win over the concrete scenario object, for example common MCHD modules outrank inbound/outbound EDI viewing forms;
- generic lexical or path matches win over intent, for example `обработка`, `состояние`, `проверка`, `подпись`, or `письмо` can dominate the expected FNS, email, SMS, or constant file.

This is a ranking problem, not a storage or indexing problem. Full BGE-M3 dense+sparse+ColBERT retrieval is already available for the indexed collection; the change should preserve that storage shape and improve candidate ordering after retrieval.

## Goals / Non-Goals

**Goals:**

- Turn the 30 manually inspected `demo-do30-1c` scenarios into committed, repeatable quality data.
- Report strict expected-file hits separately from acceptable neighboring-context hits.
- Improve `one-c` ranking for scenario queries that name a concrete object kind or workflow location.
- Keep broad subsystem modules highly ranked when the query is broad or when they are the best development entry point.
- Preserve the old `demo-1c` relevance checks while adding larger-fixture coverage.
- Require live Qdrant validation against the indexed `demo-do30-1c` fixture before completion.

**Non-Goals:**

- No Qdrant schema, vector storage, dense/sparse/ColBERT mode, chunking, or reindex requirement.
- No production dependency on evaluation labels, query IDs, or expected path prefixes.
- No global deboost of common modules; common modules remain valid results when query evidence supports them.
- No guarantee that every scenario returns a strict expected file at rank 1 when an acceptable neighboring context is more useful.

## Decisions

### Decision: Add a separate `demo-do30-1c` scenario dataset

Create a new dataset under `evaluation/retrieval/` instead of expanding the small `demo-1c` dataset.

Rationale:

- `demo-1c` is small and already tuned around residual fixed cases.
- `demo-do30-1c` exposes large-configuration behavior: many common modules, many forms, and many near-name collisions.
- Keeping datasets separate makes regressions easier to interpret.

Alternative considered: merge all queries into `demo-1c-relevance.json`. That would blur fixture scope and make historical score comparisons noisy.

### Decision: Score strict and acceptable hits separately

Each scenario should have:

- `expectedPathPrefixes` for the strict target file or files;
- `acceptablePathPrefixes` for legitimate neighboring entry points;
- an optional `failureClass` or note for later analysis.

Rationale:

- Some current "misses" are useful results, for example SMS service modules for an SMS sending query.
- Strict scoring is still needed to improve concrete navigation.
- Acceptable scoring prevents us from optimizing against a bad or too-narrow label.

Alternative considered: only broaden expected labels. That inflates quality metrics and hides whether the concrete target improved.

### Decision: Make scenario intent explicit but bounded

The ranking layer should infer intent from query terms and candidate evidence, for example:

- object kind: form, common form, document, report, constant, command, journal, manager module, object module;
- workflow direction: inbound/outbound, email, EDI, MCHD, FNS, SMS, archive transfer;
- action: print, save, send, configure, check, update, display, open.

Signals must be bounded and require supporting candidate evidence from path, metadata object name, chunk text, lexical score, semantic score, exact-symbol evidence, or provider evidence.

Rationale:

- The current `one-c` ranking already has object/path boosts, but large configurations need finer context gating.
- A bounded signal can reorder close candidates without replacing semantic retrieval.

Alternative considered: add large static boosts for object kinds. That risks making forms or reports dominate unrelated conceptual queries.

### Decision: Penalize generic lexical dominance only when intent is concrete

The implementation should identify generic terms that commonly over-match in 1C code, such as `обработка`, `состояние`, `проверка`, `подпись`, `настройка`, and `письмо`. These terms should not be removed from search, but their lexical contribution should be dampened or counterbalanced when the query also contains more specific evidence like `NdsResponse`, `ФНС`, `МЧД`, `исходящий`, `входящий`, `реестр`, `SMS`, or an object-name phrase.

Rationale:

- Generic terms are meaningful in some queries, so a global stop-word rule would be harmful.
- The failure mode is dominance, not presence.

Alternative considered: add a Russian stop-word list for 1C. That would be too coarse and would break legitimate searches for generic platform concepts.

### Decision: Keep ranking changes label-free

Production `search_code` must not read:

- scenario IDs;
- expected path prefixes;
- acceptable path prefixes;
- fixture-specific notes.

The dataset is only for tests, reports, and acceptance gates.

Rationale:

- This keeps improvements reusable for other 1C configurations.
- It matches the existing OpenSpec rule that evaluation labels are test truth only.

Alternative considered: production fixture overrides. That would pass the local probe but would not improve real search.

### Decision: Live acceptance is a quality gate, not a replacement for unit tests

Implementation should include:

- focused unit tests for score component behavior and failure classes;
- scorer tests for strict versus acceptable hits;
- a live `demo-do30-1c` run against Qdrant default as final evidence.

Rationale:

- Unit tests protect the ranking rules from accidental drift.
- The live run proves the integrated BGE-M3/Qdrant path behaves with the real indexed fixture.

Alternative considered: rely only on the 30-query live run. That would make failures harder to diagnose and could allow small deterministic ranking regressions to hide behind live noise.

## Risks / Trade-offs

- [Risk] Stronger form/report/document signals can hurt broad conceptual search. Mitigation: require concrete query intent and supporting candidate evidence.
- [Risk] Acceptable-hit labels can mask strict navigation failures. Mitigation: report strict Top-1/Top-5 and acceptable Top-1/Top-5 separately.
- [Risk] Generic-term dampening can suppress legitimate exact searches. Mitigation: dampen only when more specific query evidence is present and keep exact-symbol/provider evidence protected.
- [Risk] Large-fixture live scores can drift with daemon/index state. Mitigation: record index status, backend, retrieval mode, ranking profile, raw results, scored report, and comparison report.
- [Risk] Improvements for `demo-do30-1c` may regress the existing small `demo-1c` suite. Mitigation: require both focused tests and the existing `demo-1c` evaluation checks.

## Migration Plan

1. Add the `demo-do30-1c` dataset and scoring support without changing production ranking.
2. Capture a baseline report from the current indexed Qdrant collection.
3. Add focused ranking/scorer tests that reproduce the observed failure classes.
4. Implement bounded `one-c` ranking refinements.
5. Run unit tests, scorer tests, existing `demo-1c` evaluation, and live `demo-do30-1c` acceptance.
6. If ranking worsens, rollback is limited to code and evaluation-data changes; existing vector collections remain usable because no reindex or schema migration is required.

## Open Questions

None. Initial acceptance targets are strict Top-1 at least `18/30`, strict Top-5 at least `24/30`, and no regression in the existing `demo-1c` acceptance checks. Current ambiguous cases should start as strict misses with separately recorded acceptable alternates; labels can be broadened only when source inspection proves the alternate is a legitimate development entry point.
