## Context

Operators currently see transient messages after dashboard actions. Once a refresh happens or an error is cleared, the local sequence of actions disappears. The daemon has logs, but the dashboard should show enough recent context for routine operation and support handoff.

## Goals / Non-Goals

Goals:
- Keep a recent client-local action log.
- Capture success and failure outcomes for dashboard operations.
- Provide a sanitized diagnostics copy action.
- Avoid storing secrets.

Non-goals:
- Durable server audit.
- Multi-user identity.
- Log streaming from daemon journal.

## Decisions

### Decision: Keep the first log client-local

Store recent entries in frontend state, optionally mirrored to session storage if useful.

Rationale: This gives immediate operator value without adding persistence, retention policy, or server-side audit semantics.

### Decision: Wrap dashboard API calls in an action recorder

Record action name, target path, start/end time, status, and sanitized error around existing API calls.

Rationale: Centralizing action logging avoids per-control drift.

### Decision: Add sanitized diagnostics copy

Provide a copy action that includes current daemon summary, selected codebase status, and recent action log entries with secret-bearing fields stripped.

Rationale: This helps debugging and sharing evidence without copying raw daemon discovery files.

## Risks / Trade-offs

- Client-local logs disappear on full reload unless mirrored to session storage. This is acceptable for first implementation.
- Error messages may include paths. Paths are operational data and are allowed, but secrets must be stripped.
- Copying diagnostics can produce large payloads. Cap action log length and omit bulky result snippets.

## Migration Plan

No migration. The log starts empty on first load and records subsequent dashboard actions.
