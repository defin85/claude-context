## 1. Dataset Shape And Seed Data

- [x] 1.1 Define the universal 1C matrix JSON shape with query ID, query text, intent, domain, kind, control class, and per-fixture targets.
- [x] 1.2 Add `evaluation/retrieval/universal-1c-search-matrix.json` with the initial bounded matrix of positive and negative-control queries.
- [x] 1.3 Include target entries for `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c` on every matrix row.
- [x] 1.4 Mark target applicability explicitly as `applicable`, `optional`, `not-applicable`, or `needs-inspection`.
- [x] 1.5 Add source-inspected strict and acceptable prefixes for the initial applicable targets.
- [x] 1.6 Add negative-control rows for broad terms such as form, signature, settings, counterparty, email, manager, and document.

## 2. Dataset Validation

- [x] 2.1 Extend dataset loading to recognize the universal matrix shape without breaking existing `demo-1c` and `demo-do30` datasets.
- [x] 2.2 Add label validation for per-fixture strict and acceptable prefixes under each applicable target.
- [x] 2.3 Make `needs-inspection` targets fail strict acceptance until resolved.
- [x] 2.4 Exclude `not-applicable` targets from positive scoring denominators while preserving audit reasons.
- [x] 2.5 Add validation tests for reachable labels, unreachable labels, optional labels, not-applicable targets, missing fixtures, and malformed matrix rows.

## 3. Scoring And Reporting

- [x] 3.1 Extend saved-result scoring to score universal matrix results by fixture/query pair.
- [x] 3.2 Report strict Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, and first strict rank for applicable positive targets.
- [x] 3.3 Report acceptable Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, and first acceptable rank when acceptable labels exist.
- [x] 3.4 Add grouped summaries by fixture, domain, intent, and control class.
- [x] 3.5 Add negative-control pass/fail scoring with violating top paths reported separately from positive misses.
- [x] 3.6 Add baseline comparison output that lists per-fixture query-level improvements and regressions.
- [x] 3.7 Ensure JSON and Markdown reports record backend label, retrieval mode, ranking profile, index status, latency, MCP tool errors, and missing ColBERT vector errors where available.

## 4. Runner Workflow

- [x] 4.1 Add or update a runner that can collect live MCP results for one universal-matrix fixture at a time.
- [x] 4.2 Add or update an orchestration command for combining saved per-fixture universal reports into one matrix summary.
- [x] 4.3 Ensure live collection uses explicit `rankingProfile=one-c` for 1C fixture runs.
- [x] 4.4 Keep existing `demo-1c` and `demo-do30-1c` runner behavior backward-compatible.
- [x] 4.5 Store universal run artifacts under `.artifacts/hybrid-code-symbol-retrieval/` with run names that include fixture and matrix identifiers.

## 5. Production Isolation

- [x] 5.1 Add tests proving production ranking does not read universal query IDs, domains, intents, target statuses, expected prefixes, acceptable prefixes, notes, or negative-control labels.
- [x] 5.2 Add tests or assertions proving production ranking does not select weights by fixture names such as `demo-bp30-1c`, `demo-ut-1c`, or `demo-unf-1c`.
- [x] 5.3 Document in verification notes that universal matrix support does not require reindexing existing collections.

## 6. Baseline Evidence

- [x] 6.1 Run matrix label validation against `examples/demo-do30-1c`.
- [x] 6.2 Run matrix label validation against `examples/demo-bp30-1c`.
- [x] 6.3 Run matrix label validation against `examples/demo-ut-1c`.
- [x] 6.4 Run matrix label validation against `examples/demo-unf-1c`.
- [x] 6.5 Capture saved or live baseline scoring artifacts for at least three of the four real fixtures.
- [x] 6.6 Record baseline artifact paths, fixture coverage, unresolved `needs-inspection` targets, and threshold decisions in change verification notes.

## 7. Verification

- [x] 7.1 Run focused scorer and dataset validation tests for existing datasets and the universal matrix.
- [x] 7.2 Run existing `demo-1c` relevance tests to confirm backward compatibility.
- [x] 7.3 Run existing `demo-do30-1c` scenario tests to confirm backward compatibility.
- [x] 7.4 Run `pnpm build:core`.
- [x] 7.5 Run `pnpm typecheck`.
- [x] 7.6 Run `pnpm lint`.
- [x] 7.7 Run `pnpm build`.
- [x] 7.8 Run `openspec validate --type change add-universal-1c-search-eval --strict`.
