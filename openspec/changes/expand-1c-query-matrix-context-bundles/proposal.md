## Why

The universal 1C query matrix is now useful for regression checks, but it still mostly validates single-path retrieval. To measure whether an agent can gather enough context for real 1C implementation tasks, the matrix needs more role-based task scenarios, clearer query categories, and repeatable live evidence.

## What Changes

- Expand the universal 1C matrix with 8-12 task-oriented scenarios that require multi-role context bundles, not just one expected path.
- Ensure every primary demo configuration has at least 2-3 role-based scenarios covering library API, client usage, server usage, applied examples, and metadata where relevant.
- Classify matrix rows by query purpose: navigation, task implementation, negative control, library-oriented, and applied configuration usage.
- Add reporting that highlights which required result roles are most often missing across a run.
- Add a repeatable live-evaluation workflow for periodically checking actual semantic-search output against the matrix.
- Keep matrix labels as evaluation truth only; do not turn them into production ranking rules or query rewrites.

Non-goals:

- No new LLM query planner.
- No RLM calls during indexing or production search.
- No scenario-specific production ranking rules.
- No migration or rebuild requirement for existing indexed collections.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `demo-1c-retrieval-ranking`: Extend the universal 1C evaluation matrix from path-level retrieval checks to role-based task-context coverage and live-quality reporting.

## Impact

- Affected evaluation data: `evaluation/retrieval/universal-1c-search-matrix.json`.
- Affected scripts: relevance scoring, matrix validation, and live-report generation scripts under `scripts/`.
- Affected documentation: evaluation/runbook documentation for maintaining and running the 1C matrix.
- Affected runtime APIs: none.
- Existing indexed collections: no migration required.
