## Verification

### Commands

- `pnpm --filter @zilliz/claude-context-core test -- context.ignore-patterns.test.ts --runInBand`
  - Result: assertions passed, but the process exited with `free(): invalid pointer` / status 129 during native teardown.
- `pnpm lint`
  - Result: passed with existing warnings.
- `pnpm build`
  - Result: passed.
- `pnpm typecheck`
  - Result: passed after rerunning without a concurrent build cleaning `packages/core/dist`.
- `node scripts/preindex-diagnostic.js /run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd --concurrency 1,8 --repeat 1 --json`
  - Raw JSON saved during this run at `/tmp/profile-preindex-traversal-hotspots-bp-unicom-sdd.json`.

### Large 1C Baseline

Target: `/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd`

Effective config:
- supported extensions: 25
- ignore patterns: 103
- include hashes: true

Concurrency 1:
- totalMs: 73638
- scanMs: 2868
- hashMs: 6412
- fileListMs: 4
- matcherMs: 62133
- selectedFileCount: 18686
- hashedFileCount: 18686
- filesSeen: 93694
- directoryEntriesVisited: 181336
- unsupportedFilesTotal: 208
- ignoredDirectories: 28
- ignoredFiles: 74800
- matcherCalls: 181336
- hashBytes: 1105398487
- selectedPathFingerprint: `300f3a0fa4b5e478b729a21e87b7dfcc1f821097348750f080cc4321978c2689`
- selectedPathHashFingerprint: `084a73158fef4c3371d457bb5c059f5c93a085d28c556522772263c20568ea1e`

Concurrency 8:
- totalMs: 70403
- scanMs: 407349
- hashMs: 91893
- fileListMs: 8
- matcherMs: 61720
- selectedFileCount: 18686
- hashedFileCount: 18686
- filesSeen: 93694
- directoryEntriesVisited: 181336
- unsupportedFilesTotal: 208
- ignoredDirectories: 28
- ignoredFiles: 74800
- matcherCalls: 181336
- hashBytes: 1105398487
- selectedPathFingerprint: `300f3a0fa4b5e478b729a21e87b7dfcc1f821097348750f080cc4321978c2689`
- selectedPathHashFingerprint: `084a73158fef4c3371d457bb5c059f5c93a085d28c556522772263c20568ea1e`

Top unsupported extensions:
- `.ps1`: 99
- `.sh`: 68
- `.json`: 19
- `.epf`: 4
- `<none>`: 3
- `.txt`: 3
- `.mjs`: 3
- `.docx`: 2
- `.cfe`: 2
- `.identifier`: 2

### Findings

- The selected path fingerprint and selected path+hash fingerprint match across concurrency 1 and 8.
- The dominant measured hotspot is ignore matching: about 62 seconds and 181,336 matcher calls.
- Unsupported extension filtering is not the primary measured hotspot in the effective config run: only 208 non-ignored files reached unsupported-extension counting.
- Concurrency 8 still does not materially improve the wall clock relative to concurrency 1, so the next optimization change should focus on matcher/path traversal work rather than file hash parallelism alone.
