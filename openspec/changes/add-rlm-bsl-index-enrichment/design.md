## Context

`claude-context` currently indexes files by traversing the codebase, splitting files into `CodeChunk` records, embedding chunk content, and storing `VectorDocument` payloads that include `relativePath`, `startLine`, `endLine`, `fileExtension`, and general chunk metadata. The BGE-M3 full mode stores model dense, sparse, and ColBERT vectors; this change does not alter the embedding model or vector schema.

For 1C/BSL codebases, `rlm-tools-bsl` already owns BSL-specific structure: exported configuration path parsing, method declarations, line ranges, object names, object synonyms, file paths, metadata references, and index status. The existing `RlmToolsBslSubprocessProvider` consumes RLM at search time, but the local service is not currently configured to use it, and even when configured it adds subprocess latency and runtime coupling to every search.

The local `rlm-tools-bsl` worktree currently has a query-only JSON provider shape for `provider query`. That API is useful for the existing search-time adapter, but it is not enough for index-time enrichment because enrichment needs a whole-codebase snapshot grouped by file and line ranges. This change therefore includes an explicit external dependency: add or verify a query-only RLM snapshot/export API before wiring `claude-context` enrichment to live RLM data.

Index-time enrichment moves the useful bounded subset of RLM structure into the `claude-context` index itself. Search can then use stored object/module/symbol metadata without invoking RLM for every query, while direct RLM tools remain available for deep BSL exploration.

## Goals / Non-Goals

**Goals:**
- Add a generic index enrichment extension point that can enrich chunks before vector insertion.
- Add `rlm-tools-bsl` as the first enrichment provider for 1C/BSL codebases.
- Add or verify a whole-codebase RLM snapshot/export JSON API suitable for index-time enrichment.
- Load a structured RLM snapshot once per indexing job, verify its status and source root, and map it to `claude-context` relative paths.
- Store a compact, bounded BSL metadata envelope on each matching chunk.
- Record collection-level enrichment status so searches, diagnostics, and evaluation reports can distinguish enriched and unenriched indexes.
- Use stored enrichment metadata as the primary 1C structural ranking signal when present.
- Keep existing search-time RLM provider behavior available as a fallback for old indexes or exploratory configurations.
- Keep `claude-context` fully usable without `rlm-tools-bsl`.

**Non-Goals:**
- Do not make `search_code` build, update, or drop RLM indexes.
- Do not use the per-query RLM provider API as a substitute for a whole-codebase enrichment snapshot.
- Do not import the full RLM database or duplicate RLM parsing/indexing logic in TypeScript.
- Do not store unbounded call graphs, full object rows, or full symbol lists in every vector payload.
- Do not change BGE-M3 dense-only or BGE-M3 full embedding semantics.
- Do not require `rlm-tools-bsl` for non-BSL repositories.
- Do not replace direct RLM tools for source-code inspection tasks where structural BSL lookup is the user’s explicit goal.

## Decisions

### Decision: Add an index enrichment extension point

`packages/core` SHOULD define a small index-time extension point, for example `CodebaseIndexEnricher`, that is invoked during `indexCodebase` after traversal/splitting establishes chunk paths and line ranges but before `VectorDocument` insertion.

The interface should support:
- availability/status check for the requested codebase root;
- snapshot loading or precomputed lookup construction once per indexing job;
- per-chunk enrichment by normalized `relativePath` plus `startLine`/`endLine`;
- compact job diagnostics for indexing status and collection metadata.

In `required` mode, availability and snapshot validation MUST happen before dropping or creating vector collections. This prevents a forced reindex from deleting a previously usable collection and then failing because RLM enrichment is unavailable.

Rationale:
- Enrichment belongs near chunk preparation because that is where both codebase-relative paths and chunk line ranges are available.
- A generic interface avoids hard-coding RLM into the core indexing loop and leaves room for future language-neutral enrichers.

Alternative considered: call RLM from the splitter. Rejected because splitters should produce chunks from source text and not own external index lifecycle, status checks, or cross-file metadata snapshots.

