# Verification

## Automated Checks

- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/milvus-storage-audit.test.ts`
  - Result: passed, 8 tests.
- `node --check scripts/milvus-storage-audit.js`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
  - Result: passed.
- `pnpm lint`
  - Result: passed with existing warnings in core, chrome extension, and VS Code extension packages.
- `pnpm build`
  - Result: passed.
- `pnpm typecheck`
  - Result: passed after `pnpm build`.
  - Note: an earlier parallel run overlapped with `pnpm build` cleaning `packages/core/dist`, causing transient TS6305 errors in the VS Code extension.
- `pnpm exec openspec validate milvus-storage-audit-and-reclaim --strict`
  - Result: passed.

## Live Local Milvus Audit

Artifact:

- `.artifacts/milvus-storage-audit/2026-06-07T16-11-08Z/audit.json`
- `.artifacts/milvus-storage-audit/2026-06-07T16-11-08Z/summary.json`
- `.artifacts/milvus-storage-audit/2026-06-07T16-11-08Z/du-sk.txt`

Command:

```bash
node scripts/milvus-storage-audit.js --dry-run-reclaim "$PWD/examples/demo-do30-1c" --json
du -sk ~/.local/share/claude-context/milvus/volumes
```

Observed current volume:

- `du -sk`: `120202768 KiB`
- Audit `localVolume.sizeBytes`: `122770739200`
- `wp`: `99896176640`
- `insert_log`: `20353335296`
- `index_files`: `2521227264`

The proposal recorded an earlier rough `146GB` observation. The live verification captured the current state after later Milvus activity; current usage is about `122.8GB`.

Audit summary:

- collections: `10`
- code collections: `10`
- known codebases: `9`
- orphan candidates: `0`
- stale snapshots: `3`
- snapshot-only missing collections: `0`

Dry-run reclaim target:

- codebase: `examples/demo-do30-1c`
- snapshot status: `indexfailed`
- collection: `bge_m3_code_chunks_52488909`
- planned actions: drop collection, remove snapshot, remove codebase config
- result: dry-run only, no mutation.

## Confirmed Reclaim

Artifact:

- `.artifacts/milvus-storage-audit/2026-06-07T18-35-36Z-reclaim-demo-do30/before-audit.json`
- `.artifacts/milvus-storage-audit/2026-06-07T18-35-36Z-reclaim-demo-do30/reclaim.json`
- `.artifacts/milvus-storage-audit/2026-06-07T18-35-36Z-reclaim-demo-do30/after-audit.json`
- `.artifacts/milvus-storage-audit/2026-06-07T18-35-36Z-reclaim-demo-do30/before-du-sk.txt`
- `.artifacts/milvus-storage-audit/2026-06-07T18-35-36Z-reclaim-demo-do30/after-du-sk.txt`

Command:

```bash
target="$PWD/examples/demo-do30-1c"
node scripts/milvus-storage-audit.js --dry-run-reclaim "$target" --json
du -sk ~/.local/share/claude-context/milvus/volumes
node scripts/milvus-storage-audit.js --reclaim "$target" --confirm-reclaim --json
du -sk ~/.local/share/claude-context/milvus/volumes
node scripts/milvus-storage-audit.js --json
```

Reclaimed target:

- codebase: `examples/demo-do30-1c`
- collection: `bge_m3_code_chunks_52488909`
- before summary: `10` collections, `9` known codebases, `3` stale snapshots
- after summary: `9` collections, `8` known codebases, `3` stale snapshots
- reclaim actions: drop collection, remove snapshot, remove codebase config

Volume observations:

- before `du -sk`: `105650496 KiB`
- after `du -sk`: `105650680 KiB`
- before audit aggregate: `122770739200`
- after audit aggregate: `107875340288`
- after `wp`: `90320519168`
- after `insert_log`: `15748554752`
- after `index_files`: `1806266368`

The whole-volume `du` value did not immediately decrease even though the audit's major MinIO categories fell. This matches the documented Milvus/MinIO compaction and garbage-collection caveat.

## Post-Reclaim Search Checks

MCP `search_code` succeeded for remaining indexed codebases inside the current daemon allowlist:

- `/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context`
- `/run/media/egor/D6B64A72B64A52E3/Projects/AgentHarness/claude-context/examples/demo-1c`
- `/run/media/egor/D6B64A72B64A52E3/Projects/remnawave-cdn-runbook`

The old indexed path `/run/media/egor/D6B64A72B64A52E3/Projects/claude-context` remains in audit output but cannot be searched by the current daemon because it is outside `allowedRoots`. That is an allowlist constraint, not a reclaim regression.
