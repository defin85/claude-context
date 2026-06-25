## 1. Scenario Data Model

- [x] 1.1 Define the scenario matrix JSON shape for task text, domain, fixture applicability, required roles, optional roles, and source-inspected path prefixes.
- [x] 1.2 Create the initial `evaluation/retrieval/one-c-runbook-scenario-matrix.json` dataset with 5-8 source-inspected 1C implementation scenarios.
- [x] 1.3 Reuse existing role names where they fit (`library-api`, `client-usage`, `server-usage`, `applied-usage`, `metadata`) and document any new role IDs in the dataset.
- [x] 1.4 Keep generated query attempts out of required matrix truth; store exact query text only as optional evaluation hints or run artifacts.

## 2. Validation

- [x] 2.1 Add scenario matrix validation for required fields, supported applicability values, required role definitions, and duplicate IDs.
- [x] 2.2 Validate that every required role path prefix for applicable targets matches at least one file under the fixture path.
- [x] 2.3 Report optional role reachability separately from required-role validation failures.
- [x] 2.4 Add unit tests for valid scenarios, unreachable labels, not-applicable targets, optional roles, and malformed role definitions.

## 3. Scenario Runner

- [x] 3.1 Add a saved-results runner path that can score recorded per-search results without requiring a live MCP daemon.
- [x] 3.2 Add a live MCP scenario runner that executes the broad user-task search first and then bounded role-focused searches.
- [x] 3.3 Persist raw per-search results with scenario ID, fixture, search phase, role intent, query text, result paths, scores, latency where available, and result metadata.
- [x] 3.4 Enforce a configurable maximum number of searches per scenario and record searches attempted or searches-to-complete.
- [x] 3.5 Record requested result limit and effective returned result count for every scenario search.

## 4. Scoring And Reports

- [x] 4.1 Score first-query role coverage separately from final workflow role coverage.
- [x] 4.2 Report bundle completeness, missing roles by scenario and fixture, and aggregate missing-role counts.
- [x] 4.3 Report workflow gain between first-query coverage and final workflow coverage.
- [x] 4.4 Record backend label, retrieval mode, ranking profile, index status, MCP tool errors, and missing ColBERT vector errors in scenario reports.
- [x] 4.5 Generate both machine-readable JSON and Markdown summaries under `.artifacts/hybrid-code-symbol-retrieval/`.

## 5. Documentation

- [x] 5.1 Update the 1C semantic-search runbook to reference scenario evaluation only as validation evidence, not as a matrix-specific procedure.
- [x] 5.2 Document how to run scenario validation, saved-results scoring, and live MCP scenario checks.
- [x] 5.3 Document how to interpret first-query misses, workflow gain, missing roles, backend errors, and retrieval-mode differences.

## 6. Acceptance

- [x] 6.1 Run scenario matrix validation for all initial fixtures.
- [x] 6.2 Run unit tests for the scenario validator and scorer.
- [x] 6.3 Run at least one saved-results or fixture-level smoke scenario check.
- [x] 6.4 Run `openspec validate add-1c-runbook-scenario-matrix --strict`.
- [x] 6.5 Confirm existing universal 1C matrix validation and scoring tests still pass.
- [x] 6.6 Confirm scenario reporting does not assume `limit > 10` was honored unless the raw results show more than 10 returned items.
