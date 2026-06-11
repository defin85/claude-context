## Finish-to-100 Verification

Review risks closed in this pass:

- `extensionFilter` / `filterExpr` remains part of the public `search_code` contract. Code-symbol lexical and provider candidates now receive the caller filter expression and post-filter mapped rows before fusion, so lexical hits cannot reintroduce files excluded by the caller.
- Qdrant no-reindex lexical queries now translate `content like "%...%"`, `relativePath like "%...%"`, and `fileExtension in [...]` filters into Qdrant payload filters instead of silently scrolling an unfiltered collection.
- `rlm-tools-bsl` subprocess integration now requires structured availability/staleness args before it can report `available`; without them the provider reports `unsupported` and search fails open to semantic plus no-reindex lexical retrieval.
- Environment-variable documentation now includes code-symbol retrieval and `rlm-tools-bsl` provider settings.

Commands run:

```bash
pnpm --filter @zilliz/claude-context-core test -- context.code-symbol-retrieval.test.ts --runInBand
pnpm --filter @zilliz/claude-context-core test -- qdrant-vectordb.test.ts --runInBand
```

Both targeted test suites passed after first failing on the reviewed gaps.

Baseline 1C relevance summaries captured before hybrid-symbol ranking remain in:

- `.artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-milvus.json`
- `.artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-qdrant.json`
- `.artifacts/hybrid-code-symbol-retrieval/demo-1c-baseline-lancedb.json`
