## Context

Claude Context currently exposes low-level retrieval controls:

- `EMBEDDING_PROVIDER` selects providers such as OpenAI, Ollama, or BGE-M3.
- `HYBRID_MODE` controls dense+BM25 sparse hybrid retrieval for non-BGE paths.
- `BGE_M3_MODE=dense|full` selects dense-only BGE-M3 or full BGE-M3.
- `BGE_M3_STORE_COLBERT=true` is required for full BGE-M3 reranking.

That is powerful but not operator-friendly. A user trying to index a large codebase has to understand the storage and latency implications of dense vectors, BM25 sparse vectors, model sparse weights, and ColBERT token vectors. The recent full-index benchmark showed that the scheduler and worker pool can saturate the pipeline, but full BGE-M3 multivector storage still makes each chunk materially more expensive.

The change introduces a high-level retrieval profile that makes the speed/quality tradeoff explicit while keeping the existing low-level modes available for compatibility.

## Goals / Non-Goals

**Goals:**

- Provide a simple `fast`, `balanced`, `quality` profile model.
- Make `fast` suitable for large initial indexes where throughput matters.
- Preserve full BGE-M3 dense+sparse+ColBERT as an explicit `quality` choice.
- Persist profile choice per codebase so search uses the right retrieval shape even if defaults change later.
- Prevent accidental search/index mismatch across incompatible schemas.
- Document storage, latency, and migration implications.

**Non-Goals:**

- Remove or deprecate full BGE-M3 retrieval.
- Automatically migrate existing collections between retrieval shapes.
- Implement mixed profiles inside one codebase by file extension or directory.
- Add a new vector database backend.
- Change ranking semantics for already-indexed collections without explicit reindex.

## Decisions

### Decision: Add `RETRIEVAL_PROFILE=fast|balanced|quality`

Introduce a high-level profile setting parsed in `packages/mcp/src/config.ts` and propagated into core indexing/session config.

Proposed default: `balanced`.

Rationale: `balanced` preserves the current broad expectation of lexical+dense search where available, while avoiding making full BGE-M3 multivector the implicit default for every large codebase. Operators who want maximum BGE-M3 quality can choose `quality`; operators who want first-index speed can choose `fast`.

Alternative considered: make `fast` the default. This maximizes performance but risks surprising users who expect hybrid retrieval quality from existing defaults.

Alternative considered: keep only `BGE_M3_MODE=dense|full`. That is too provider-specific and does not solve the operator problem for non-BGE providers or future retrieval modes.

### Decision: Map profiles to provider-specific retrieval shapes

Profile mapping should be centralized in a small resolver module, for example `retrieval-profile.ts`, so config parsing, indexing, status, and tests share one source of truth.

Initial mapping:

| Profile | BGE-M3 provider | Non-BGE provider |
| --- | --- | --- |
| `fast` | BGE-M3 dense-only, no sparse/ColBERT storage | dense-only search, `HYBRID_MODE=false` equivalent |
| `balanced` | BGE-M3 dense-only initially, with optional future sparse-without-ColBERT only if supported by current schema | existing dense+BM25 sparse hybrid when hybrid mode is enabled |
| `quality` | full BGE-M3 dense+sparse+ColBERT with ColBERT reranking | best available existing non-BGE behavior, normally hybrid dense+BM25 sparse |

Rationale: The expensive part of the current BGE-M3 path is storing and inserting ColBERT token vectors. Until there is a dedicated BGE-M3 sparse-without-ColBERT collection/search path, `balanced` should not pretend to be full BGE-M3 minus rerank. It can be implemented conservatively and extended later.

Alternative considered: make `balanced` BGE-M3 dense+sparse without ColBERT immediately. This may be attractive, but it is a distinct retrieval shape and should only be used if the collection schema and search code explicitly support model-generated sparse weights without stored ColBERT.

### Decision: Profile has precedence, low-level settings are validated

When `RETRIEVAL_PROFILE` is set, it becomes the operator intent. Low-level settings such as `BGE_M3_MODE`, `BGE_M3_STORE_COLBERT`, and `HYBRID_MODE` must either match the resolved profile or be rejected with a clear error.

Examples:

