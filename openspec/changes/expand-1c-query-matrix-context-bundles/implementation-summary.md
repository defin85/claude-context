## Implementation Summary

Implemented the universal 1C matrix expansion from path-level checks to
task-oriented context-bundle evaluation.

## Matrix Coverage

- Total rows remain 78: 70 positive and 8 negative-control rows.
- Added `queryPurpose` to every universal matrix row:
  - `navigation`: 48
  - `applied-usage`: 10
  - `negative-control`: 8
  - `library-oriented`: 4
  - `task-implementation`: 8
- Added required result roles to 8 task-implementation rows:
  `ssl02`, `ssl05`, `ssl06`, `ssl08`, `led01`, `led04`, `led05`, and `ssl09`.
- Each primary fixture has 8 role-bearing applicable targets:
  `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c`.
- New role labels use reusable role identifiers:
  `library-api`, `client-usage`, `server-usage`, `applied-usage`, and `metadata`.

## Reporting And Validation

- Matrix validation now reports query-purpose coverage and fails the universal
  matrix on missing or unknown `queryPurpose` values.
- Scoring now reports grouped `bundleRoles.missingRequiredRolesById` with
  query, fixture, purpose, and path-prefix context.
- Markdown reports now include query-purpose validation, query-purpose counts,
  BGE-M3 mode metadata when available, and a missing required bundle roles
  aggregate section.
- Live MCP raw artifacts now record BGE-M3 mode metadata from arguments and
  index status when available.

## Evidence Artifacts

- Live semantic-search smoke:
  `.artifacts/hybrid-code-symbol-retrieval/2026-06-21-expand-1c-query-matrix-context-bundles-demo-bp30-smoke/`
  - fixture: `demo-bp30-1c`
  - Hit@10: 36/49
  - acceptable Hit@10: 39/49
  - negative controls: 6/6 passed
  - MCP tool errors: 0
  - missing ColBERT vector errors: 0
  - bundle roles: 0/8 complete, 17 missing required roles
  - missing role groups: `client-usage=4`, `server-usage=4`,
    `library-api=3`, `applied-usage=4`, `metadata=2`
- Saved complete/incomplete bundle sample:
  `.artifacts/expand-1c-query-matrix-context-bundles/bundle-role-sample/`
  - bundle roles: 1/2 complete
  - missing required roles grouped under `client-usage`

Live evidence is a dated quality snapshot. It is not a production ranking
input and does not change `search_code` behavior.

## Verification

- `node --test scripts/run-demo-1c-relevance-eval.test.js`
- Universal matrix validation across all configured fixtures:
  - all fixtures strict-ready
  - `needsInspection=0`
  - `unreachablePrefixCount=0`
  - `issueCount=0`
  - missing query purpose count: 0
  - unknown query purpose count: 0
- `openspec validate expand-1c-query-matrix-context-bundles --strict`
- `git diff --check`
- `pnpm lint`
  - completed with exit code 0
  - existing warnings remain in `packages/core/src/code-symbol-retrieval.ts`
    and `packages/core/src/context.ts`
- `pnpm typecheck`
- `pnpm build`
