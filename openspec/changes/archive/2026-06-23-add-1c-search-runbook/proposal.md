## Why

Current 1C search quality depends too much on whether an agent already knows the right BSP or application terms. A single natural-language semantic query can miss the complete implementation context that an LLM needs, even when the indexed codebase contains the correct modules and examples.

This change documents a repeatable search runbook for 1C repositories so agents can use existing semantic search effectively without adding another LLM planner or tuning every scenario by hand.

## What Changes

- Add a concise 1C semantic-search runbook for agents.
- Define a multi-query search pattern that starts with the user task, then searches for inferred 1C/BSP terms, client-side usage, server-side usage, and applied examples.
- Add guidance for collecting results by role: API module, client module, server wrapper, applied usage, and related metadata.
- Add or adjust evaluation coverage so at least one matrix row verifies that a user task such as implementing long-running operations can retrieve a useful context bundle, not just one matching file.
- Document non-goals:
  - No new LLM planner for search query decomposition.
  - No RLM enrichment during indexing or production search.
  - No production ranking rules derived directly from matrix labels.
  - No migration of existing indexed collections.

## Capabilities

### New Capabilities
- `one-c-search-runbook`: Agent-facing guidance and acceptance expectations for using semantic search in exported 1C repositories.

### Modified Capabilities
- `demo-1c-retrieval-ranking`: Universal 1C evaluation shall include coverage for runbook-style context bundle retrieval, starting with the long-running operations scenario.

## Impact

- Affected documentation: agent-facing or repository documentation for 1C semantic search usage.
- Affected evaluation data: `evaluation/retrieval/universal-1c-search-matrix.json`.
- Affected tests: matrix validation and relevance-evaluation tests.
- Affected runtime APIs: none.
- Existing indexed collections: no migration required; this change uses current `search_code` behavior and existing `rankingProfile` support.
