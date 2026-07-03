## 1. Rendering Structure

- [ ] 1.1 Introduce a stable dashboard shell with named section containers for metrics, codebases, toolbar, operations, worker telemetry, notices/log, profile diagnostics, search controls, and results.
- [ ] 1.2 Add a small section render helper that stores section fingerprints and replaces only sections whose fingerprint changed.
- [ ] 1.3 Move current root-level markup into section render functions without changing displayed labels, controls, or API calls.

## 2. Refresh Behavior

- [ ] 2.1 Change periodic refresh to compute fingerprints per section instead of using only one full-page fingerprint.
- [ ] 2.2 Ensure status-only refreshes update progress, operations, and telemetry without replacing unchanged search results, operator log, paths, or diagnostics.
- [ ] 2.3 Preserve existing input focus and caret handling for dashboard inputs that remain present after a refresh.
- [ ] 2.4 Rebind section-local handlers or add stable event delegation so index, cancel, clear, refresh, search, copy, and diagnostics actions keep working after section updates.

## 3. Tests

- [ ] 3.1 Add focused web-dashboard tests for the section render helper and fingerprint behavior.
- [ ] 3.2 Add a regression test proving an unchanged selectable section DOM node is preserved across a status-only refresh.
- [ ] 3.3 Add a regression test proving a changed selectable section may update while unrelated sections remain stable.

## 4. Verification

- [ ] 4.1 Run `pnpm --filter @zilliz/claude-context-web-dashboard test`.
- [ ] 4.2 Run `pnpm --filter @zilliz/claude-context-web-dashboard build`.
- [ ] 4.3 Run `openspec validate sectional-dashboard-rendering --strict`.
