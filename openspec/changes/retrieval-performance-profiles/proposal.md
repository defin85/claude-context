## Why

Full BGE-M3 dense+sparse+ColBERT retrieval materially improves search quality but makes initial indexing and inserts much heavier. Operators need an explicit retrieval performance profile so large codebases can default to a faster indexing path while still allowing full multivector quality when it is worth the storage and latency cost.

## What Changes

- Add an explicit retrieval profile setting with at least `fast`, `balanced`, and `quality` profiles.
- Map each profile to concrete embedding/retrieval behavior:
  - `fast`: minimize indexing cost and storage; do not store ColBERT token vectors.
  - `balanced`: retain lexical help where available without full ColBERT storage cost.
  - `quality`: preserve full BGE-M3 dense+sparse+ColBERT retrieval and reranking.
- Persist the selected profile with each indexed codebase together with the retrieval mode and retrieval schema version.
- Expose the active profile through MCP status responses, daemon status, logs, and documentation.
- Require explicit force reindex when changing a codebase to a profile whose storage/retrieval schema is incompatible with the existing collection.
- Add validation so incompatible low-level environment combinations fail clearly instead of silently producing a mismatched profile.
- Non-goals:
  - Do not remove full BGE-M3 retrieval.
  - Do not automatically migrate existing collections.
  - Do not silently downgrade a `quality` profile to dense-only behavior.
  - Do not change ranking semantics for existing indexed collections unless the operator explicitly reindexes under a new profile.
  - Do not add per-file or per-directory mixed-profile indexing in the first version.

## Capabilities

### New Capabilities

- `retrieval-performance-profiles`: Defines retrieval profile selection, profile-to-retrieval mapping, compatibility checks, status exposure, and reindex requirements.

### Modified Capabilities

- None.

## Impact

- Affected code:
  - `packages/mcp/src/config.ts`: profile config parsing, validation, help text, logging.
  - `packages/core/src/context.ts` and retrieval helpers: profile-aware retrieval mode/schema selection.
  - `packages/mcp/src/codebase-config.ts`, `snapshot.ts`, and status handlers: persisted profile and status exposure.
  - Tests for config validation, indexing schema selection, persisted compatibility, and search behavior.
  - Documentation for environment variables, quick-start guidance, and BGE-M3 tradeoffs.
- API impact:
  - MCP status structured content gains an optional retrieval profile field.
  - `index_codebase` may accept an optional profile override if the implementation chooses per-call selection.
- Migration impact:
  - Existing indexed collections remain readable using their persisted retrieval mode/schema.
  - Switching an existing codebase to an incompatible profile requires explicit `force=true` reindex.
  - No automatic collection rewrite or background migration is introduced.
