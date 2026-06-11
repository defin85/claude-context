## Context

`complete-qdrant-bge-m3-retrieval` proved that the Qdrant default backend can store and retrieve BGE-M3 full vectors for `examples/demo-1c`: live MCP search has 0 tool errors and 0 missing ColBERT vector errors. The remaining acceptance gap is ranking quality. The latest live report shows Hit@10 18/30, with misses where the expected 1C object is present in the indexed codebase but broad modules, generic forms, or repeated chunks outrank it.

Current code-symbol fusion in `packages/core/src/code-symbol-retrieval.ts` adds semantic score, lexical score, exact-symbol boost, path boost, and optional provider-rank boost. This is simple and explainable, but it does not sufficiently model 1C metadata structure. Examples from the live report:

- document-specific print command queries over-rank `Documents/РасходТовара/Ext/ObjectModule.bsl`;
- list/card form queries over-rank unrelated `ФормаСписка` or `ФормаЭлемента` modules;
- catalog/register/report queries over-rank common document object modules that share domain words;
- multiple chunks from one file can crowd out more specific target objects in the top 10.

The existing `evaluation/retrieval/demo-1c-relevance.json` labels are evaluation truth only and already state `labelsAreProductionRules: false`. Tuning must improve general ranking signals, not hard-code those labels into production search.

## Goals / Non-Goals

**Goals:**

- Make the `demo-1c` relevance evaluation reproducible from a committed command or script, including live MCP output capture and scoring.
- Capture a baseline before ranking changes and a tuned report after changes, both with per-query misses and score-component diagnostics.
- Improve BSL/1C ranking by using general metadata-aware signals:
  - object kind and metadata object name matches in `relativePath`;
  - intent terms for catalogs, documents, registers, reports, commands, item/list/document forms, and print commands;
  - duplicate control across repeated chunks from the same file;
  - clear score diagnostics for every top result.
- Raise the live Qdrant default Hit@10 on the current 30-query set from 18/30 to a defined acceptance threshold without introducing MCP tool errors.
- Keep BGE-M3 full backend correctness separate from ranking quality.

**Non-Goals:**

- No Qdrant schema, vector insertion, ColBERT retrieval, sidecar, or daemon lifecycle changes.
- No automatic reindex requirement for existing collections.
- No hard-coded routing from query IDs, expected path prefixes, or `demo-1c` labels.
- No claim that `demo-1c` alone proves production-grade ranking for every 1C configuration.
- No broad redesign of the whole retrieval architecture unless the local scoring changes cannot meet the acceptance threshold.

## Decisions

### Decision: Treat the current 18/30 live run as the baseline

The implementation will preserve the current live Qdrant default run as baseline evidence and compare tuned output against it. The baseline is not a failure of Qdrant storage; it is a ranking baseline.

Rationale:

- The backend path is now working and stable enough for quality tuning.
- Keeping a baseline prevents accidental regressions from being hidden by subjective examples.
- The current misses are concrete enough to guide targeted ranking changes.

Alternative considered: tune by ad hoc manual search examples only. This is faster initially but gives no regression protection.

### Decision: Validate labels before treating the target threshold as a hard gate

Before using Hit@10 24/30 as the tuned acceptance gate, the implementation must verify that every expected path prefix either exists in the indexed `examples/demo-1c` fixture or is explicitly marked stale, unreachable, or intentionally ambiguous in the report. Label fixes must stay in the evaluation dataset and must not become production search rules.

Rationale:

- The target threshold is meaningful only if the labels describe paths that can be returned by the current fixture and index scope.
- Separating label validation from ranking changes prevents a score increase from hiding stale test truth.
- The production rule remains unchanged: `demo-1c` query IDs and expected prefixes are evaluation-only data.

Alternative considered: tune against the current labels first and review stale labels only after misses remain. That is faster, but it can waste work on unreachable paths and weaken the acceptance evidence.

### Decision: Add a committed live acceptance runner instead of relying on one-off shell snippets

The implementation should add or extend a script that calls the discovered MCP daemon, runs the 30 query set, saves raw results, and invokes the existing scoring logic. The script should be parameterized by codebase path, output directory, limit, and backend label.

Rationale:

- The existing `scripts/run-demo-1c-relevance-eval.js` scores saved results but does not itself collect live MCP output.
- A committed runner makes future ranking changes repeatable.
- The same runner can be used for Qdrant, Milvus, or LanceDB comparisons when needed.

Alternative considered: keep storing manual artifacts only. That is acceptable for smoke checks, but not for iterative quality tuning.

### Decision: Use one canonical live-result schema for collection, scoring, comparison, and reports

The committed runner and scoring code SHALL share one machine-readable schema for live results. Existing live artifacts such as `results[].top10[].path` and new runner output must be normalized before scoring so a format mismatch cannot silently score every query as missing. Unsupported result schemas must fail with an explicit error that identifies the missing fields.

