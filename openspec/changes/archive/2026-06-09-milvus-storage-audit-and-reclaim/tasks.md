## 1. Inventory and Ownership

- [x] 1.1 Audit existing Milvus/vector DB helpers for collection listing, descriptions, row counts, and drop support.
- [x] 1.2 Add a read-only local storage inventory helper that lists collections and maps them to codebase paths where possible.
- [x] 1.3 Include daemon snapshot status and per-codebase config metadata in the inventory.
- [x] 1.4 Include aggregate local volume size and major MinIO categories (`wp`, `insert_log`, `index_files`) when the local volume path is available.
- [x] 1.5 Add tests for inventory output with owned, stale, and orphan candidate collections.

## 2. Dry-Run Reclaim Planning

- [x] 2.1 Add dry-run reclaim planning for a known codebase path.
- [x] 2.2 Report collection names, snapshot/config updates, index loss, and reindex requirement in dry-run output.
- [x] 2.3 Add orphan candidate detection without automatic deletion.
- [x] 2.4 Add tests proving dry-run does not mutate vector DB, snapshot, or config state.

## 3. Safe Reclaim Execution

- [x] 3.1 Reuse or extend `clear_index` so known-codebase reclaim drops collections through vector DB/Milvus APIs.
- [x] 3.2 Ensure snapshot and codebase config state are updated consistently after successful collection drop.
- [x] 3.3 Add explicit confirmation/force flag for destructive reclaim operations.
- [x] 3.4 Handle missing collection and stale snapshot cases with clear non-destructive outcomes.
- [x] 3.5 Add tests for successful reclaim, missing collection cleanup, and drop failure rollback/error reporting.

## 4. Operator Tooling and Docs

- [x] 4.1 Expose the audit and dry-run workflow through MCP, CLI, or a repo script with structured JSON output.
- [x] 4.2 Document that direct deletion inside `~/.local/share/claude-context/milvus/volumes` is unsafe.
- [x] 4.3 Document BGE-M3 full/multivector storage drivers and how retrieval profiles affect disk usage.
- [x] 4.4 Document before/after evidence commands for local Milvus volume usage.
- [x] 4.5 Add troubleshooting guidance for cases where dropping collections does not immediately free disk.

## 5. Live Verification

- [x] 5.1 Run read-only audit against the local Milvus instance and capture current `146GB` volume breakdown as verification evidence.
- [x] 5.2 Dry-run reclaim for at least one failed benchmark codebase, without mutation first.
- [x] 5.3 If approved, run reclaim for selected failed/stale indexes and capture before/after collection inventory and `du` output.
- [x] 5.4 Verify remaining indexed codebases still search successfully after cleanup.
- [x] 5.5 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 5.6 Run `pnpm exec openspec validate milvus-storage-audit-and-reclaim --strict`.
