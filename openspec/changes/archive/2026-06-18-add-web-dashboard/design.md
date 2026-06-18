## Context

Claude Context already has the important operational primitives: `ToolHandlers` owns `index_codebase`, `search_code`, `clear_index`, and `get_indexing_status`; daemon mode exposes an authenticated Streamable HTTP MCP endpoint; runtime status, workload state, snapshots, BGE-M3 worker planning, and accelerator telemetry are already available server-side.

The missing piece is an operator-friendly surface. Today, checking progress, observing worker health, cancelling a run, or trying a search query requires MCP tool calls, CLI admin commands, or log inspection. That is workable for agents, but inefficient for humans tuning indexing performance or managing several codebases.

The dashboard should therefore be a local daemon companion UI, not a second indexing product. It should reuse daemon internals, preserve access policy checks, and avoid creating a separate database, vector schema, or indexing path.

## Goals / Non-Goals

**Goals:**

- Provide a local browser UI for daemon status, codebase status, indexing controls, accelerator telemetry, worker planning, and semantic search.
- Keep the dashboard opt-in and local by default.
- Reuse existing MCP handler behavior for indexing, search, clear, status, and cancellation.
- Preserve existing MCP clients and the VS Code extension.
- Make BGE-M3 mode visible without conflating dense-only BGE-M3 with full BGE-M3 dense+sparse+ColBERT retrieval.
- Add enough tests and docs that the dashboard can be operated without an AI client.

**Non-Goals:**

- Remote multi-user hosting, accounts, RBAC, or team dashboards.
- Replacing MCP protocol endpoints or changing existing MCP tool response contracts.
- Changing Milvus collection layout, embedding schemas, retrieval schemas, or requiring re-indexing existing codebases.
- Editing provider credentials in the UI.
- Implementing a full file browser or source editor.

## Decisions

### Decision: Serve the dashboard from daemon mode as an opt-in companion route

Add dashboard configuration to `packages/mcp`: enabled flag, host, port/path or route prefix, and static asset path. When enabled, daemon mode serves dashboard static assets and dashboard JSON APIs alongside the existing daemon HTTP server or from a sibling HTTP server owned by the same process.

Rationale: The daemon already owns runtime state and local auth. Keeping the dashboard in the same process avoids a separate privileged process reading daemon discovery files and forwarding bearer tokens.

Alternative considered: a standalone dashboard server that calls the MCP HTTP endpoint as an external client. This is easier to isolate but creates a second auth/token handling path, complicates deployment, and risks accidentally exposing bearer tokens to browser assets.

### Decision: Use a typed dashboard API adapter over existing handlers

Create a `dashboard-api` module in `packages/mcp` that maps HTTP JSON routes to existing handler calls:

- `GET /api/daemon/status` -> daemon/operator status plus sanitized worker planning/status payload.
- `GET /api/codebases` -> known paths from snapshots, persisted config, and active workloads.
- `GET /api/codebases/status?path=...` -> `handleGetIndexingStatus`.
- `POST /api/codebases/index` -> `handleIndexCodebase`.
- `POST /api/codebases/clear` -> `handleClearIndex`.
- `POST /api/codebases/cancel` -> daemon cancellation behavior.
- `POST /api/search` -> `handleSearchCode`.

The adapter should normalize successful and failed handler results into stable JSON envelopes for the frontend while preserving the structured content already produced by MCP handlers.

Rationale: This keeps indexing/search logic in one place and gives the frontend a small HTTP contract that is easier to test than raw MCP JSON-RPC.

Alternative considered: call the MCP JSON-RPC endpoint directly from browser JavaScript. This would reuse protocol transport, but it would expose the daemon bearer token to frontend code and couple the UI to MCP session semantics that are unnecessary for a local dashboard.

### Decision: Build a small workspace frontend package

Add a package such as `packages/web-dashboard` with a Vite-based TypeScript frontend. Use a compact operational UI:

- Status/navigation sidebar for daemon health and known codebases.
- Main status view with progress, workload, accelerator, worker, VRAM, and retrieval cards.
- Control toolbar for index, clear, cancel, refresh.
- Search view with query, extension filters, result list, and code snippets.

Rationale: A dedicated package keeps frontend build output, assets, and UI tests separate from `packages/mcp` while still allowing `packages/mcp` to serve built static files.

