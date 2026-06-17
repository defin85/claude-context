## 1. Source Inspection

- [x] 1.1 Confirm the final `examples/demo-zup-1c` export is present and record file/module counts for verification.
- [x] 1.2 Inspect existing universal matrix rows against ZUP and classify each ZUP target as `applicable`, `not-applicable`, `optional`, or `needs-inspection`.
- [x] 1.3 Select source-backed strict and acceptable ZUP prefixes for applicable existing rows.
- [x] 1.4 Record source-backed reasons for ZUP `not-applicable` rows, especially trade/accounting-only scenarios.

## 2. Matrix Data

- [x] 2.1 Add `demo-zup-1c` fixture metadata to `evaluation/retrieval/universal-1c-search-matrix.json`.
- [x] 2.2 Add ZUP targets to every existing universal query with validated status and notes/reasons.
- [x] 2.3 Add ZUP-specific positive rows for salary accrual and payroll payment statements.
- [x] 2.4 Add ZUP-specific positive rows for hiring, HR transfer, dismissal, leave, leave balances, sick leave, and time sheet workflows.
- [x] 2.5 Add ZUP-specific positive rows for NDFL, insurance contributions, SEDO/FSS, and military accounting.
- [x] 2.6 Add ZUP negative-control rows or ZUP targets for broad HR/payroll terms with prohibited prefixes.

## 3. Scoring And Runner Wiring

- [x] 3.1 Update scorer validation tests so ZUP strict and acceptable prefixes must resolve under `examples/demo-zup-1c`.
- [x] 3.2 Ensure universal matrix scoring reports ZUP positive counts, `not-applicable` reasons, and negative-control outcomes separately.
- [x] 3.3 Add or update a ZUP live runner default path, or document the exact generic runner invocation needed for ZUP.
- [x] 3.4 Ensure ZUP live reports include backend label, retrieval mode, ranking profile, index status, raw top results, label validation, summary metrics, and negative-control summary.
- [x] 3.5 Ensure fixture-aware baseline comparisons work for ZUP saved reports.

## 4. Tests

- [x] 4.1 Add unit tests that load the universal matrix and verify `demo-zup-1c` fixture metadata.
- [x] 4.2 Add unit tests that reject unreachable ZUP applicable labels.
- [x] 4.3 Add unit tests for ZUP `not-applicable` reason preservation.
- [x] 4.4 Add unit tests for ZUP negative-control scoring and markdown reporting.
- [x] 4.5 Run `node --test scripts/run-demo-1c-relevance-eval.test.js`.

## 5. Live Verification

- [ ] 5.1 Index `examples/demo-zup-1c` with 1C developer scope and the intended retrieval profile.
- [ ] 5.2 Run ZUP live MCP evaluation with `rankingProfile=one-c`.
- [ ] 5.3 Archive raw results, summary JSON, markdown report, label validation, and comparison output if a baseline is available.
- [ ] 5.4 Confirm the ZUP run has `0` MCP tool errors and `0` missing ColBERT vector errors.
- [ ] 5.5 Review strict misses, acceptable-only hits, negative-control failures, and `needs-inspection` rows before setting or documenting any ZUP threshold.

## 6. Final Verification

- [x] 6.1 Run `pnpm build:core`.
- [x] 6.2 Run `pnpm typecheck`.
- [x] 6.3 Run `pnpm lint`.
- [x] 6.4 Run `pnpm build`.
- [x] 6.5 Run `openspec validate --type change add-demo-zup-1c-search-eval --strict`.
- [x] 6.6 Update verification notes with artifact paths and remaining ZUP inspection decisions.