### Decision: Use a structured RLM snapshot, not per-chunk queries

The RLM integration SHOULD load one bounded structured snapshot per indexing job. The preferred transport is a JSON command or endpoint that exports file/object/symbol metadata for the codebase:

```bash
rlm-bsl-index provider export {codebasePath} --json
```

The v1 CLI contract SHALL use the positional form `provider export <path> --json`, matching the existing `provider query <path> <query> --json` command family. `claude-context` MAY still configure the argv through JSON templates, but it SHALL document the positional CLI as the compatibility target rather than requiring a named `--path` form.

The implementation may use another machine-readable transport if it returns the same normalized schema. The snapshot MUST be query-only from the `claude-context` perspective and MUST NOT trigger RLM build, update, or drop operations.

The existing per-query transport, for example `rlm-bsl-index provider query <path> <query> --json`, SHALL NOT be treated as sufficient for index enrichment. It can prove provider JSON mechanics and can remain a search-time fallback, but it does not expose a complete file-to-symbol map.

Rationale:
- One snapshot avoids subprocess overhead per chunk and makes indexing behavior deterministic.
- A snapshot can include provider status, source root, build metadata, capabilities, and diagnostics once.
- Per-query RLM lookup remains useful as fallback, but it is not the target indexing architecture.

Alternative considered: keep only the existing search-time provider. Rejected as the primary path because it does not improve index payloads, adds search latency, and cannot be used by vector database filters or payload-aware ranking without runtime RLM availability.

### Decision: Add the snapshot/export API to RLM rather than reading RLM SQLite directly

If the installed `rlm-tools-bsl` does not already expose a whole-codebase JSON export, the first implementation step SHOULD add one to `rlm-tools-bsl`. `claude-context` should consume a stable JSON contract instead of opening `bsl_index.db` directly.

The RLM export response SHOULD include:
- `schemaVersion`, `provider`, `status`, `sourceRoot`, `capabilities`, and diagnostics;
- source freshness fields including an authoritative provider-level `sourceFingerprint`, plus build time, git commit, dirty-state diagnostics, file counts, and raw RLM status values when available;
- `files[]`, each with `relativePath`, object name/kind, module kind/name, form or command name when path-derived or indexed, bounded object synonyms, and `symbols[]`;
- `symbols[]` with name, declaration kind, export flag, parameters when available, and start/end line.

The v1 authoritative freshness proof SHALL be a provider-level `sourceFingerprint` generated by RLM from the canonical source root and the indexed source set, including at minimum the indexed BSL file count and the RLM source-set/hash data already used for freshness checks. Build time, git commit, dirty-state, and raw RLM index status remain diagnostics and audit evidence, but required-mode branching in `claude-context` SHOULD treat `status` plus `sourceFingerprint` as the stable compatibility proof.

The v1 metadata scope SHALL include only file/object/module context, object synonyms, form or command names when cheaply available, and method/procedure/function declarations with line ranges. It SHALL defer subsystem membership, metadata references, form element trees, role rights, call graph rows, and other large or high-churn RLM structures.

`claude-context` SHOULD normalize RLM provider status values into its own stable status vocabulary while preserving the raw RLM status in diagnostics. For example, an RLM `missing_index` response should map to the `missing` enrichment status rather than leaking a provider-specific status into core required-mode branching.

Rationale:
- RLM owns its SQLite schema and can evolve it without forcing `claude-context` schema knowledge.
- A JSON export can reuse existing RLM status checks, path resolution, and query-only guardrails.
- The same export contract can later be served by CLI, MCP, or daemon transport.

Alternative considered: read `bsl_index.db` directly from `claude-context`. Rejected for v1 because it couples TypeScript indexing to RLM internal table names and migration behavior.

### Decision: Store a compact BSL enrichment envelope

Each enriched chunk SHOULD receive a compact metadata envelope under a stable key such as `metadata.bsl`:

