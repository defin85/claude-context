## Why

The dashboard can run operational actions, but after an action completes the operator has little local context unless they inspect logs or remember what they clicked. A lightweight operator log will make recent dashboard actions and API outcomes visible without exposing secrets.

## What Changes

- Add an in-dashboard operator action log.
- Record recent dashboard actions such as refresh, index, cancel, clear, search, and failed API calls.
- Show timestamp, action type, target codebase, result, duration, and sanitized error message when available.
- Keep the log client-local for this phase.
- Add a copy diagnostics action that exports sanitized daemon/status/action context.
- Non-goals:
  - Do not create a server-side audit database.
  - Do not log bearer tokens, provider keys, Milvus tokens, raw environment variables, or request authorization headers.
  - Do not implement multi-user audit trails or compliance retention.
  - Do not change MCP handler behavior.

## Capabilities

### New Capabilities
- `dashboard-operator-log`: Defines client-local dashboard action logging, sanitized diagnostics export, and failure visibility.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `packages/web-dashboard`: action log state, rendering, copy diagnostics action, sanitized error display.
  - `packages/mcp`: no expected backend change unless diagnostics need a sanitized status endpoint variant.
- Runtime impact:
  - Client-local UI feature only.
  - No index migration and no server-side persistence.
