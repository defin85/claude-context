## Context

`claude-context` currently indexes files by traversing the codebase, splitting files into `CodeChunk` records, embedding chunk content, and storing `VectorDocument` payloads that include `relativePath`, `startLine`, `endLine`, `fileExtension`, and general chunk metadata. The BGE-M3 full mode stores model dense, sparse, and ColBERT vectors; this change does not alter the embedding model or vector schema.

For 1C/BSL codebases, `rlm-tools-bsl` already owns BSL-specific structure: exported configuration path parsing, method declarations, line ranges, object names, object synonyms, file paths, metadata references, and index status. The existing `RlmToolsBslSubprocessProvider` consumes RLM at search time, but the local service is not currently configured to use it, and even when configured it adds subprocess latency and runtime coupling to every search.

Index-time enrichment moves the useful bounded subset of RLM structure into the `claude-context` index itself. Search can then use stored object/module/symbol metadata without invoking RLM for every query, while direct RLM tools remain available for deep BSL exploration.

## Goals / Non-Goals

**Goals:**
- Add a generic index enrichment extension point that can enrich chunks before vector insertion.
- Add `rlm-tools-bsl` as the first enrichment provider for 1C/BSL codebases.
- Load a structured RLM snapshot once per indexing job, verify its status and source root, and map it to `claude-context` relative paths.
- Store a compact, bounded BSL metadata envelope on each matching chunk.
- Record collection-level enrichment status so searches, diagnostics, and evaluation reports can distinguish enriched and unenriched indexes.
- Use stored enrichment metadata as the primary 1C structural ranking signal when present.
- Keep existing search-time RLM provider behavior available as a fallback for old indexes or exploratory configurations.

**Non-Goals:**
- Do not make `search_code` build, update, or drop RLM indexes.
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

Rationale:
- Enrichment belongs near chunk preparation because that is where both codebase-relative paths and chunk line ranges are available.
- A generic interface avoids hard-coding RLM into the core indexing loop and leaves room for future language-neutral enrichers.

Alternative considered: call RLM from the splitter. Rejected because splitters should produce chunks from source text and not own external index lifecycle, status checks, or cross-file metadata snapshots.

### Decision: Use a structured RLM snapshot, not per-chunk queries

The RLM integration SHOULD load one bounded structured snapshot per indexing job. The preferred transport is a JSON command or endpoint that exports file/object/symbol metadata for the codebase:

```bash
rlm-bsl-index provider export --path {codebasePath} --json
```

The implementation may use another machine-readable transport if it returns the same normalized schema. The snapshot MUST be query-only from the `claude-context` perspective and MUST NOT trigger RLM build, update, or drop operations.

Rationale:
- One snapshot avoids subprocess overhead per chunk and makes indexing behavior deterministic.
- A snapshot can include provider status, source root, build metadata, capabilities, and diagnostics once.
- Per-query RLM lookup remains useful as fallback, but it is not the target indexing architecture.

Alternative considered: keep only the existing search-time provider. Rejected as the primary path because it does not improve index payloads, adds search latency, and cannot be used by vector database filters or payload-aware ranking without runtime RLM availability.

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
- store only symbols whose line ranges overlap the chunk or the nearest containing declaration when available;
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

Rationale:
- Existing collections remain searchable, but search needs to know whether stored RLM fields are expected.
- Evaluation reports can compare enriched and unenriched runs without guessing from individual result metadata.
- Required-mode indexing can fail fast if enrichment is unavailable, while optional mode can index with diagnostics.

### Decision: Use stored enrichment before search-time RLM candidates

For enriched indexes, ranking SHOULD use stored `metadata.bsl` fields before invoking or considering the search-time `rlm-tools-bsl` provider. The search-time provider remains a fallback for indexes without enrichment metadata or for explicitly configured experimental runs.

Rationale:
- Stored metadata is local to the vector payload, has no subprocess latency, and is tied to the exact indexed chunk.
- Search-time providers can drift from the indexed collection if RLM is updated after `claude-context` indexing.

### Decision: Enrichment mode is explicit

Configuration SHOULD support:
- `off`: never use RLM enrichment;
- `optional`: attempt enrichment, record unavailable/stale/error status, and continue indexing;
- `required`: fail indexing when RLM enrichment is missing, stale, unsupported, or invalid.

The default SHOULD be `optional` only when a command/transport is configured; otherwise behavior remains effectively `off`.

Rationale:
- Local development and generic repositories should not fail because RLM is absent.
- Acceptance runs for large 1C matrices need a fail-closed option to prove enriched indexing was actually used.

## Risks / Trade-offs

- [Risk] RLM snapshot can be stale relative to the source tree. -> Mitigation: require provider status/fingerprint diagnostics, record source build metadata, and support `required` mode for acceptance.
- [Risk] Payload size grows and slows inserts. -> Mitigation: bound symbol and synonym counts, store only overlapping declarations, and measure indexing throughput on BP/DO/UNF/UT/ZUP examples.
- [Risk] Path roots differ between RLM and `claude-context`. -> Mitigation: reuse and extend provider root translation tests for equal-root and nested-root cases.
- [Risk] Ranking can over-trust wrong structural metadata. -> Mitigation: use enrichment as bounded ranking evidence, preserve semantic retrieval, and expose diagnostics.
- [Risk] Direct RLM search may look better than integrated search for exact structural queries. -> Mitigation: keep direct RLM tools for inspection, while `search_code` optimizes mixed semantic plus structural navigation.
- [Risk] Enrichment schema changes can break old indexes. -> Mitigation: version `bsl.enrichmentSchemaVersion` and collection-level compatibility metadata; old indexes keep fallback ranking.

## Migration Plan

1. Add typed enrichment schema and pure path/line mapping helpers with fixture tests.
2. Add an optional RLM snapshot loader behind environment/configuration flags.
3. Enrich chunk metadata before `VectorDocument` creation and store collection compatibility metadata.
4. Update ranking to read stored `metadata.bsl` fields and report enrichment diagnostics.
5. Add MCP/index status reporting for enrichment mode and outcome.
6. Validate on small fixtures first, then on `examples/demo-1c` and `examples/demo-bp30-1c`.
7. Keep rollout optional until live 1C evaluation proves no regression versus current Qdrant BGE-M3 full behavior.

Rollback is disabling enrichment mode and reindexing without the RLM metadata. Existing enriched collections remain searchable because the added metadata is optional payload data.

## Open Questions

- Does the installed `rlm-tools-bsl` already expose a full snapshot/export JSON command, or do we need to add it to the RLM project first?
- Which freshness proof should be authoritative: git commit, file hashes, RLM build timestamp plus file counts, or a provider-level source fingerprint?
- Should stored `symbols` include only declarations overlapping the chunk, or also the nearest enclosing declaration for chunks inside long methods?
- Which RLM metadata categories beyond methods/objects/files should be included in v1: object synonyms, subsystem membership, form names, commands, or metadata references?
