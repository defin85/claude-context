## 1. Dashboard Configuration and Routing

- [ ] 1.1 Add dashboard config fields and environment/CLI parsing with disabled-by-default behavior.
- [ ] 1.2 Define dashboard route prefixes so static assets and JSON APIs cannot collide with the existing MCP endpoint path.
- [ ] 1.3 Add tests proving dashboard routes are not exposed when disabled.
- [ ] 1.4 Add tests proving MCP Streamable HTTP requests still work when dashboard routes are enabled.

## 2. Dashboard API Adapter

- [ ] 2.1 Create a `packages/mcp` dashboard API module that maps HTTP JSON requests to existing daemon and `ToolHandlers` behavior.
- [ ] 2.2 Implement sanitized daemon status and known-codebase listing endpoints.
- [ ] 2.3 Implement selected-codebase status, index, clear, cancel, and search endpoints.
- [ ] 2.4 Normalize success and error responses into a typed frontend-facing JSON envelope.
- [ ] 2.5 Add API tests for allowed paths, disallowed paths, missing paths, handler errors, and not-indexed search.

## 3. Security and Secret Handling

- [ ] 3.1 Require dashboard API authorization using daemon-compatible local authentication.
- [ ] 3.2 Ensure static assets do not embed bearer tokens, provider API keys, Milvus tokens, or raw environment values.
- [ ] 3.3 Ensure dashboard status payloads use sanitized daemon/operator data and omit secret-bearing fields.
- [ ] 3.4 Add regression tests that fail if configured secret values appear in static assets or dashboard JSON responses.
- [ ] 3.5 Add confirmation safeguards for clear-index and cancel-indexing actions.

## 4. Frontend Package

- [ ] 4.1 Add a workspace frontend package for the dashboard with build, dev, typecheck, lint, and test scripts.
- [ ] 4.2 Implement a compact operational layout with daemon summary, codebase selector, status view, controls, and search view.
- [ ] 4.3 Implement typed API client utilities with stale-state, loading, error, and unauthorized states.
- [ ] 4.4 Implement non-overlapping periodic refresh for daemon and selected-codebase status.
- [ ] 4.5 Implement search result rendering with relative path, line range, language, score, and content snippet.
- [ ] 4.6 Display retrieval mode clearly, including dense-only BGE-M3 versus full BGE-M3 dense+sparse+ColBERT.

## 5. Static Serving and Developer Workflow

- [ ] 5.1 Wire the dashboard frontend production build into `packages/mcp` static serving.
- [ ] 5.2 Add package scripts for building only the dashboard and for building MCP with dashboard assets.
- [ ] 5.3 Add a local development workflow that can run the frontend against a live daemon API without exposing secrets.
- [ ] 5.4 Add fallback behavior for missing built assets with a clear operator error.

## 6. Documentation

- [ ] 6.1 Document dashboard enablement flags/environment variables, local URL, and auth model.
- [ ] 6.2 Document supported operator workflows: view status, index, cancel, clear, search, and troubleshoot daemon connectivity.
- [ ] 6.3 Document security boundaries and warn against binding the dashboard to non-local interfaces without an explicit deployment review.
- [ ] 6.4 Document development and verification commands for backend API, frontend UI, and full daemon smoke checks.

## 7. Validation

- [ ] 7.1 Run dashboard API unit tests and MCP daemon routing regression tests.
- [ ] 7.2 Run frontend typecheck, lint, unit tests, and production build.
- [ ] 7.3 Run `pnpm --filter @zilliz/claude-context-mcp typecheck` and `pnpm --filter @zilliz/claude-context-mcp build`.
- [ ] 7.4 Run repository-level `pnpm lint`, `pnpm typecheck`, and `pnpm build` or document any scoped substitutions.
- [ ] 7.5 Run `pnpm exec openspec validate add-web-dashboard --strict`.
- [ ] 7.6 Smoke-test an enabled local dashboard against a daemon with one indexed codebase and one active indexing workload.
- [ ] 7.7 Capture verification evidence in `openspec/changes/add-web-dashboard/verification.md`.
