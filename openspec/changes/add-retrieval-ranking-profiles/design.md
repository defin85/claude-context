## Context

Hybrid code-symbol retrieval currently fuses semantic results with lexical, path, symbol-provider, and bounded 1C path signals inside `Context.semanticSearch`. The 1C signals are guarded by path recognition, but path recognition alone can be ambiguous for non-1C repositories that use directories named `Documents`, `Catalogs`, `Reports`, `CommonForms`, or `Commands`.

The current 1C ranking work should remain available for exported 1C configurations and `examples/demo-1c`, but generic codebases need an explicit way to opt out of 1C-specific boosts. This change introduces a first-class ranking profile that can be specified at search time and, when explicitly configured by an operator or caller, persisted as codebase configuration.

## Goals / Non-Goals

**Goals:**

- Add a typed ranking profile with `auto`, `generic`, and `one-c`.
- Keep existing callers backward-compatible by making omitted profile behave like `auto`.
- Make `generic` disable 1C-specific object-kind, object-name, and intent boosts while preserving semantic, lexical, exact-symbol, path, provider, and duplicate-diversity behavior.
- Make `one-c` explicitly enable 1C ranking signals for known 1C codebases and live 1C evaluation.
- Expose the profile through MCP `search_code` and relevant scripts.
- Add tests that prove non-1C repositories with misleading path segments do not receive 1C boosts under `generic`.

**Non-Goals:**

- No changes to BGE-M3 dense, sparse, or ColBERT vector generation, storage, or reranking.
- No Qdrant, Milvus, or LanceDB schema migration required for existing indexes.
- No full per-language ranking framework beyond the initial `generic` and `one-c` split.
- No hard-coded 1C demo query IDs, expected prefixes, or evaluation labels in production ranking.

## Decisions

### Decision: Use a small explicit profile enum

The public profile values SHALL be `auto`, `generic`, and `one-c`.

Rationale:

- `generic` gives a deterministic safety mode for non-1C codebases.
- `one-c` gives deterministic behavior for 1C evaluations and known 1C repositories.
- `auto` preserves current compatibility while still allowing future detection improvements.

Alternative considered: a boolean `enableOneCSignals`. That is simpler but does not distinguish backward-compatible auto-detection from explicit 1C intent.

### Decision: Resolve profile once and pass it into fusion scoring

`Context.semanticSearch` should accept search options or a trailing options object that includes `rankingProfile`. The resolved profile should be passed to code-symbol collection/fusion and then to 1C signal scoring. In `generic`, 1C signal scoring returns zero. In `one-c`, 1C signal scoring may apply to recognized 1C paths. In `auto`, current path-based recognition remains the default.

Rationale:

- The fusion layer is where 1C boosts are currently added.
- Resolving the profile before scoring keeps diagnostics consistent.

Alternative considered: read process-wide environment variables inside scoring functions. That would be harder to test and would make individual searches less explicit.

### Decision: Prefer search-time override, then explicit codebase default, then `auto`

MCP `search_code` should accept `rankingProfile`. If omitted, the handler may use persisted codebase configuration when a profile was explicitly configured. If neither is present, it defaults to `auto`. The implementation must not infer and persist `one-c` or `generic` silently from path shape, index scope, or previous search results.

Rationale:

- Search-time override is useful for validation and emergency diagnosis.
- Explicit codebase default avoids repeating `one-c` for every 1C search.
- Default `auto` avoids breaking current clients.

Alternative considered: require every caller to pass a profile. That would be a breaking change.

### Decision: Keep 1C indexing scope separate from ranking profile

`oneCIndexScopeProfile` controls what files are indexed. `rankingProfile` controls scoring. They are related for 1C workflows but must remain separate options.

Rationale:

- A codebase can have a 1C indexing scope but still need generic scoring for debugging.
- A search-time ranking profile should not imply reindexing.

Alternative considered: reuse `oneCIndexScopeProfile` as the ranking signal. That couples file coverage with scoring behavior and makes generic opt-out unclear.

## Risks / Trade-offs

- Existing 1C users may forget to pass `one-c` and remain in `auto` mode -> keep `auto` backward-compatible and have live 1C scripts pass `one-c` explicitly.
- A search-time option can make reports less comparable -> record resolved `rankingProfile` in result metadata and evaluation reports.
- Persisting a default profile can drift from actual codebase contents -> persist only explicit profile configuration, allow search override, and document the precedence.
- More options increase MCP schema complexity -> keep the enum small and descriptions concrete.
- No schema migration means old indexes do not have stored profile metadata -> default them to `auto` and support override.

## Migration Plan

1. Add the profile type and default resolution in core without changing existing default behavior.
2. Thread the profile through MCP `search_code` and evaluation scripts.
3. Add tests for `generic`, `one-c`, and default `auto` behavior.
4. Update 1C live evaluation commands to pass `one-c`.
5. Add persisted-profile support only for explicit configuration, or leave persistence out of the first implementation while preserving the search-time override.
6. Verify existing core tests, MCP schema tests, scorer tests, typecheck, lint, build, and OpenSpec validation.
