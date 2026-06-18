## Why

Claude Context has daemon-side indexing, search, worker planning, and accelerator telemetry, but operators currently inspect and control it through MCP tool calls or logs. A local web dashboard would make the daemon observable and operable without requiring an AI client session for every status check, benchmark run, or code search.

## What Changes

- Add a local web dashboard for the Claude Context daemon.
- Show daemon health, configured runtime mode, allowed roots, active workloads, indexing progress, accelerator metrics, BGE-M3 worker state, and retrieval configuration.
- Allow users to register or select codebase paths, start indexing, clear indexes, cancel active indexing, and refresh status.
- Provide a search view over indexed codebases using the existing `search_code` behavior.
- Add a small web API layer that reuses existing MCP handlers and access policy checks instead of duplicating indexing/search logic.
- Add development and production commands for running the dashboard locally.
- Add documentation for enabling, securing, and troubleshooting the dashboard.
- Non-goals:
  - Do not replace MCP clients, the daemon MCP endpoint, or the VS Code extension.
  - Do not add remote multi-user hosting, account management, or cloud synchronization.
  - Do not introduce a new vector schema or re-index requirement solely for the dashboard.
  - Do not expose secrets, bearer tokens, embedding keys, Milvus credentials, or raw environment dumps in the UI.

## Capabilities

### New Capabilities

- `web-dashboard`: Defines the local browser UI, web API, daemon integration, operational controls, search workflow, and security boundaries for a Claude Context dashboard.

### Modified Capabilities

- None.

## Impact

- Affected packages:
  - `packages/mcp`: dashboard server entrypoint, HTTP API adapter, static asset serving, config/env parsing, tests.
  - New or existing web client package under `packages/`: dashboard frontend implementation and build output.
  - `docs/`: setup, environment variables, security notes, and operator workflow.
- Runtime impact:
  - The dashboard is opt-in and local by default.
  - Existing daemon MCP API and clients continue to work unchanged.
  - Existing indexed collections remain compatible; no migration or rebuild is required by this change.
- Dependency impact:
  - May add a lightweight frontend build stack and a small HTTP/static serving dependency if not already available.
  - Must keep Node.js `>=20` and pnpm workspace compatibility.
