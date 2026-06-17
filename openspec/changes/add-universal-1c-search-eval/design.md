## Context

The repository already has several 1C ranking evaluation layers:

- `demo-1c-relevance.json` covers a small educational fixture and is useful as a fast regression check.
- `demo-do30-1c-scenarios.json` covers a larger document-management fixture and exposed realistic 1C ranking failures.
- The local workspace now also contains ignored exported configurations for `demo-bp30-1c` (Бухгалтерия предприятия 3.0), `demo-ut-1c` (Управление торговлей 11), and `demo-unf-1c` (Управление небольшой фирмой 3.0).

The next quality problem is portability. A single-fixture dataset can drive useful fixes, but it cannot prove that a `one-c` ranking signal is generic. The universal evaluation must separate the reusable query intent from fixture-specific labels: the query and intent are common, while expected path prefixes are scoped per configuration where that scenario exists.

This change is evaluation-first. It should provide evidence for later ranking work without forcing a production ranking change in the same step.

## Goals / Non-Goals

**Goals:**

- Define a universal 1C query matrix with reusable intents and per-configuration applicability.
- Cover common 1C developer tasks across metadata navigation, document posting, forms, commands, reports, registers, БСП mechanisms, ЭДО, signatures, accounting, trade, warehouse, and УНФ scenarios.
- Add negative controls for broad generic terms that often cause over-ranking.
- Validate labels against each target fixture before any metric is accepted.
- Report quality by configuration, domain, intent, and control class so aggregate scores cannot hide portability failures.
- Preserve existing `demo-1c` and `demo-do30-1c` baselines.

**Non-Goals:**

- Do not tune production weights per configuration name, synonym, version, or fixture path.
- Do not require every query to apply to every configuration.
- Do not change BGE-M3 dense-only behavior, full BGE-M3 dense+sparse+ColBERT storage, Qdrant schema, chunking, or indexing scope.
- Do not require a new index for existing collections.
- Do not make universal dataset labels available to production `search_code`.

## Decisions

### Decision: Use a matrix dataset instead of one dataset per configuration

The dataset should model each query once, with fields such as `id`, `query`, `intent`, `domain`, `kind`, `controlClass`, and `targets`. Each target entry should be keyed by fixture name and include `status`, strict expected prefixes, acceptable prefixes, and notes.

Example shape:

```json
{
  "id": "u-doc-posting-01",
  "query": "проведение документа движения по регистрам",
  "intent": "document-posting",
  "domain": "metadata-navigation",
  "kind": "positive",
  "targets": {
    "demo-bp30-1c": {
      "status": "applicable",
      "expectedPathPrefixes": ["Documents/.../Ext/ObjectModule.bsl"]
    },
    "demo-do30-1c": {
      "status": "not-applicable",
      "reason": "No source-inspected representative target selected"
    }
  }
}
```

Alternative considered: create four independent datasets. That would be easier to run but would hide whether the same query intent is portable, and it would encourage configuration-specific tuning.

### Decision: Applicability is explicit and validated

Target status should be explicit: `applicable`, `not-applicable`, `optional`, or `needs-inspection`. Acceptance may only score `applicable` targets. `optional` targets can be reported but not used as hard thresholds. `needs-inspection` must fail strict acceptance so incomplete labeling cannot masquerade as quality evidence.

Alternative considered: treat missing labels as misses. That would unfairly punish configurations where the scenario does not exist.

### Decision: Negative controls are first-class query rows

Negative controls should not need strict expected path prefixes. They should define prohibited over-ranking patterns, such as "generic `подпись` must not force an unrelated ЭДО signature form above better-supported broad results." Reports should count negative-control pass/fail separately from positive Hit@k.

Alternative considered: encode negative controls as notes on positive queries. That makes failures hard to count and easy to ignore.

### Decision: Keep live collection separate from scoring

The existing pattern of collecting raw MCP results and then scoring saved JSON should remain. Universal matrix scoring should accept saved results per fixture and produce a combined report. Live runners can orchestrate multiple fixture runs, but scoring must remain reproducible from raw artifacts.

Alternative considered: one monolithic live command that collects and scores everything only once. That would make failures expensive to reproduce and harder to compare.

### Decision: Full BGE-M3 evidence is recorded but not required by the dataset shape

Reports should record backend label, retrieval mode, ranking profile, index status, and missing ColBERT vector counts when available. The universal matrix should still be scoreable from saved top paths so dense-only, full BGE-M3, and fallback runs can be compared. Full BGE-M3 dense+sparse+ColBERT live acceptance can require `0` missing ColBERT vector errors; dataset validation itself should not.

## Risks / Trade-offs

- [Risk] Label collection across four large fixtures is slow and can become the real bottleneck. Mitigation: start with a bounded 40-positive and 6-negative matrix, require `needs-inspection` markers, and expand only by new intent class.
- [Risk] A universal query may be linguistically generic but semantically different across configurations. Mitigation: per-target notes and acceptable prefixes must be source-inspected before scoring.
- [Risk] Aggregate matrix scores can hide a regression in one domain. Mitigation: reports must include grouped metrics by fixture, domain, intent, and query ID.
- [Risk] Negative controls can become vague. Mitigation: each negative control must define concrete prohibited patterns and pass/fail criteria.
- [Risk] Multi-fixture live runs increase storage and latency cost. Mitigation: keep raw artifacts under `.artifacts/`, support saved-result scoring, and allow per-fixture runs before combined reports.
- [Risk] Ignored example fixtures are not present on every developer machine. Mitigation: validation should fail clearly when a required fixture path is missing and support fixture manifests for review.

## Migration Plan

1. Add the universal matrix dataset and validation tests without changing production ranking.
2. Extend the scorer to load matrix targets, validate fixture labels, and report grouped metrics.
3. Add runner support for saved-result and live per-fixture scoring.
4. Capture initial baselines for `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c`.
5. Use the matrix as non-regression evidence for later ranking changes.

Rollback is simple: remove the universal dataset and scorer/runner extensions. Existing `demo-1c` and `demo-do30-1c` workflows should remain untouched and continue to validate old datasets.

## Open Questions

None for the proposal. Initial thresholds should be set after the first source-inspected baseline run rather than guessed in advance.