```ts
{
    provider: 'rlm-tools-bsl',
    providerSchemaVersion: 1,
    enrichmentSchemaVersion: 1,
    sourceRoot: '/absolute/source/root',
    indexBuiltAt: '2026-06-18T...',
    metadataObjectName: 'ЭлектронныйДокументВходящийЭДО',
    metadataObjectKind: 'Document',
    moduleKind: 'form',
    moduleName: 'ФормаПросмотра',
    symbols: [
        {
            name: 'ПроверитьПодписи',
            kind: 'procedure',
            export: false,
            startLine: 120,
            endLine: 180,
            overlap: 'intersects'
        }
    ],
    synonyms: ['Электронный документ входящий ЭДО']
}
```

The stored envelope MUST be bounded:
- cap symbols per chunk;
- store only declarations whose line ranges overlap or contain the chunk; do not attach the nearest preceding or same-file declaration when the chunk is outside its line range;
- cap synonyms and textual names;
- omit large call graph, role rights, form element trees, or raw RLM rows.

Rationale:
- Ranking needs object/module/symbol signals, not the full RLM database.
- Qdrant/Milvus/LanceDB payloads must remain small enough for indexing throughput and query projection.

### Decision: Collection metadata records enrichment compatibility

The indexer SHOULD record collection-level enrichment metadata in the existing collection description/metadata mechanism:
- `bslEnrichmentProvider`;
- `bslEnrichmentSchemaVersion`;
- `bslEnrichmentStatus`;
- `bslEnrichmentSourceRoot`;
- `bslEnrichmentSourceBuiltAt`;
- `bslEnrichmentSnapshotHash` or equivalent fingerprint when available.

Search-time code MUST be able to read the stored compatibility metadata before deciding whether to call a search-time RLM provider. If a vector backend cannot read mutable collection metadata reliably, the implementation SHOULD store the enrichment compatibility fields in the collection description created before insertion and add adapter tests for that backend.

Rationale:
- Existing collections remain searchable, but search needs to know whether stored RLM fields are expected.
- Evaluation reports can compare enriched and unenriched runs without guessing from individual result metadata.
- Required-mode indexing can fail fast if enrichment is unavailable, while optional mode can index with diagnostics.

### Decision: Use stored enrichment before search-time RLM candidates

For enriched indexes, ranking SHOULD use stored `metadata.bsl` fields before invoking or considering the search-time `rlm-tools-bsl` provider. The search-time provider remains a fallback for indexes without enrichment metadata or for explicitly configured experimental runs.

The provider decision SHOULD be made at collection scope, not per individual result. A compatible enriched collection should skip the default search-time RLM provider unless an explicit experimental override is configured; otherwise searches can pay subprocess latency and mix two structural truth sources even when stored enrichment is present.

Rationale:
- Stored metadata is local to the vector payload, has no subprocess latency, and is tied to the exact indexed chunk.
- Search-time providers can drift from the indexed collection if RLM is updated after `claude-context` indexing.

### Decision: Enrichment mode is explicit

Configuration SHOULD support:
- `off`: never use RLM enrichment and do not require `rlm-tools-bsl` to be installed;
- `optional`: attempt enrichment, record unavailable/stale/error status, and continue indexing;
- `required`: fail indexing when RLM enrichment is missing, stale, unsupported, or invalid.

The default SHOULD be `optional` only when a command/transport is configured; otherwise behavior remains effectively `off`.

Rationale:
- Local development and generic repositories should not fail because RLM is absent.
- Acceptance runs for large 1C matrices need a fail-closed option to prove enriched indexing was actually used.

### Decision: No-RLM mode remains a first-class path

`claude-context` SHALL keep a supported mode where no RLM command, project, index, or Python package is available. In this mode:
- indexing proceeds with existing splitters, embeddings, vector writes, and 1C indexing scope profiles;
- search uses BGE-M3 semantic retrieval, stored `relativePath` and `content`, no-reindex lexical fallback, and existing path-derived 1C ranking signals;
- status and diagnostics report enrichment as disabled or unavailable without treating that as an error.

