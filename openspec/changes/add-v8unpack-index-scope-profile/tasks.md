## 1. Discovery and Contract Checks

- [x] 1.1 Locate current `oneCIndexScopeProfile` parsing, validation, persistence, and MCP schema surfaces.
- [x] 1.2 Locate pre-index traversal extension filtering and 1C scope decision ordering.
- [x] 1.3 Confirm representative `v8unpack` path shapes for BSL modules, forms, JSON metadata, and heavy resources.

## 2. Core Scope Profile Implementation

- [x] 2.1 Add `v8unpack` to the 1C scope profile type, parser, resolver, and validation tests.
- [x] 2.2 Implement `v8unpack` path classification for singular roots and filename-coded module roles.
- [x] 2.3 Select `.obj.bsl`, `.mgr.bsl`, command BSL, form BSL, object JSON, id JSON, and form element JSON under the `v8unpack` profile.
- [x] 2.4 Exclude `.mxl`, `.bin`, `.c1b64`, `.c1brace`, image-like files, and other heavy resources under the `v8unpack` profile.
- [x] 2.5 Preserve existing `full`, `developer`, and `minimal` file-selection behavior.

## 3. Extension, MCP, and Status Wiring

- [x] 3.1 Ensure the `v8unpack` profile considers `.json` supported for that codebase session without requiring `customExtensions` in both pre-index traversal and synchronizer snapshot generation.
- [x] 3.2 Add `v8unpack` to MCP `index_codebase` input schema enum and description.
- [x] 3.3 Ensure persisted config, incompatible-profile checks, status/profile summaries, reduced/scoped coverage warnings, and diagnostics report `v8unpack` through existing fields.
- [x] 3.4 Keep retrieval profile, ranking profile, provider behavior, request schema outside the enum, response schema, and vector collection schema unchanged.

## 4. Documentation

- [x] 4.1 Document when to use `oneCIndexScopeProfile: "v8unpack"` for ordinary-form `v8unpack` exports.
- [x] 4.2 Document that the profile includes BSL plus useful JSON metadata/form files and excludes heavy binary/template resources.
- [x] 4.3 Document that heavy resources require the existing `full` profile with explicit `customExtensions` and ignore patterns.

## 5. Tests and Validation

- [x] 5.1 Add unit tests for `v8unpack` BSL module selection.
- [x] 5.2 Add unit tests for `v8unpack` JSON metadata/form selection without manual `.json` custom extension.
- [x] 5.3 Add unit tests proving heavy resources are excluded by the `v8unpack` profile.
- [x] 5.4 Add regression tests proving existing Designer/EDT `full`, `developer`, and `minimal` behavior is unchanged.
- [x] 5.5 Add tests proving `v8unpack` profile status and reduced/scoped coverage warning are exposed through existing status/profile fields.
- [x] 5.6 Run focused core and MCP tests covering 1C scope profiles and MCP tool schema.
- [x] 5.7 Run TypeScript validation for touched packages or workspace.
- [x] 5.8 Run `openspec validate add-v8unpack-index-scope-profile --strict`.
