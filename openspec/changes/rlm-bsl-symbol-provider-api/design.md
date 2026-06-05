## Context

`rlm-tools-bsl` already has the BSL-specific structure that `claude-context` should not duplicate: path parsing, indexed modules, indexed methods, object synonym lookup, FTS5 trigram search, line/end-line/export metadata, and index status reporting. The dependent `hybrid-code-symbol-retrieval` change needs a stable machine-readable provider that can be called from another process and then mapped to existing `claude-context` chunks.

Current useful `rlm-tools-bsl` facts:
- `search_methods(query, limit)` returns method rows with `name`, `type`, `is_export`, `line`, `end_line`, `params`, `module_path`, `object_name`, and `rank`.
- `search_objects(query, limit)` returns object rows with `object_name`, `category`, `synonym`, and `file`.
- The index lifecycle already has build/update/info/drop paths, with MCP mutations protected by project password.
- Existing helpers are optimized for agent interaction, not as a strict external provider schema.

## Goals / Non-Goals

**Goals:**
- Expose a stable query-only BSL symbol provider API with structured JSON output.
- Make provider output directly consumable by `claude-context` without scraping text.
- Include enough root/path/status metadata for `claude-context` to map provider candidates to indexed chunks.
- Reuse existing `rlm-tools-bsl` index readers and ranking behavior.
- Keep index build/update/drop explicit and user-controlled.

**Non-Goals:**
- Replacing existing `rlm-tools-bsl` helper functions.
- Adding a second index or parser.
- Adding vector retrieval or semantic fusion to `rlm-tools-bsl`.
- Allowing provider lookup to mutate index state.
- Guaranteeing exact matches when no index or FTS tables exist.

## Decisions

### Decision: Add a provider response schema

The provider SHALL return a top-level structured response with:
- `schemaVersion`: integer provider schema version.
- `provider`: stable string, initially `rlm-tools-bsl`.
- `status`: `available`, `missing_index`, `stale`, `busy`, `error`, or another documented finite value.
- `sourceRoot`: absolute or canonical root used by `rlm-tools-bsl`.
- `query`: original query string.
- `limit`: effective result limit.
- `capabilities`: booleans such as `hasMethodsFts`, `hasObjects`, `hasFilePaths`.
- `candidates`: normalized symbol/path candidates.
- `diagnostics`: compact non-secret diagnostic fields.

Candidate rows SHOULD include:
- `kind`: `method`, `object`, or `file`.
- `relativePath`: path relative to `sourceRoot`.
- `symbolName`: method or object name when available.
- `declarationKind`: `function`, `procedure`, or an existing BSL method type value.
- `startLine` and `endLine` when available.
- `isExport`, `params`, `objectName`, `objectKind`, `modulePath`, and `rank` when available.
- `source`: underlying source such as `methods_fts`, `object_synonyms`, or `file_paths`.

Rationale:
- `claude-context` can map candidates by `sourceRoot` + `relativePath` and line range.
- Schema versioning gives the TypeScript adapter a safe compatibility check.
- Finite status values let consumers fail open without guessing from error strings.

### Decision: Provide a query-only machine-readable transport

The first implementation SHOULD expose one of these structured transports:
- A CLI command such as `rlm-bsl-index provider query <path> <query> --limit N --json`.
- Or an MCP/server endpoint that returns the same JSON schema.

If CLI is selected:
- It MUST write only JSON to stdout in success mode.
- It MUST write diagnostics/errors to stderr or JSON error fields without corrupting stdout.
- It MUST be safe for argv-based subprocess invocation with spaces and Cyrillic paths/queries.

Rationale:
- `claude-context` can call a CLI with `spawn(file, args)` without shell interpolation.
- A JSON-only stdout contract avoids scraping human-readable helper output.
- An MCP/server endpoint can be added later without changing the response schema.

### Decision: Query only; never mutate indexes

The provider API SHALL NOT build, update, drop, migrate, or lock indexes for mutation. It may inspect index status and return `missing_index`, `stale`, `busy`, or `error` status.

Rationale:
- Index builds can be expensive and are already guarded in `rlm-tools-bsl`.
- Search-time mutation would surprise agents and users.
- Consumers such as `claude-context` need deterministic low-latency fail-open behavior.

### Decision: Reuse existing lookup primitives

The provider should combine bounded results from existing indexed lookups:
- `search_methods` for exact/partial method names.
- `search_objects` for object names and synonyms.
- indexed file path lookup where available for path/module queries.

Rationale:
- Existing `rlm-tools-bsl` ranking captures BSL-specific behavior.
- Keeping provider shaping thin reduces drift risk.

## Risks / Trade-offs

- [Risk] The CLI or endpoint could accidentally emit non-JSON logs on stdout. → Mitigation: add tests asserting stdout parses as JSON for success and known failure states.
- [Risk] Provider schema drift can break `claude-context`. → Mitigation: version the schema and keep additive-only fields within a schema version.
- [Risk] `sourceRoot` may differ from the repository root indexed by `claude-context`. → Mitigation: always return `sourceRoot` and relative paths; document nested-root behavior.
- [Risk] Querying large indexes could add latency. → Mitigation: enforce result limits, avoid full unbounded scans, and include elapsed timing diagnostics.
- [Risk] Returning absolute paths may leak local layout. → Mitigation: `sourceRoot` is required for mapping; avoid returning unrelated absolute paths or secrets.
- [Risk] Index can be stale. → Mitigation: expose status and age/freshness diagnostics, but do not auto-update.

## Migration Plan

1. Add provider response schema and pure shaping helpers behind existing index readers.
2. Add a JSON transport, preferably CLI first if it is simpler to consume from `claude-context`.
3. Add tests for success, missing index, stale/busy/error status, Cyrillic queries, spaces in paths, and JSON-only stdout.
4. Document the provider command/endpoint and response schema.
5. Update `hybrid-code-symbol-retrieval` implementation to use this API after this change exists.
6. Rollback path: keep provider disabled in `claude-context`; existing `rlm-tools-bsl` helpers remain unchanged.

## Open Questions

- Should v1 expose only CLI JSON, only server/MCP endpoint, or both with shared response shaping?
- Which existing freshness check should map to `stale`, and which should remain only a warning diagnostic?
- Should provider candidates include object synonym rows by default, or should consumers request candidate kinds explicitly?
