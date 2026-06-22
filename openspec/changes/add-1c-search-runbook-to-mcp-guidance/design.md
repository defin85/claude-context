## Context

`search_code` is both an API surface and an agent-facing instruction surface: MCP clients discover the tool description before deciding how to search. The repository already has a universal 1C semantic search runbook in `docs/dive-deep/one-c-semantic-search-runbook.md`, and the scenario-matrix measurements showed that broad 1C tasks often need several focused searches to gather enough context.

The current retrieval stack and ranking-profile contract already distinguish generic and 1C-specific ranking behavior. This change does not alter dense-only BGE-M3 behavior, full BGE-M3 dense+sparse+ColBERT retrieval, hybrid symbol retrieval, storage schemas, or scoring. It only makes the existing 1C search workflow discoverable from MCP guidance.

## Goals / Non-Goals

**Goals:**

- Teach agents to treat non-trivial 1C requests as a context-bundle search task.
- Keep guidance generic: use role-based searches for library API, client usage, server usage, applied usage, and metadata/state.
- Point agents to the maintained runbook for the longer workflow.
- Preserve the existing `rankingProfile` contract and evaluation-label boundary.
- Add tests that catch accidental removal of the 1C guidance or leakage of scenario labels into MCP tool text.

**Non-Goals:**

- No changes to semantic, lexical, ColBERT, provider, duplicate-diversity, or 1C intent scoring.
- No prompt-time query planner or automatic multi-search orchestration.
- No new MCP schema fields.
- No new indexed fields, storage migrations, or collection rebuilds.
- No dependency on `rlm-tools-bsl` availability.

## Decisions

1. Put a concise 1C workflow hint in the `search_code` tool description.

   The tool description is the only guidance reliably available at MCP tool-discovery time. The alternative was to keep the workflow only in documentation, but agents can miss that when they start from an MCP tool list.

2. Keep detailed procedural guidance in documentation and link to the runbook.

   The MCP description should remain short enough to be useful in tool lists. The longer runbook remains the source for examples, interpretation rules, and deeper troubleshooting.

3. Describe searches by context role, not by evaluation scenario.

   The guidance should say "library API", "client usage", "server usage", "applied usage", and "metadata/state". It must not mention scenario IDs, expected paths, fixture answers, or labels from evaluation matrices. This preserves the production boundary already required by `code-symbol-retrieval`.

4. Warn about indexed coverage limits for metadata/state.

   Some exported 1C root XML metadata can be valid context but absent from the indexed scope/profile. The guidance should tell agents to inspect index/profile coverage or filesystem context when `search_code` cannot find an expected metadata/state target.

## Risks / Trade-offs

- Tool description becomes too long -> keep MCP text concise and move details to docs.
- Agents mistake guidance for scoring behavior -> explicitly state that ranking profiles and search scoring are unchanged.
- Evaluation labels leak into runtime guidance -> add a test that asserts the tool description stays generic.
- Documentation link drifts -> reference the repo-local runbook path from MCP docs and keep implementation text minimal.

Storage trade-off: none. This change does not add fields or collections and does not require reindexing.

Latency trade-off: none in code paths. Agents may choose to run several searches for harder 1C tasks, but MCP search execution remains unchanged.

## Migration Plan

- Update MCP tool guidance and documentation.
- Run the focused MCP tests plus normal TypeScript validation for the touched package.
- Rollback is a text-only revert of the guidance and docs; no data migration is involved.

## Open Questions

- None for proposal scope. Implementation may choose the exact helper/module that owns the `search_code` description after inspecting the current MCP registration code.
