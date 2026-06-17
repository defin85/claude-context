## 1. Evaluation Data

- [ ] 1.1 Add a committed compound-name holdout dataset under `evaluation/retrieval/` with positive and negative-control queries separate from `demo-do30-1c-scenarios.json`.
- [ ] 1.2 Include strict expected prefixes, acceptable prefixes, failure/control class, and notes for every holdout query.
- [ ] 1.3 Add validation tests proving every strict and acceptable holdout prefix is reachable under `examples/demo-do30-1c`.
- [ ] 1.4 Add tests that fail stale holdout labels and distinguish positive misses from negative-control failures.

## 2. Scoring And Reporting

- [ ] 2.1 Extend scorer/reporting if needed to represent negative-control outcomes separately from strict positive misses.
- [ ] 2.2 Add or update runner options so holdout live reports record backend label, ranking profile, retrieval mode/index status, latency, raw top results, summary, label validation, and comparison output.
- [ ] 2.3 Ensure demo-do30 tuned acceptance always archives query-level comparison against the current final tuned baseline.
- [ ] 2.4 Add scorer tests for holdout thresholds, negative-control failures, and no-regression comparison requirements.

## 3. Ranking Tests

- [ ] 3.1 Add focused compound-name tests for email journal forms such as `ПечатьПисьма` and `ПросмотрВложенногоПисьма`.
- [ ] 3.2 Add focused compound-name tests for MCHD constants such as `АдресРеестраМЧД`.
- [ ] 3.3 Add focused tests for counterparty state modules such as `ПроверкаКонтрагентовКлиентСервер`.
- [ ] 3.4 Add focused tests that distinguish archive-transfer object and manager modules.
- [ ] 3.5 Add focused tests for EDI message signature forms such as `СообщениеЭДО/Forms/Подписи`.
- [ ] 3.6 Add negative-control tests showing broad email, EDI, MCHD, archive, settings, state, signature, and counterparty queries keep better-supported broad/semantic results eligible.
- [ ] 3.7 Add diagnostics assertions for the new compound-name score component.

## 4. Ranking Implementation

- [ ] 4.1 Add reusable compound 1C metadata-name normalization for object names, area names, module kinds, abbreviations, stems, and adjacent phrases.
- [ ] 4.2 Add bounded compound-name scoring that requires candidate evidence and works only under 1C-aware ranking behavior.
- [ ] 4.3 Integrate compound-name support with existing object-kind, object-name, scenario-intent, generic-term penalty, exact-symbol, provider, and duplicate-diversity scoring.
- [ ] 4.4 Protect broad conceptual queries and exact-symbol/provider-backed matches from compound-name over-ranking.
- [ ] 4.5 Expose compact diagnostics for compound-name evidence without vector payloads.
- [ ] 4.6 Keep production ranking independent from holdout IDs, expected prefixes, acceptable prefixes, failure classes, and dataset notes.

## 5. Verification

- [ ] 5.1 Run focused scorer and core ranking tests for compound-name and negative-control behavior.
- [ ] 5.2 Run existing `demo-1c` live relevance workflow and confirm accepted threshold/backend correctness remain preserved.
- [ ] 5.3 Run current `demo-do30-1c` live evaluation and compare against the final tuned baseline with `0` query-level regressions.
- [ ] 5.4 Run the new holdout live evaluation and confirm strict/negative-control thresholds, `0` MCP tool errors, and `0` missing ColBERT vector errors.
- [ ] 5.5 Run `pnpm build:core`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- [ ] 5.6 Run `openspec validate --type change harden-1c-compound-name-ranking --strict` and archive verification/report artifact paths needed for review.
