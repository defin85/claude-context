## 1. Evaluation Data

- [x] 1.1 Add `evaluation/retrieval/demo-do30-1c-scenarios.json` with the 30 source-inspected queries, strict expected path prefixes, acceptable alternate prefixes, and failure-class notes.
- [x] 1.2 Add dataset validation that confirms every strict and acceptable path prefix exists under `examples/demo-do30-1c`.
- [x] 1.3 Add tests for dataset loading and path-prefix validation, including stale-path failure behavior.

## 2. Scoring And Reporting

- [x] 2.1 Extend the retrieval scorer to compute strict and acceptable Hit@k, MRR@10, and per-query first-rank fields separately.
- [x] 2.2 Update or add a live MCP runner for `demo-do30-1c` that records backend label, retrieval mode, ranking profile, index status, raw top results, latency, and scoring output.
- [x] 2.3 Add report output that lists strict misses, acceptable-only hits, per-query regressions, and failure classes.
- [x] 2.4 Add scorer tests proving acceptable hits do not count as strict hits.

## 3. Ranking Tests

- [x] 3.1 Add focused `code-symbol-retrieval` tests for FNS response handling and saved counterparty state queries.
- [x] 3.2 Add focused tests for MCHD constant manager modules versus generic signature-check forms.
- [x] 3.3 Add focused tests for inbound/outbound EDI viewing forms versus broad MCHD modules.
- [x] 3.4 Add focused tests for send-assistant form intent versus common helper modules.
- [x] 3.5 Add focused tests for email print/save journal forms versus account setup or generic email forms.
- [x] 3.6 Add focused tests for SMS service-module acceptability and SMS notification document manager/form intent.
- [x] 3.7 Add focused tests for archive-transfer manager/object module separation.

## 4. Ranking Implementation

- [x] 4.1 Add reusable 1C query-intent extraction for object kind, directional workflow terms, domain terms, action terms, and generic high-collision terms.
- [x] 4.2 Add bounded candidate support for concrete object-kind matches when path, metadata name, content, semantic, lexical, exact-symbol, or provider evidence supports the query.
- [x] 4.3 Add bounded directional workflow support for inbound/outbound, EDI, email, MCHD, FNS, SMS, and archive-transfer terms.
- [x] 4.4 Add generic-term dominance dampening that applies only when more specific query evidence exists.
- [x] 4.5 Keep broad common modules neutral for broad queries and protect exact-symbol/provider-backed results from accidental suppression.
- [x] 4.6 Expose score-component diagnostics for the new scenario-intent signals without adding large payloads.

## 5. Verification

- [x] 5.1 Run the focused core test suite for ranking and scorer changes.
- [x] 5.2 Run the existing `demo-1c` relevance workflow and confirm it preserves the current accepted threshold and backend correctness.
- [x] 5.3 Run the new `demo-do30-1c` live Qdrant evaluation and confirm `0` MCP tool errors and `0` missing ColBERT vector errors.
- [x] 5.4 Confirm tuned `demo-do30-1c` strict Top-1 is at least `18/30` and strict Top-5 is at least `24/30`.
- [x] 5.5 Run `pnpm build:core`, then `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- [x] 5.6 Run `openspec validate --type change improve-1c-scenario-ranking --strict` and archive the report artifacts needed for review.
