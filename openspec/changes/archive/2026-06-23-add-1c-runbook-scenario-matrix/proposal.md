## Why

The 1C semantic-search runbook describes a multi-step way to gather implementation context, but the current evaluation matrix mostly measures one query at a time. We need a separate scenario matrix that evaluates whether the runbook workflow can collect a useful context bundle without turning runbook guidance into production ranking rules.

## What Changes

- Add a separate runbook-oriented 1C scenario matrix for multi-search context-bundle collection.
- Model each scenario around a user implementation task, required result roles, and fixture-specific source-inspected targets.
- Evaluate the workflow gain between the first broad query and the full role-focused search sequence.
- Report bundle completeness, missing roles, searches-to-complete, and backend/search metadata separately from single-query ranking metrics.
- Keep the existing universal 1C query matrix focused on single-query retrieval and regression checks.
- Keep scenario labels and generated search plans as evaluation artifacts only; production `search_code` SHALL NOT read them.

Non-goals:

- No production query planner or automatic query rewriting in MCP search.
- No scenario-specific ranking boosts or label-derived production rules.
- No replacement of the existing universal 1C matrix or historical ranking baselines.
- No RLM indexing enrichment or RLM dependency for production search.
- No migration or rebuild requirement for existing indexed collections.

## Capabilities

### New Capabilities

- `one-c-runbook-scenario-matrix`: Defines and evaluates runbook-style multi-search context-bundle scenarios for exported 1C configurations.

### Modified Capabilities

- None.

## Impact

- Affected evaluation data: new runbook scenario matrix under `evaluation/retrieval/`.
- Affected scripts: scenario runner, scorer, validation, and report generation under `scripts/`.
- Affected documentation: 1C semantic-search runbook and evaluation documentation for running and interpreting scenario checks.
- Affected runtime APIs: none.
- Existing indexed collections: no migration or rebuild required.
