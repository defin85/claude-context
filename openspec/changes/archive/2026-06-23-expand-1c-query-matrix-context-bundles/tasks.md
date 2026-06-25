## 1. Matrix Audit And Scenario Selection

- [x] 1.1 Inventory current universal matrix rows by fixture, domain, intent, kind, control class, and result-role coverage.
- [x] 1.2 Select 8-12 source-inspectable task rows that require multi-role context bundles.
- [x] 1.3 Define the target primary fixture coverage plan, aiming for 2-3 role-based applicable targets per primary configuration where applicable.
- [x] 1.4 Identify not-applicable cases and record audit reasons instead of leaving ambiguous empty targets.

## 2. Matrix Data Expansion

- [x] 2.1 Add or update matrix rows with required result roles for the selected task scenarios.
- [x] 2.2 Source-inspect and record path prefixes for library API, client usage, server usage, applied examples, and metadata roles where relevant.
- [x] 2.3 Add machine-readable `queryPurpose` values for `navigation`, `task-implementation`, `negative-control`, `library-oriented`, and `applied-usage` rows without overloading `intent`.
- [x] 2.4 Keep all new labels as evaluation metadata only and avoid production ranking/query-rewrite changes.

## 3. Validation And Reporting

- [x] 3.1 Extend matrix validation to count and report query-purpose coverage and unknown purpose values.
- [x] 3.2 Extend scoring summaries with `bundleRoles.missingRequiredRolesById` grouped by role identifier.
- [x] 3.3 Include missing-role aggregates in Markdown reports while preserving existing strict and acceptable Hit@k metrics.
- [x] 3.4 Add tests for purpose validation, role coverage counts, missing-role aggregation, and production-boundary enforcement.

## 4. Live Evaluation Workflow

- [x] 4.1 Document the repeatable live matrix check command for selected fixtures.
- [x] 4.2 Ensure live artifacts record fixture, codebase path, backend label, retrieval mode, ranking profile, index status, timestamps, and available BGE-M3 mode metadata.
- [x] 4.3 Run at least one live semantic-search check against an indexed primary fixture and save or summarize the evidence.
- [x] 4.4 Document how to interpret live evidence as a dated quality snapshot, not as production ranking input.

## 5. Verification

- [x] 5.1 Run the universal matrix unit test suite.
- [x] 5.2 Validate all configured universal matrix fixtures and confirm there are no unreachable applicable role prefixes.
- [x] 5.3 Review generated scored JSON and Markdown output for at least one scenario with complete and one scenario with incomplete role coverage.
- [x] 5.4 Record verification commands, key results, and any accepted residual gaps in an implementation summary.
