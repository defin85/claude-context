## 1. Planning and State Model

- [ ] 1.1 Inventory current initial, force, and incremental indexing entry points in `packages/core` and `packages/mcp`.
- [ ] 1.2 Define `IndexingMode` and planner inputs/outputs for `initial_full`, `initial_resume`, `incremental_changes`, and `incompatible_requires_reindex`.
- [ ] 1.3 Define manifest version, compatibility fingerprint fields, batch states, and atomic persistence location.
- [ ] 1.4 Add migration behavior for existing completed indexes and pre-manifest failed/partial indexes.

## 2. Manifest Persistence

- [ ] 2.1 Implement atomic manifest read/write helpers with corruption handling.
- [ ] 2.2 Persist manifest creation at initial indexing start.
- [ ] 2.3 Persist batch lifecycle transitions without marking unconfirmed work as inserted.
- [ ] 2.4 Persist confirmed inserted document identifiers only after successful vector write.
- [ ] 2.5 Mark manifest completed only after all selected chunks are confirmed and synchronizer state is written.

## 3. Mode Planner Integration

- [ ] 3.1 Integrate planner before `index_codebase` starts indexing work.
- [ ] 3.1.1 Ensure planner runs before collection preparation, force-mode drops, and completed synchronizer snapshot writes.
- [ ] 3.2 Route new/incompatible targets to `initial_full` or explicit reindex-required errors.
- [ ] 3.3 Route compatible interrupted targets to `initial_resume`.
- [ ] 3.4 Route compatible completed targets to ordinary changed-file indexing.
- [ ] 3.5 Preserve existing `force=true` rebuild behavior and make its interaction with manifests explicit.

## 4. Resume Execution

- [ ] 4.1 Re-run traversal and chunk planning for resume with the effective configuration.
- [ ] 4.2 Verify stable document identifiers across dense, hybrid, BGE-M3 full, accelerated, and non-accelerated paths.
- [ ] 4.3 Skip only chunks confirmed inserted in the compatible manifest.
- [ ] 4.4 Reprocess planned, embedding, inserting, failed, cancelled, and missing chunks.
- [ ] 4.5 Ensure coalesced writes retain per-document or per-batch confirmation data.

## 5. Backend Safety

- [ ] 5.1 Identify vector adapter paths that support upsert or equivalent idempotent writes.
- [ ] 5.1.1 Record write safety per insert mode: dense, hybrid, and BGE-M3 full.
- [ ] 5.2 Fail closed for ambiguous insert outcomes when no safe retry path exists.
- [ ] 5.3 Add safeguards for backend-specific duplicate or partial-write behavior.

## 6. Status and Operator Output

- [ ] 6.1 Add selected indexing mode to status and completion output.
- [ ] 6.2 Add resume eligibility, manifest compatibility, skipped, remaining, failed, and unconfirmed counters.
- [ ] 6.3 Ensure status details are scoped to the requested codebase path.
- [ ] 6.4 Add operator-facing guidance for legacy partial state and incompatible resume rejection.

## 7. Tests

- [ ] 7.1 Add planner unit tests for empty, completed, interrupted, incompatible, force, and legacy partial states.
- [ ] 7.2 Add manifest persistence tests for atomic writes, state transitions, and corruption handling.
- [ ] 7.3 Add resume tests proving confirmed chunks are skipped and unconfirmed chunks are reprocessed.
- [ ] 7.4 Add retry-safety tests for ambiguous insert outcomes and idempotent backend paths.
- [ ] 7.5 Add matrix tests for dense, hybrid, BGE-M3 full, accelerated and non-accelerated execution.
- [ ] 7.6 Add 1C scope profile tests for `full`, `developer`, `minimal`, and `v8unpack`.
- [ ] 7.7 Add status tests proving mode and resume counters are reported without cross-codebase leakage.

## 8. Documentation and Validation

- [ ] 8.1 Document automatic mode selection and resume behavior for operators.
- [ ] 8.2 Document migration behavior for existing completed and failed indexes.
- [ ] 8.3 Run `pnpm lint`, `pnpm typecheck`, package tests, and targeted resume integration tests.
- [ ] 8.4 Run `openspec validate add-resumable-initial-indexing-manifest --strict` before implementation is marked ready.
