## Context

Search results already include relative path, line range, language, score, content, and metadata in many retrieval paths. The dashboard currently renders only a compact subset and always sends a basic query.

## Goals / Non-Goals

Goals:
- Let operators choose extension filters and ranking profile.
- Show retrieval configuration before and after search.
- Make score and source diagnostics visible without overwhelming the main result list.

Non-goals:
- Changing retrieval algorithms.
- Building a source viewer.
- Persisting query history beyond optional local UI state.

## Decisions

### Decision: Add compact controls, not a separate advanced page

Place extension filters and ranking profile selector next to the search box.

Rationale: These are part of normal search operation and should be discoverable.

### Decision: Render diagnostics progressively

Show primary fields in each result row and secondary metadata in an expandable details area.

Rationale: Operators need details sometimes, but result scanning must remain dense.

### Decision: Keep not-indexed behavior explicit

Search errors for unindexed codebases remain visible and do not trigger indexing automatically.

Rationale: Indexing is an operator action, not a side effect of search.

## Risks / Trade-offs

- Metadata shape can vary by retrieval mode. The UI should tolerate missing fields.
- Ranking profile controls can imply guarantees. Labels must state the selected profile, not promise better results.
- Copy actions require clipboard permissions. Fall back to selecting visible text if clipboard write fails.

## Migration Plan

No migration. Search requests continue to call the dashboard API adapter over existing `search_code`.
