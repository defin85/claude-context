## 1. Specification

- [x] 1.1 Add daemon startup resume requirements.
- [x] 1.2 Define safe eligibility and explicit non-eligible failure states.
- [x] 1.3 Define observability for queued, skipped, and failed startup resume attempts.

## 2. Implementation

- [x] 2.1 Add snapshot helper to list failed codebase entries with error details.
- [x] 2.2 Add startup recovery pass in daemon mode after migration and before background sync.
- [x] 2.3 Build resume requests from persisted per-codebase configuration with `force=false`.
- [x] 2.4 Skip disallowed, missing, unconfigured, and already queued or active codebases.
- [x] 2.5 Log and expose a compact startup recovery summary.

## 3. Tests

- [x] 3.1 Add unit coverage for interrupted failure eligibility.
- [x] 3.2 Add unit coverage that ordinary failed indexes are not retried.
- [x] 3.3 Add startup recovery coverage for persisted config preservation and `force=false`.
- [x] 3.4 Run targeted MCP tests, `pnpm --filter @zilliz/claude-context-mcp typecheck`, and `openspec validate resume-interrupted-indexing-on-daemon-start --strict`.
