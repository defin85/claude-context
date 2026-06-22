## Why

`v8unpack` exports for ordinary-form 1C configurations use a different tree shape than Designer/EDT XML exports: paths such as `Document/.../Document.obj.bsl`, `CommonModule/.../CommonModule.obj.bsl`, and `Form/.../Form.elem.json`. The current 1C scope profiles only recognize the Designer/EDT-style `CommonModules/.../Ext/Module.bsl` shape, so reduced profiles exclude all useful files from these exports.

## What Changes

- Add an explicit `v8unpack` 1C indexing scope profile for `oneCIndexScopeProfile`.
- Recognize `v8unpack` singular metadata roots and module filename suffixes such as `.obj.bsl`, `.mgr.bsl`, `.cmd.bsl`, and form `Form.obj.bsl`.
- Include BSL modules and useful JSON metadata/form files for `v8unpack` exports without requiring users to manually add `.json`.
- Exclude heavy binary or low-value resources from the `v8unpack` profile, including `.mxl`, `.bin`, `.c1b64`, and image-like payloads; users who need those files can use `full` with explicit `customExtensions`.
- Report `v8unpack` profile selection through existing 1C scope summary/config/status paths.
- Keep existing `full`, `developer`, and `minimal` semantics unchanged for Designer/EDT exports.

Non-goals:

- No retrieval scoring, ranking profile, query rewriting, or provider behavior changes.
- No MCP request or response schema change beyond accepting the new enum value.
- No vector collection schema change, migration, or reindex requirement for existing indexed collections.
- No attempt to parse or include binary form payloads or tabular document templates in the `v8unpack` profile.
- No automatic detection that silently changes a user's selected profile.

## Capabilities

### New Capabilities

- `1c-indexing-scope-profiles`: defines supported 1C indexing scope profiles and their file-selection behavior.

### Modified Capabilities

- None.

## Impact

- Affected code: core 1C scope-profile parsing/classification, pre-index traversal extension handling, MCP tool schema/description, status/config compatibility checks, and tests.
- Affected docs: MCP README or relevant 1C indexing documentation should mention when to use `v8unpack`.
- APIs: `oneCIndexScopeProfile` accepts one additional value, `v8unpack`; existing values remain compatible.
- Dependencies: none.
- Existing indexed collections: no automatic migration; a codebase must be force reindexed to change from an existing profile to `v8unpack`, following current profile-drift behavior.
