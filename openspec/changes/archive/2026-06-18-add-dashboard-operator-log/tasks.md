## 1. Action Logging Model

- [x] 1.1 Define frontend action log entry type and maximum entry count.
- [x] 1.2 Add a helper that records action start, success, failure, duration, and target path.
- [x] 1.3 Add secret redaction for known token/key field names and values.

## 2. Dashboard UI

- [x] 2.1 Add an operator log panel with recent entries.
- [x] 2.2 Wire refresh, index, cancel, clear, and search through the action recorder.
- [x] 2.3 Render success and failure entries with compact status labels.
- [x] 2.4 Add a sanitized diagnostics copy action.
- [x] 2.5 Handle clipboard failure with an operator-visible error.

## 3. Tests and Validation

- [x] 3.1 Add frontend tests or TypeScript-level checks for log entry shaping and redaction.
- [x] 3.2 Verify static assets and diagnostics payload do not contain secret values.
- [x] 3.3 Run frontend typecheck and build.
- [x] 3.4 Smoke-test successful and failed dashboard actions in the browser.
- [x] 3.5 Run `pnpm exec openspec validate add-dashboard-operator-log --strict`.