Rationale:

- The existing saved live MCP report format is useful evidence, but it is not the same shape as the older saved-results scorer input.
- Ranking acceptance depends on trustworthy measurement; a parser mismatch that reports 0/30 would waste tuning effort and hide real regressions.
- A single normalization point keeps future Qdrant, Milvus, and LanceDB comparison artifacts compatible.

Alternative considered: keep separate collectors and scorers per artifact generation path. That makes short-term scripting easier but increases the chance that baseline and tuned runs are not actually comparable.

### Decision: Tune general 1C-aware ranking signals, not dataset labels

Ranking should infer query intent from tokens and result path/metadata, then apply generic boosts or penalties. Examples include recognizing `справочник`, `документ`, `регистр`, `отчет`, `форма списка`, `форма элемента`, `карточка`, `печать`, and matching those intents to path segments such as `Catalogs`, `Documents`, `AccumulationRegisters`, `Reports`, `Commands`, and `Forms`.

Rationale:

- This addresses the observed misses without binding production behavior to test IDs.
- 1C exported configuration paths encode useful metadata structure.
- The existing scoring pipeline already exposes `pathBoost`, `exactSymbolBoost`, and diagnostics, so it can be extended without changing vector storage.

Alternative considered: add the expected path prefixes as a production rule table. This would inflate the eval score but violate the dataset contract and fail outside `demo-1c`.

### Decision: Limit duplicate crowding after fusion

The final top-K list should avoid letting repeated chunks from a single broad file consume most of the result budget when other high-scoring files exist. Duplicate control can be implemented as a reranking penalty, a per-file soft cap, or a diversity pass after scoring, but it must preserve enough chunks for valid multi-hit files.

Rationale:

- Current misses show repeated `ObjectModule.bsl` chunks crowding out target commands/forms.
- This is a ranking presentation problem, not an indexing problem.
- Diversity improves navigation-style search while still allowing exact high-confidence file matches.

Alternative considered: deduplicate all results by file. That could hide useful line-specific hits and is too aggressive.

Implementation acceptance for duplicate control should include a deterministic fixture where many chunks from one broad file and at least one more specific matching file compete for top-10. The more specific file must remain in top-10, duplicate penalties or diversity reasons must be visible in diagnostics, and exact-symbol or provider-backed matches must not be removed solely by file-level diversity.

### Decision: Keep score diagnostics mandatory for tuned results

Top results in acceptance artifacts should include enough metadata to explain why they ranked where they did: semantic score, lexical score, exact-symbol boost, path boost, 1C intent/object boost, duplicate penalty or diversity reason, and fusion score.

Rationale:

- Ranking changes are otherwise hard to review.
- Diagnostics make it possible to separate semantic model behavior from deterministic path/object boosts.
- Future tuning can use the same artifacts rather than re-instrumenting the code.

Alternative considered: inspect logs manually during implementation. That does not create durable evidence.

## Risks / Trade-offs

- Overfitting to `demo-1c` terms -> require general 1C path and intent rules, keep labels out of production code, and include regression tests for generic behavior.
- Boosts can degrade semantic-only queries -> compare baseline and tuned reports, require no increase in tool errors or missing ColBERT errors, and keep score-component diagnostics in both aggregate and per-query artifacts.
- A live-result parser mismatch can create false ranking failures -> require schema normalization tests for the existing `qdrant-fixed-mcp-search-30-report.json` shape and any new runner output shape.
- Duplicate control can hide legitimate repeated chunks -> use a soft penalty or cap rather than full file-level deduplication.
- More diagnostics can enlarge MCP responses -> keep diagnostics in metadata fields already used by code-symbol retrieval and avoid returning vectors or large debug payloads.
- 1C path heuristics may not cover every exported configuration shape -> keep unknown paths neutral and avoid failing search on unrecognized structure.

## Migration Plan

1. Keep existing indexes in place; no reindex is required for ranking-only changes.
2. Capture or preserve the current Qdrant default baseline report with Hit@10 18/30.
3. Validate the relevance labels against the indexed `examples/demo-1c` fixture before using the target threshold as a hard gate.
4. Add the committed live evaluation runner and verify it can reproduce a baseline against the existing daemon/index.
5. Add focused unit tests for 1C object-kind/path boosts and duplicate control.
6. Implement tuning changes in `packages/core/src/code-symbol-retrieval.ts`.
7. Re-run focused tests, builds, and the live `examples/demo-1c` acceptance set.
8. If tuned ranking causes unacceptable regressions, rollback is a code revert only; existing vector collections remain usable.

## Open Questions

- Should the live acceptance runner be generic enough for all codebases now, or stay scoped to `demo-1c` until the ranking loop stabilizes?
