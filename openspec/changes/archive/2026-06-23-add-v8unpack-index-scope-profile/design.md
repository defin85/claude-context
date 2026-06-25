## Context

The current 1C index scope logic is optimized for Designer/EDT XML exports. It classifies plural root folders and `Ext` module names such as `CommonModules/.../Ext/Module.bsl`, `Documents/.../Ext/ObjectModule.bsl`, and `Forms/.../Ext/Form/Module.bsl`.

`v8unpack` exports ordinary-form configurations differently. The inspected TN BP 2.0 export contains singular roots and filename-coded module roles, for example `CommonModule/.../CommonModule.obj.bsl`, `Document/.../Document.mgr.bsl`, and `DataProcessor/.../Form/.../Form.elem.json`. With the current `developer` or `minimal` profiles, these files are supported by extension but excluded by the 1C scope classifier because the tree shape is unrecognized.

The change is limited to pre-index file selection. Dense-only BGE-M3, full BGE-M3 dense+sparse+ColBERT retrieval, lexical/symbol ranking, provider behavior, and vector storage schema remain unchanged.

## Goals / Non-Goals

**Goals:**

- Add a deliberate `v8unpack` profile for exported 1C configurations produced by `v8unpack`.
- Select BSL modules and useful JSON object/form metadata from `v8unpack` trees.
- Preserve existing `full`, `developer`, and `minimal` behavior for Designer/EDT exports.
- Avoid indexing heavy templates and binary payloads in the `v8unpack` profile.
- Keep profile observability and persisted profile compatibility consistent with existing scope profiles.

**Non-Goals:**

- No automatic format detection that silently changes an omitted profile.
- No indexing of `.mxl`, `.bin`, `.c1b64`, images, or tabular templates in the `v8unpack` profile.
- No form-binary parser or reconstruction of ordinary forms beyond already textual `.json` and `.bsl` outputs.
- No retrieval, ranking, provider, vector schema, collection migration, or embedding model changes.

## Decisions

1. Add `v8unpack` as an explicit `OneCIndexScopeProfile`.

   This keeps the setting user-visible and avoids overloading `developer` with two unrelated concepts: how much to index and which export format is present. The alternative was to make `developer` detect both Designer/EDT and `v8unpack` paths. That would be convenient but harder to reason about and could change existing reduced-profile behavior on mixed trees.

2. Implement a separate `v8unpack` path classifier.

   The existing classifier should remain focused on Designer/EDT exports. A small `classifyV8UnpackPath(relativePath)` can recognize singular roots, `.obj.bsl`, `.mgr.bsl`, `.cmd.bsl`, form modules, and useful `.json` metadata. This is less risky than broadening every existing branch with singular-root special cases.

3. Let `v8unpack` add `.json` to effective indexing extensions.

   The profile is not useful for ordinary forms if it only selects `.bsl`; form structure lives in files such as `Form.elem.json` and object metadata lives in JSON. Requiring users to also pass `customExtensions: ['.json']` would make the profile easy to misconfigure. The profile should add `.json` only for that codebase session, should still respect explicit ignore patterns, and must feed the same effective extension set to both pre-index traversal and `FileSynchronizer` snapshot generation.

4. Exclude heavy non-code resources from the profile.

   `v8unpack` trees can contain many `.mxl`, `.bin`, `.c1b64`, and template payload files. Including them increases storage, embedding cost, and indexing latency while adding noisy retrieval candidates. Users who need arbitrary heavy resources can use the existing `full` profile with explicit `customExtensions` and ignore patterns.

5. Reuse existing profile-drift and status behavior.

   Persisted codebase config already stores the 1C scope profile and rejects incompatible profile changes without force. `v8unpack` should use the same path, so changing an existing index to or from `v8unpack` requires force reindex and does not require collection migration. Because it intentionally excludes some export resources, it should be treated as scoped coverage in status/profile warnings even though it includes more files than BSL-only indexing.

## Risks / Trade-offs

- Path variants missed by the first classifier -> Mitigation: add tests with representative `v8unpack` paths for common modules, object modules, manager modules, command modules, forms, roles, and metadata JSON; fail closed by excluding unrecognized resources only in the `v8unpack` profile.
- More indexed files than BSL-only mode -> Mitigation: include JSON because ordinary-form context requires it, but keep `.mxl`, `.bin`, `.c1b64`, and images out of the `v8unpack` profile.
- Larger index and slower first build for `v8unpack` -> Mitigation: document the storage/latency tradeoff and keep BSL-only possible through the existing `full` profile.
- Users expect profile auto-detection -> Mitigation: keep explicit profile selection and document when to choose `v8unpack`.

## Migration Plan

- Add the enum value, classifier, extension handling, MCP schema update, and tests.
- Update documentation with a short `v8unpack` usage note.
- Existing indexes do not migrate automatically. Users who want this profile on an already indexed codebase must re-run indexing with `force=true`.
- Rollback is a code/doc revert. Any codebase indexed with `v8unpack` can be cleared or force reindexed under another profile.

## Open Questions

- None for the initial implementation. If later searches show useful context in `.html` or `.txt`, those extensions can be added deliberately in a follow-up rather than included in the initial profile.
