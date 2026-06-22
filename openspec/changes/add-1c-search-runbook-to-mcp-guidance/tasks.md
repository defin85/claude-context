## 1. Locate Guidance Surface

- [x] 1.1 Locate the MCP `search_code` tool registration and the source of its public description.
- [x] 1.2 Locate existing tests that assert MCP tool descriptions or add a focused test location if none exists.
- [x] 1.3 Confirm the MCP documentation section that describes `search_code` usage.

## 2. MCP Guidance

- [x] 2.1 Add concise 1C context-bundle workflow guidance to the `search_code` tool description.
- [x] 2.2 Include the role-based search sequence: original user task, library API, client usage, server usage, applied usage, and metadata/state.
- [x] 2.3 Add a concise warning that some 1C metadata/state context may require checking index scope/profile coverage or filesystem context.
- [x] 2.4 Ensure the guidance does not change `rankingProfile`, retrieval scoring, provider behavior, request schema, or response schema.

## 3. Documentation

- [x] 3.1 Update MCP-facing `search_code` documentation with the 1C context-bundle workflow summary.
- [x] 3.2 Link or refer to `docs/dive-deep/one-c-semantic-search-runbook.md` as the maintained detailed runbook.
- [x] 3.3 Keep documentation generic and separate from scenario matrix expected paths, query IDs, and fixture answers.

## 4. Tests and Validation

- [x] 4.1 Add or update tests that verify the `search_code` tool description includes the 1C context-bundle guidance.
- [x] 4.2 Add or update tests that verify the tool description does not include evaluation labels, scenario IDs, expected prefixes, or fixture answers.
- [x] 4.3 Run the focused MCP test suite that covers tool descriptions.
- [x] 4.4 Run TypeScript validation for the touched package or workspace.
- [x] 4.5 Run `openspec validate add-1c-search-runbook-to-mcp-guidance --strict`.
