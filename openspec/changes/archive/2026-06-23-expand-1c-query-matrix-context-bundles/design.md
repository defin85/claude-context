## Context

The current universal 1C matrix has broad fixture and domain coverage, but most rows still prove that a single expected path can be found. The newer long-running-operations row introduced role-based bundle checks for one `demo-bp30-1c` target. This change scales that pattern so the matrix can evaluate whether semantic search gives an agent the set of contexts needed for real 1C work.

The production retrieval stack is not part of this change. Dense-only BGE-M3, full BGE-M3 dense+sparse+ColBERT retrieval, Qdrant/Milvus storage, and `search_code` ranking behavior remain unchanged. The work is limited to evaluation labels, scoring/reporting, live-evaluation workflow, and documentation.

## Goals / Non-Goals

**Goals:**

- Add role-based task scenarios across the primary demo configurations.
- Make query purpose explicit so matrix rows can be reviewed by intent rather than only by domain.
- Report missing result roles across a run, not only per query.
- Provide a repeatable live-evaluation workflow for actual semantic-search output.
- Keep matrix labels separate from production ranking.

**Non-Goals:**

- No new search planner or LLM decomposition service.
- No RLM enrichment in indexing or production search.
- No changes to BGE-M3 vector schema, ColBERT storage, sparse-vector storage, or index compatibility.
- No production query rewrites derived from matrix labels.
- No mandatory rebuild of existing indexed collections.

## Decisions

1. **Use role bundles as evaluation metadata.**

   Each task-oriented matrix target may declare required result roles with path prefixes. This extends the existing `requiredResultRoles` shape rather than introducing a separate dataset. The alternative, a separate task-bundle dataset, would reduce coupling but duplicate fixture applicability and label-validation logic.

2. **Introduce query-purpose classification in the matrix.**

   Rows will keep existing `intent`, `domain`, `kind`, and `controlClass`, and add a `queryPurpose` classification with one of `navigation`, `task-implementation`, `negative-control`, `library-oriented`, or `applied-usage`. `intent` remains the domain-specific user intent, while `queryPurpose` is the coarse audit bucket. This gives maintainers a way to audit coverage gaps without reading every path label.

3. **Start with 8-12 source-inspected task rows.**

   The matrix should grow enough to represent real agent tasks without turning the first implementation pass into exhaustive taxonomy work. A task row is a matrix query with `queryPurpose: "task-implementation"` and at least one applicable target declaring non-optional `requiredResultRoles`. Fixture coverage is counted per applicable target, so one reusable row may contribute to several fixtures when each target has source-inspected role labels.

4. **Prefer aggregate missing-role reporting over hard role thresholds initially.**

   Reports will show which roles most often fail across a run through a machine-readable `missingRequiredRolesById` summary and a Markdown section derived from it. Hard gates should only be added after live baselines exist, because current semantic-search quality varies by fixture, profile, and index freshness.

5. **Keep live evaluation external to production search.**

   Live runs should call the existing MCP search flow and score results afterward. This preserves the boundary that evaluation truth must not influence `search_code`.

## Risks / Trade-offs

- **Risk: Role labels become too scenario-specific.** -> Use reusable role names and require source-inspected paths; document why each scenario is useful for agent tasks.
- **Risk: Matrix growth makes reports noisy.** -> Add purpose and role summaries so maintainers can filter by fixture, purpose, domain, and missing role.
- **Risk: Live evidence becomes stale.** -> Record run metadata, backend, ranking profile, index status, and dates; treat live reports as evidence snapshots, not permanent truth.
- **Risk: More searches add evaluation latency.** -> This change affects evaluation and agent workflows only. It does not add production search latency. Storage impact is limited to JSON labels and Markdown/JSON artifacts.
- **Risk: Full BGE-M3 results differ from dense-only results.** -> Reports must record retrieval mode and ranking profile so dense-only and full BGE-M3 runs are not compared as if they were equivalent.