- `RETRIEVAL_PROFILE=quality`, `EMBEDDING_PROVIDER=BGE_M3`, `BGE_M3_STORE_COLBERT=false` is invalid.
- `RETRIEVAL_PROFILE=fast`, `EMBEDDING_PROVIDER=BGE_M3`, `BGE_M3_MODE=full` is invalid unless explicitly documented as ignored.
- No profile set preserves current low-level behavior for compatibility, but status should report the inferred profile when possible.

Rationale: Silent normalization is dangerous because it can make users think they indexed quality/full data when the collection is actually dense-only.

Alternative considered: always let low-level settings override the profile. That keeps backward flexibility but weakens the purpose of a high-level profile and makes status harder to trust.

### Decision: Persist `retrievalProfile` next to retrieval mode/schema

Extend `CodebaseSessionConfig` and persisted codebase config with:

- `retrievalProfile`
- `retrievalMode`
- `retrievalSchemaVersion`

Search should prefer persisted retrieval mode/schema for a codebase. The configured current default profile should not reinterpret an existing collection.

Rationale: Profile defaults will evolve. Persisting the effective profile protects old indexes from being searched with the wrong assumptions.

Alternative considered: only persist retrieval mode/schema and infer profile. That is mechanically possible, but less transparent for operators and dashboards.

### Decision: Require explicit force reindex for incompatible profile changes

Before indexing, compare requested effective retrieval configuration with persisted configuration. If storage or search shape differs and `force` is not true, return a clear error. If `force=true`, rebuild under the requested profile and update persisted config after success.

Compatibility examples:

- `fast` BGE-M3 dense-only -> `quality` full BGE-M3 is incompatible.
- `quality` full BGE-M3 -> `fast` dense-only is incompatible.
- Same profile and same schema version is compatible.
- Existing configs without `retrievalProfile` may be accepted by matching `retrievalMode`/schema and then backfilled after successful safe operations.

Rationale: The current system already distinguishes collection prefixes and retrieval schema. Profiles must make that protection visible and deliberate.

### Decision: Expose profile in status and docs

Add profile to:

- `get_indexing_status` structured content.
- daemon/operator status where default retrieval configuration is shown.
- logs at startup and index start.
- environment-variable docs and package README.

Rationale: Users tuning performance need to know whether they are paying dense-only, hybrid, or full multivector cost.

## Risks / Trade-offs

- [Risk] `balanced` means different things for BGE-M3 and non-BGE providers -> Mitigation: document exact mapping and expose resolved retrieval mode/schema in status.
- [Risk] Users expect `balanced` BGE-M3 to include model sparse weights -> Mitigation: keep first version conservative unless sparse-without-ColBERT schema/search support is implemented and tested.
- [Risk] Existing env combinations break when profile is added -> Mitigation: preserve current behavior when `RETRIEVAL_PROFILE` is unset; validate only explicit profile conflicts.
- [Risk] Search uses current default profile instead of persisted collection shape -> Mitigation: add regression tests around persisted config and profile changes.
- [Risk] More config fields increase confusion -> Mitigation: docs should recommend profile-first configuration and mark low-level variables as advanced overrides.
- [Risk] Quality profile remains slow on large initial indexes -> Mitigation: make that cost explicit and recommend `fast` or `balanced` for bulk first-index workflows.

## Migration Plan

1. Add profile type, parser, resolver, and tests.
2. Extend config/status/codebase persisted config with optional `retrievalProfile`.
3. Preserve behavior for existing deployments that do not set `RETRIEVAL_PROFILE`.
4. Add compatibility checks for explicit profile changes.
5. Update docs to recommend profile-first setup.

Rollback is to unset `RETRIEVAL_PROFILE` and continue using existing low-level settings. Existing collections remain compatible because profile metadata is additive and search still uses persisted retrieval mode/schema.

## Open Questions

- Should `balanced` for BGE-M3 remain dense-only in the first version, or should this change include a new sparse-without-ColBERT BGE-M3 collection/search shape?
- Should `index_codebase` accept `retrievalProfile` as a per-call argument in the first version, or should profile selection be daemon/global only?
- Should `fast` also adjust splitter/chunk limits, or should it only control retrieval shape in this change?
