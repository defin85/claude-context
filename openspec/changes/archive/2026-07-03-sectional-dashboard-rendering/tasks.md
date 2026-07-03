## 1. Rendering Structure

- [x] 1.1 Introduce a stable dashboard shell with named section containers for metrics, codebases, toolbar, operations, worker telemetry, notices/log, profile diagnostics, search controls, and results.
- [x] 1.2 Add a small section render helper that stores section fingerprints and replaces only sections whose fingerprint changed.
- [x] 1.3 Move current root-level markup into section render functions without changing displayed labels, controls, or API calls.
- [x] 1.4 Keep selectable text containers separate from volatile controls so busy/disabled button changes do not replace path text, result snippets, log entries, or diagnostics.

## 2. Refresh Behavior

- [x] 2.1 Change periodic refresh to compute fingerprints per section instead of using only one full-page fingerprint.
- [x] 2.2 Ensure status-only refreshes update progress, operations, and telemetry without replacing unchanged search results, operator log, paths, or diagnostics.
- [x] 2.3 Preserve existing input focus and caret handling for dashboard inputs that remain present after a refresh.
- [x] 2.4 Rebind section-local handlers or add stable event delegation so index, cancel, clear, refresh, search, copy, and diagnostics actions keep working after section updates.

## 3. Tests

- [x] 3.1 Add focused web-dashboard tests for the section render helper and fingerprint behavior.
- [x] 3.2 Add a regression test proving an unchanged selectable section DOM node is preserved across a status-only refresh.
- [x] 3.3 Add a regression test proving a changed selectable section may update while unrelated sections remain stable.
- [x] 3.4 Add a regression test proving busy/disabled control changes do not replace unchanged selectable text containers.

## 4. Verification

- [x] 4.1 Run `pnpm --filter @zilliz/claude-context-web-dashboard test`.
- [x] 4.2 Run `pnpm --filter @zilliz/claude-context-web-dashboard build`.
- [x] 4.3 Run `openspec validate sectional-dashboard-rendering --strict`.