Alternative considered: hand-written HTML/CSS/JS inside `packages/mcp`. This minimizes dependencies but becomes harder to test and maintain once charts, forms, polling, and search results are involved.

### Decision: Keep security local-first and secret-minimizing

Dashboard static assets must not embed bearer tokens. Protected API routes require daemon-compatible authorization. Status payloads must use existing sanitized daemon discovery/operator data and omit raw environment variables, provider keys, Milvus tokens, and bearer tokens.

For a first implementation, require users to open the dashboard through a local process that can present an operator session token without writing it into built assets. If browser auth is implemented with a local session cookie, it must be `HttpOnly`, `SameSite=Strict`, and scoped to the dashboard host/path.

Rationale: This repo already treats bearer token handling carefully in daemon discovery. The dashboard should not weaken that model.

Alternative considered: make the dashboard unauthenticated because it binds to localhost. Localhost-only is useful but insufficient; browser-accessible local services are still exposed to cross-site request risks and accidental port forwarding.

### Decision: Do not change storage or retrieval schemas

The dashboard reads existing status and invokes existing operations. It does not add dashboard-owned persistent state beyond optional local UI preferences such as last selected codebase path.

Rationale: Existing collections remain compatible. Dense-only BGE-M3, full BGE-M3 dense+sparse+ColBERT, hybrid dense+BM25 sparse, and other retrieval modes are display concerns for the dashboard, not schema migration triggers.

Storage and latency trade-off: full BGE-M3 retrieval has higher storage and query cost because it stores dense vectors, sparse lexical weights, and ColBERT token vectors used for late-interaction reranking. Dense-only BGE-M3 has lower storage and lower query latency but weaker lexical and late-interaction matching. The dashboard should surface the configured retrieval mode and relevant counters without changing the retrieval path.

### Decision: Poll first, stream later

Use periodic polling for daemon and codebase status with non-overlapping requests and visible stale/error state. Defer Server-Sent Events or WebSocket streaming until the dashboard proves the need.

Rationale: `get_indexing_status` and `get_daemon_status` already provide snapshots. Polling is easier to test, works behind simple local HTTP serving, and avoids adding lifecycle complexity while indexing is still owned by background workloads.

Alternative considered: SSE for live progress. It gives better UX for long runs but adds reconnect, cancellation, and event buffering concerns that are not required for the first useful dashboard.

## Risks / Trade-offs

- Browser API accidentally bypasses access policy -> Route every path-bearing request through the same normalization and `CodebaseAccessPolicy` checks used by MCP handlers.
- Secrets leak into frontend assets or status JSON -> Add tests that inspect static asset content and sanitized API payloads for token/key field names and configured secret values.
- Dashboard route interferes with MCP Streamable HTTP endpoint -> Keep route prefixes disjoint and add regression tests for MCP endpoint behavior with dashboard enabled.
- New frontend dependencies increase install/build time -> Keep the package small, avoid UI frameworks beyond what is justified, and wire package-specific build scripts so MCP-only builds remain predictable.
- Polling adds load during heavy indexing -> Use conservative default intervals, avoid overlapping requests, and let the UI pause polling when hidden.
- UI shows misleading retrieval capability -> Display dense-only BGE-M3 separately from full BGE-M3 dense+sparse+ColBERT and include retrieval schema version when available.
- Clear/cancel operations are destructive or disruptive -> Require explicit confirmation in the UI and show affected active/queued jobs returned by the server.

## Migration Plan

1. Add dashboard config defaults with the dashboard disabled.
2. Add the typed dashboard API adapter and tests against existing handler behavior.
3. Add the frontend package and static build integration.
4. Serve static assets and API routes only when enabled.
5. Document enablement, auth, and verification steps.

Rollback is straightforward: disable the dashboard flag or remove the dashboard route registration. Existing indexed collections, daemon state, MCP clients, and retrieval behavior are unchanged.

## Open Questions

- Should the first UI include a local login/session page, or should it rely on an operator-open command that creates a short-lived local session?
- Should dashboard static assets be served on the same port as MCP under a route prefix, or on a separate local port to simplify routing and CSP?
- Should codebase registration be persisted as part of existing codebase config, or should the first version only list known/snapshot/workload paths plus manual path entry?
