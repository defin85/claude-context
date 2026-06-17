## Verification

Date: 2026-06-17

## Automated checks

- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts src/dashboard-api.test.ts`
  - Result: passed, 10 tests.
- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/dashboard-routing.test.ts src/dashboard-api.test.ts src/dashboard-static-security.test.ts`
  - Result: passed, 11 tests.
- `pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/*.test.ts`
  - Result: passed, 61 tests.
- `pnpm build:mcp`
  - Result: passed.
- `pnpm build:web-dashboard`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-web-dashboard test`
  - Result: passed.
- `pnpm --filter @zilliz/claude-context-mcp typecheck`
  - Result: passed.
- `pnpm typecheck`
  - Result: passed.
- `pnpm lint`
  - Result: passed.
- `pnpm build`
  - Result: passed.
- `pnpm exec openspec validate add-web-dashboard --strict`
  - Result: passed.

## Frontend smoke

Ran `pnpm --filter @zilliz/claude-context-web-dashboard preview`, opened `http://127.0.0.1:4173/` with `playwright-cli`, and captured:

- Desktop screenshot: `/tmp/claude-context-dashboard-desktop.png`
- Interaction screenshot: `/tmp/claude-context-dashboard-interaction.png`
- Mobile screenshot: `/tmp/claude-context-dashboard-mobile.png`

Checks covered:

- page title is `Claude Context Dashboard`;
- first meaningful screen renders and is not blank;
- mobile viewport renders without overlapping controls in the captured snapshot;
- token entry plus refresh interaction works in standalone preview mode;
- standalone preview reports a clear API-unavailable message instead of surfacing raw HTML JSON parsing errors.

The Browser plugin was not available in this session, so rendered validation used `playwright-cli`.

## Live daemon smoke

Started an isolated daemon from the compiled MCP build with a temporary `HOME`, temporary allowlisted repo, dashboard static dir, and port `39444`:

```text
MCP_BENCHMARK_IDLE_STUBS=1
HOME=<temporary>
MCP_RUNTIME_MODE=daemon
MCP_DAEMON_TOKEN=dashboard-smoke-token
MCP_DAEMON_ALLOW_ROOTS=<temporary repo>
MCP_DASHBOARD_ENABLED=true
MCP_DASHBOARD_STATIC_DIR=packages/web-dashboard/dist
MCP_DAEMON_PORT=39444
node packages/mcp/dist/index.js
```

Observed:

- `GET /dashboard/` returned `200`.
- `GET /mcp` without bearer token returned `401`, preserving MCP auth behavior.
- `GET /dashboard/api/daemon/status` without bearer token returned `401`.
- `GET /dashboard/api/daemon/status` with `Authorization: Bearer dashboard-smoke-token` returned `200`.
- The authenticated dashboard status payload used sanitized discovery data and did not include `bearerToken`.

The smoke did not include one indexed codebase plus one active indexing workload. An earlier attempt to start the source entrypoint through `packages/mcp/node_modules/.bin/tsx packages/mcp/src/index.ts` failed before binding the port with:

```text
SyntaxError: The requested module '@zilliz/claude-context-core' does not provide an export named 'envManager'
```

The compiled daemon entrypoint did not hit that issue.

## Live dashboard smoke with indexing workload

Started an isolated daemon from the compiled MCP build with a temporary `HOME`, temporary allowlisted repository, dashboard static dir, BGE-M3 on `http://127.0.0.1:8000`, Qdrant on `http://127.0.0.1:6333`, dense retrieval profile, and port `39446`:

```text
HOME=<temporary>
MCP_RUNTIME_MODE=daemon
MCP_DAEMON_TOKEN=dashboard-smoke-token
MCP_DAEMON_ALLOW_ROOTS=<temporary repo>
MCP_DASHBOARD_ENABLED=true
MCP_DASHBOARD_STATIC_DIR=packages/web-dashboard/dist
MCP_DAEMON_PORT=39446
EMBEDDING_PROVIDER=BGE_M3
BGE_M3_ENDPOINT=http://127.0.0.1:8000
RETRIEVAL_PROFILE=fast
BGE_M3_MODE=dense
BGE_M3_STORE_COLBERT=false
VECTOR_DATABASE_BACKEND=qdrant
QDRANT_URL=http://127.0.0.1:6333
node packages/mcp/dist/index.js
```

Observed:

- `GET /dashboard/` returned `200`.
- `GET /mcp` without bearer token returned `401`.
- authenticated MCP `initialize` request to `/mcp` returned `200` while the dashboard was enabled.
- `GET /dashboard/api/daemon/status` without bearer token returned `401`.
- `GET /dashboard/api/daemon/status` with `Authorization: Bearer dashboard-smoke-token` returned `200`.
- `POST /dashboard/api/codebases/index` returned `200`.
- dashboard daemon status showed an active indexing workload: `active=1`, `queued=0`, `known=1`.
- selected codebase status reached `indexed` for 900 TypeScript files and 1800 chunks.
- `POST /dashboard/api/search` returned `200` with search results containing relative paths, line ranges, language, score, and snippets.
- `POST /dashboard/api/codebases/clear` returned `200`, cleaning the temporary smoke index.
- authenticated dashboard JSON plus static HTML did not contain the bearer token or the `bearerToken` field name.

An earlier isolated smoke using `MCP_BENCHMARK_IDLE_STUBS=1` was intentionally discarded for workload validation because the idle vector database stub does not implement the full indexing collection contract:

```text
Error validating collection creation: this.context.getVectorDatabase(...).checkCollectionLimit is not a function
```
