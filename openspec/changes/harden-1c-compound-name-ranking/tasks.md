## 1. Evaluation Data

- [x] 1.1 Add committed compound-name holdout coverage under `evaluation/retrieval/`, either as part of the universal 1C matrix or as a universal-matrix-compatible file, with positive and negative-control queries separate from `demo-do30-1c-scenarios.json`.
- [x] 1.2 Include intent, domain, kind, failure/control class, per-fixture target status, strict expected prefixes, acceptable prefixes, and notes for every holdout query.
- [x] 1.3 Add validation tests proving every strict and acceptable holdout prefix is reachable under `examples/demo-do30-1c`.
- [x] 1.4 Add tests that fail stale holdout labels and distinguish positive misses from negative-control failures.

## 2. Scoring And Reporting

- [x] 2.1 Extend scorer/reporting if needed to represent negative-control outcomes separately from strict positive misses.
- [x] 2.2 Add or update runner options so holdout live reports record backend label, ranking profile, retrieval mode/index status, latency, raw top results, summary, label validation, and comparison output.
- [x] 2.3 Ensure demo-do30 tuned acceptance always archives query-level comparison against a committed or explicitly archived current final tuned baseline.
- [x] 2.4 Add scorer tests for holdout thresholds, negative-control failures, and no-regression comparison requirements.
- [x] 2.5 Record universal matrix supporting-evidence results for configured fixtures with source-inspected applicable targets, without treating `needs-inspection` targets as hard gates for this change.

## 3. Ranking Tests

- [x] 3.1 Add focused compound-name tests for email journal forms such as `ПечатьПисьма` and `ПросмотрВложенногоПисьма`.
- [x] 3.2 Add focused compound-name tests for MCHD constants such as `АдресРеестраМЧД`.
- [x] 3.3 Add focused tests for counterparty state modules such as `ПроверкаКонтрагентовКлиентСервер`.
- [x] 3.4 Add focused tests that distinguish archive-transfer object and manager modules.
- [x] 3.5 Add focused tests for EDI message signature forms such as `СообщениеЭДО/Forms/Подписи`.
- [x] 3.6 Add negative-control tests showing broad email, EDI, MCHD, archive, settings, state, signature, and counterparty queries keep better-supported broad/semantic results eligible.
- [x] 3.7 Add diagnostics assertions for the new compound-name score component.

## 4. Ranking Implementation

- [x] 4.1 Add reusable compound 1C metadata-name normalization for object names, area names, module kinds, abbreviations, stems, and adjacent phrases.
- [x] 4.2 Add bounded compound-name scoring that requires candidate evidence and works only under 1C-aware ranking behavior.
- [x] 4.3 Integrate compound-name support with existing object-kind, object-name, scenario-intent, generic-term penalty, exact-symbol, provider, and duplicate-diversity scoring.
- [x] 4.4 Protect broad conceptual queries and exact-symbol/provider-backed matches from compound-name over-ranking.
- [x] 4.5 Expose compact diagnostics for compound-name evidence without vector payloads.
- [x] 4.6 Keep production ranking independent from holdout IDs, expected prefixes, acceptable prefixes, failure classes, and dataset notes.
- [x] 4.7 Keep production compound-name weights independent from configured fixture names such as `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, `demo-unf-1c`, and `demo-zup-1c`.

## 5. Verification

- [x] 5.1 Run focused scorer and core ranking tests for compound-name and negative-control behavior.
- [x] 5.2 Run existing `demo-1c` live relevance workflow and confirm accepted threshold/backend correctness remain preserved.
- [x] 5.3 Run current `demo-do30-1c` live evaluation with an explicit baseline artifact and compare against the final tuned baseline with `0` query-level regressions.
- [x] 5.4 Fix holdout strict-positive and negative-control thresholds before the final run, then run the new holdout live evaluation and confirm those thresholds, `0` MCP tool errors, and `0` missing ColBERT vector errors.
- [x] 5.5 Run `pnpm build:core`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- [x] 5.6 Run `openspec validate --type change harden-1c-compound-name-ranking --strict` and archive verification/report artifact paths needed for review.
