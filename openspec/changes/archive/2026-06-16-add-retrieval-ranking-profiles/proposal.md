## Why

The 1C residual-ranking work adds useful domain-specific boosts, but relying only on path auto-detection risks affecting non-1C repositories that happen to contain directories such as `Documents`, `Catalogs`, or `Reports`. A first-class ranking profile gives callers an explicit way to enable 1C ranking behavior for 1C codebases and disable it for generic projects.

## What Changes

- Add an explicit retrieval ranking profile with at least `auto`, `generic`, and `one-c` modes.
- Route the profile through the core search path so 1C-specific ranking signals are disabled in `generic`, explicitly enabled in `one-c`, and remain backward-compatible in `auto`.
- Expose the profile through MCP `search_code` and relevant evaluation/live-runner tooling.
- Allow a codebase default profile to be persisted only when explicitly configured, while always allowing search-time override.
- Add regression coverage proving non-1C projects with misleading path segments do not receive 1C boosts under `generic`.
- Keep existing search behavior backward-compatible for callers that do not pass a profile.
- Non-goal: change BGE-M3 vector storage, Qdrant schema, ColBERT reranking, daemon lifecycle, or embedding generation.
- Non-goal: add full language-specific ranking profiles for every stack in this change.
- Non-goal: hard-code `examples/demo-1c` query IDs, expected prefixes, or labels into production ranking.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `code-symbol-retrieval`: add an explicit ranking-profile contract that controls domain-specific 1C ranking signals while preserving semantic, lexical, symbol, and path retrieval behavior.

## Impact

- Affected code:
  - `packages/core/src/context.ts`
  - `packages/core/src/code-symbol-retrieval.ts`
  - `packages/core/src/context.code-symbol-retrieval.test.ts`
  - `packages/mcp/src/*` search tool schema and handler files
  - `scripts/run-demo-1c-relevance-eval.js`
  - `scripts/run-demo-1c-live-mcp-eval.js`
  - `scripts/run-demo-1c-relevance-eval.test.js`
  - Documentation or examples that describe 1C retrieval validation.
- Affected systems:
  - MCP `search_code` calls can explicitly request generic or 1C-aware ranking.
  - 1C live validation can require `one-c` instead of depending on path auto-detection alone.
  - Generic repositories receive a stronger guardrail against accidental 1C-specific boosts.
- Migration impact:
  - Existing indexed collections should not require reindexing if search-time profile override is supported.
  - Existing callers that omit the profile should keep current `auto` behavior.
  - Operators may optionally set an explicit stored profile later for deterministic defaults; the implementation must not infer and persist a profile silently.
