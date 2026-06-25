## Context

The repository already has two related assets:

- `docs/dive-deep/one-c-semantic-search-runbook.md`, which describes a universal agent workflow for collecting a small 1C implementation context bundle.
- `evaluation/retrieval/universal-1c-search-matrix.json`, which is useful for single-query retrieval quality, negative controls, and role coverage inside one query result set.

Recent live measurements showed that a single broad query often does not collect all roles in a context bundle, while focused role-specific queries can find missing modules. That is expected under the runbook, so the evaluation layer needs a separate scenario matrix that measures the multi-step workflow instead of forcing the existing matrix to represent both concerns.

This change is evaluation-only. It does not change production indexing, vector schemas, ranking signals, `search_code` behavior, MCP APIs, or existing indexed collections. Dense-only BGE-M3 and full BGE-M3 dense+sparse+ColBERT runs must remain distinguishable in reports because their ranking and latency characteristics differ.

## Goals / Non-Goals

**Goals:**

- Add a committed scenario matrix that represents runbook-style 1C implementation tasks.
- Evaluate a multi-step workflow: broad task search, inferred/focused role searches, and context-bundle aggregation.
- Keep single-query ranking metrics separate from scenario bundle metrics.
- Report workflow gain, missing roles, searches-to-complete, retrieval mode, ranking profile, and backend correctness metadata.
- Reuse source-inspected target labels from existing evaluation work where appropriate without coupling the new matrix to one historical measurement.

**Non-Goals:**

- No production query planner or automatic query rewriting in MCP search.
- No scenario-derived production ranking rules.
- No replacement of the universal 1C matrix or existing ranking baselines.
- No new vector storage, schema migration, or reindex requirement.
- No requirement that RLM participate in production indexing or search.

## Decisions

1. **Use a separate scenario matrix file.**

   The new data should live separately from `universal-1c-search-matrix.json`, for example as `evaluation/retrieval/one-c-runbook-scenario-matrix.json`.

   Alternative considered: add scenario workflow metadata to the universal matrix. That would reuse existing validation code, but it would blur two different contracts: one-query retrieval quality and multi-search context gathering.

2. **Represent scenarios as tasks, roles, and fixture targets, not fixed query scripts.**

   Each scenario should define a user task, required roles, and fixture-specific source-inspected paths. The scenario runner may optionally store generated/focused query attempts in artifacts, but the matrix should not require one exact query wording for success.

   Alternative considered: hard-code broad and focused query strings into the dataset. That would be easier to score, but it would overfit the runbook to one handcrafted query sequence.

3. **Score first-query baseline and workflow completion separately.**

   Reports should show what the broad query found by itself and what the scenario workflow collected after focused searches. This preserves evidence about single-query ranking quality while measuring the actual runbook behavior.

   Alternative considered: only score final bundle completeness. That would hide whether improvements came from better initial retrieval or from extra searches.

4. **Keep workflow execution deterministic enough for CI but flexible enough for live MCP evidence.**

   The first implementation can use a deterministic scenario runner with explicit role hints derived from scenario metadata. Later work may compare an agent-generated query sequence against the same matrix, but the contract should not require an LLM planner.

   Alternative considered: require an LLM-driven agent run. That would match real usage more closely, but it would make local validation slower, less reproducible, and harder to gate.

5. **Treat storage and latency as evaluation costs.**

   Scenario runs execute multiple searches per user task, so live checks will take longer and produce larger artifacts than single-query runs. This cost is acceptable for evaluation and agent guidance, but it must not affect production search latency. Reports should record search counts and per-search latency where available.

6. **Record requested and effective result depth.**

   Scenario scoring should not assume that a requested `topK` or `limit` was honored by the live MCP path. Each per-search artifact should record both the requested result limit and the number of results actually returned, so bundle failures caused by result-depth caps are distinguishable from ranking or workflow failures.

   Alternative considered: make a larger result depth a hard prerequisite. That would block useful scenario baselines on the current live path and hide the compatibility issue instead of reporting it.

## Risks / Trade-offs

- **Risk: The scenario matrix becomes a hidden query cookbook.** -> Store tasks, roles, and expected context targets as the durable truth; keep generated query attempts in run artifacts, not as mandatory production behavior.
- **Risk: Maintainers confuse scenario failures with ranking failures.** -> Report first-query baseline, focused-query role recall, and backend errors separately.
- **Risk: More live searches increase evaluation time.** -> Allow fixture selection and scenario selection; keep hard gates based on deterministic validation and measured baselines.
- **Risk: Source-inspected labels drift as demo fixtures change.** -> Validate path prefixes before scoring and fail clearly on unreachable labels.
- **Risk: Dense-only and full BGE-M3 runs are compared incorrectly.** -> Persist retrieval mode, ranking profile, backend label, index status, and ColBERT availability in every live report.

## Migration Plan

No migration is required for existing indexed collections. The change adds evaluation data, scripts, and documentation only.

Rollback is deleting the new scenario matrix, scripts, docs, and generated artifacts. Existing universal matrix workflows and production MCP search continue to work independently.

## Open Questions

- Which 5-8 initial scenarios should be included in the first implementation pass: long operations, SMS, EDI, report variants, storage-volume cleanup, DSS/cryptography, MCHD, or another mix?
- Should the first runner use only deterministic role hints, or also support an optional agent-generated query sequence for comparison?
- What minimum bundle-completeness threshold is reasonable after the first baseline run?
