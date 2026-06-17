## 1. Backend Contract Review

- [ ] 1.1 Inspect dashboard daemon/status payloads for active and queued job fields.
- [ ] 1.2 Add dashboard API fields for queue position, workload type, and timing only if missing from existing sanitized status.
- [ ] 1.3 Add API tests for active, queued, and empty workload payloads.

## 2. Frontend Operations View

- [ ] 2.1 Add an indexing operations section to the dashboard layout.
- [ ] 2.2 Render active indexing jobs separately from queued indexing jobs.
- [ ] 2.3 Render selected-codebase progress details when available.
- [ ] 2.4 Render accelerator batch counters without forcing unavailable values to zero.
- [ ] 2.5 Add contextual cancel actions with confirmation text that distinguishes active and queued jobs.

## 3. Polling and UX Stability

- [ ] 3.1 Ensure background polling does not rebuild the page when operations data is unchanged.
- [ ] 3.2 Add empty states for no active work and no queued work.
- [ ] 3.3 Verify controls remain stable while polling updates status.

## 4. Validation

- [ ] 4.1 Run dashboard frontend typecheck and build.
- [ ] 4.2 Run MCP dashboard API tests.
- [ ] 4.3 Smoke-test with one active indexing workload and one queued workload.
- [ ] 4.4 Run `pnpm exec openspec validate add-dashboard-indexing-operations --strict`.
