## Why

`hybrid-code-symbol-retrieval` in `claude-context` needs a safe machine-readable BSL symbol provider. `rlm-tools-bsl` already owns the BSL method/object index, but its existing user-facing helpers and CLI are not yet an explicit stable provider API for another tool to consume.

## What Changes

- Add a query-only symbol provider API in `rlm-tools-bsl` that exposes structured JSON results for BSL method, object, and path lookup.
- Reuse the existing `rlm-tools-bsl` SQLite method/object/file indexes instead of creating a new BSL parser or index.
- Return stable provider metadata needed by `claude-context`: provider name, schema version, provider status, source root, relative path, line range, symbol metadata, rank/score, and diagnostics.
- Add a non-mutating CLI or server endpoint that can be invoked safely by an external adapter with argv-based subprocess calls or another structured transport.
- Preserve existing `rlm-tools-bsl` helpers, MCP tools, and index lifecycle behavior.
- Non-goals:
  - Do not build, update, or drop indexes from this provider lookup API.
  - Do not add embeddings, vector search, or semantic fusion to `rlm-tools-bsl`.
  - Do not move `claude-context` result fusion into `rlm-tools-bsl`.
  - Do not expose human-readable output as the provider contract.

## Capabilities

### New Capabilities

- `rlm-bsl-symbol-provider-api`: Machine-readable, query-only BSL symbol provider contract for consumers such as `claude-context`.

### Modified Capabilities

None.

## Impact

- Affected external implementation target:
  - `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/rlm-tools-bsl`
  - `src/rlm_tools_bsl/bsl_index.py` and `src/rlm_tools_bsl/bsl_helpers.py` for result shaping if needed.
  - `src/rlm_tools_bsl/cli.py` or `src/rlm_tools_bsl/server.py` for a structured provider endpoint.
  - `docs/INDEXING.md` or equivalent provider docs.
- Affected dependent change:
  - `openspec/changes/hybrid-code-symbol-retrieval` can use this API as the preferred BSL provider transport.
- API impact:
  - New structured provider response schema.
  - Existing helper APIs and MCP responses remain backward-compatible.
- Migration impact:
  - Existing `bsl_index.db` files remain usable.
  - Provider lookup requires an already-built, fresh enough index; missing/stale indexes are reported in status and never auto-built by this API.