Incremental reindexing and background synchronization must preserve the same contract as full indexing. For enriched collections, changed chunks SHOULD be enriched from a fresh compatible snapshot for that incremental run; in `required` mode the update MUST fail before deleting or inserting changed chunks if the enrichment snapshot is unavailable or invalid. Optional mode may continue without enrichment only if the collection-level status is updated so diagnostics do not present the collection as fully enriched.

Rationale:
- `claude-context` is a general code search tool, not a hard dependency wrapper around RLM.
- CI and non-1C users must not need local 1C/RLM tooling.
- This provides a stable fallback if RLM snapshot export is unavailable or too stale for a run.

## Risks / Trade-offs

- [Risk] RLM snapshot can be stale relative to the source tree. -> Mitigation: require provider status/fingerprint diagnostics, record source build metadata, and support `required` mode for acceptance.
- [Risk] Payload size grows and slows inserts. -> Mitigation: bound symbol and synonym counts, store only overlapping declarations, and measure indexing throughput on BP/DO/UNF/UT/ZUP examples.
- [Risk] Path roots differ between RLM and `claude-context`. -> Mitigation: reuse and extend provider root translation tests for equal-root and nested-root cases.
- [Risk] Ranking can over-trust wrong structural metadata. -> Mitigation: use enrichment as bounded ranking evidence, preserve semantic retrieval, and expose diagnostics.
- [Risk] Direct RLM search may look better than integrated search for exact structural queries. -> Mitigation: keep direct RLM tools for inspection, while `search_code` optimizes mixed semantic plus structural navigation.
- [Risk] Enrichment schema changes can break old indexes. -> Mitigation: version `bsl.enrichmentSchemaVersion` and collection-level compatibility metadata; old indexes keep fallback ranking.
- [Risk] Implementing RLM export and `claude-context` enrichment in one pass can blur ownership boundaries. -> Mitigation: keep RLM export as a documented JSON contract and test `claude-context` against fixtures before requiring a live RLM runtime.
- [Risk] No-RLM mode could silently be lower quality while appearing equivalent. -> Mitigation: diagnostics and evaluation reports must state enrichment status explicitly.

## Migration Plan

1. Add or verify the RLM `provider export` snapshot API and its tests in `rlm-tools-bsl`.
2. Add typed enrichment schema and pure path/line mapping helpers in `claude-context` with fixture tests.
3. Add an optional RLM snapshot loader behind environment/configuration flags.
4. Enrich chunk metadata before `VectorDocument` creation and store collection compatibility metadata.
5. Update ranking to read stored `metadata.bsl` fields and report enrichment diagnostics.
6. Add MCP/index status reporting for enrichment mode and outcome.
7. Validate no-RLM mode, optional mode, and required mode on small fixtures.
8. Validate live RLM enrichment on `examples/demo-1c` and `examples/demo-bp30-1c`.
9. Keep rollout optional until live 1C evaluation proves no regression versus current Qdrant BGE-M3 full behavior.

Rollback is disabling enrichment mode and reindexing without the RLM metadata. Existing enriched collections remain searchable because the added metadata is optional payload data.

## Closed Questions

- RLM export command shape: v1 standardizes on `rlm-bsl-index provider export <path> --json`. A named `--path` alias is optional RLM ergonomics, not a `claude-context` compatibility requirement.
- Freshness proof: v1 uses a provider-level `sourceFingerprint` plus normalized provider status as the authoritative compatibility proof. Build time, git commit, dirty-state, file counts, and raw RLM statuses are retained as diagnostics.
- Stored symbols: v1 stores only declarations whose line ranges overlap or contain the chunk. Same-file non-overlapping declarations remain file-level context only when separately represented, not symbol matches.
- Metadata scope: v1 includes object/module/file context, object synonyms, form or command names when available, and method/procedure/function declarations. Subsystems, metadata references, form element trees, role rights, and call graph data are deferred.
