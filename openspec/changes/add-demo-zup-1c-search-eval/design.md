## Context

The current universal 1C search matrix evaluates common navigation scenarios across `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c`. The new `examples/demo-zup-1c` source export is a large HR/payroll configuration with ZUP-specific domains such as salary accrual, HR orders, time tracking, leave, sick leave, NDFL, insurance contributions, SEDO/FSS, and military accounting.

The existing matrix contains reusable cross-configuration rows for BSP, users, settings storage, SMS, exchange plans, reports, counterparties, and common administration, but it also contains rows that are trade/accounting/document-management specific. The implementation should add ZUP without pretending those rows apply when the source tree does not support them.

## Goals / Non-Goals

**Goals:**

- Add `demo-zup-1c` to the universal matrix as a first-class fixture.
- Preserve source-backed label discipline: every `applicable` strict or acceptable prefix must be reachable in the ZUP export.
- Mark trade/accounting-only rows as `not-applicable` for ZUP when no source-backed ZUP equivalent exists.
- Add ZUP-specific positive scenarios that exercise HR/payroll concepts rather than only BSP/common infrastructure.
- Keep negative controls visible for ZUP so broad HR/payroll terms do not make exact-looking but unrelated results look correct.
- Produce live ZUP report artifacts with backend, retrieval mode, ranking profile, index status, raw top results, label validation, summary metrics, and negative-control outcomes.

**Non-Goals:**

- No change to `search_code` MCP schemas.
- No change to BGE-M3 full dense+sparse+ColBERT storage, Qdrant/Milvus schemas, or index migration behavior.
- No re-ranking implementation change unless evaluation proves an existing ranking gap.
- No requirement to commit the local `examples/demo-zup-1c` source export.
- No metric-only label broadening for rows that were not source-inspected.

## Decisions

### Decision: Extend the universal matrix instead of creating a separate ZUP-only dataset

ZUP should be added to `universal-1c-search-matrix.json` so cross-fixture reporting can show which scenarios are truly shared and which are configuration-specific.

Alternative considered: create `demo-zup-1c-scenarios.json` only. That would be simpler for first measurement, but it would not answer the user's question about whether the universal queries fit ZUP.

### Decision: Keep statuses explicit per row

Each ZUP target should be one of:

- `applicable` with strict and optional acceptable prefixes;
- `not-applicable` with a short source-backed reason;
- `needs-inspection` only when the export suggests a subsystem may exist but no reliable expected path has been inspected yet.

Rationale: this avoids scoring absent trade/accounting features as misses and avoids treating broad subsystem names as proof.

### Decision: Add ZUP-specific rows for payroll and HR domains

The matrix should gain positive rows for documents and subsystems that are central to ZUP, including:

- salary accrual;
- payroll payment statements;
- hiring;
- HR transfer;
- dismissal;
- leave and leave balances;
- sick leave;
- time sheet;
- NDFL;
- insurance contributions;
- SEDO/FSS workflows;
- military accounting.

Rationale: otherwise ZUP would mostly test BSP/common features and not the configuration's real business surface.

### Decision: Keep evaluation changes separate from production ranking behavior

The implementation should update labels, runner defaults, validation, and reports before touching ranking. If live ZUP evaluation exposes ranking misses, those misses should be recorded as evidence for a follow-up ranking change unless a small, clearly generic fix is required for the acceptance path.

Rationale: the change is about adding coverage and source-backed evaluation, not overfitting ranking to one newly added fixture.

## Risks / Trade-offs

- [Risk] Some ZUP domains have multiple legitimate entry points, such as documents, forms, common modules, and reports. Mitigation: strict prefixes should target the best source-inspected development entry point; acceptable prefixes may include documented neighboring entry points.
- [Risk] The current ZUP export may be incomplete while files are still being copied or regenerated. Mitigation: label validation must run after the final export is present and before acceptance thresholds are trusted.
- [Risk] Generic terms such as employee, document, accrual, report, and setting can collide widely in ZUP. Mitigation: add negative controls and inspect raw top results before setting strict thresholds.
- [Risk] ZUP indexing is large and can be expensive in BGE-M3 full mode. Mitigation: reuse the existing `developer` 1C scope and `quality` retrieval profile only for live acceptance; local scoring can run from saved raw results.

## Migration Plan

1. Add ZUP fixture metadata and per-row target statuses to the universal matrix.
2. Add ZUP-specific positive and negative-control rows.
3. Extend tests to validate ZUP labels against `examples/demo-zup-1c` when the local export exists.
4. Index `examples/demo-zup-1c` with the same 1C developer scope used for other large 1C fixtures.
5. Run live MCP evaluation for ZUP, save raw results, summary, label validation, and markdown report.
6. Record any `needs-inspection`, accepted alternatives, and intentionally not-applicable rows in verification.

Rollback is limited to evaluation data, runner wiring, and reports. Existing indexes remain compatible.

## Open Questions

- The exact strict prefixes for payroll and HR rows should be finalized from source inspection, not from object-name guesses alone.
- The first acceptance threshold should be set only after the initial ZUP baseline run and label validation.
