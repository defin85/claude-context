# Environment Variables Configuration

## 🎯 Global Configuration

Claude Context supports a global configuration file at `~/.context/.env` to simplify MCP setup across different MCP clients.

**Benefits:**
- Configure once, use everywhere
- No need to specify environment variables in each MCP client
- Cleaner MCP configurations

## 📋 Environment Variable Priority

1. **Process Environment Variables** (highest)
2. **Global Configuration File** (`~/.context/.env`)
3. **Default Values** (lowest)

## 🔧 Required Environment Variables

### Embedding Provider
| Variable | Description | Default |
|----------|-------------|---------|
| `EMBEDDING_PROVIDER` | Provider: `OpenAI`, `VoyageAI`, `Gemini`, `Ollama`, `BGE_M3` | `OpenAI` |
| `EMBEDDING_MODEL` | Embedding model name (works for all providers) | Provider-specific default |
| `OPENAI_API_KEY` | OpenAI API key | Required for OpenAI |
| `OPENAI_BASE_URL` | OpenAI API base URL (optional, for custom endpoints) | `https://api.openai.com/v1` |
| `VOYAGEAI_API_KEY` | VoyageAI API key | Required for VoyageAI |
| `GEMINI_API_KEY` | Gemini API key | Required for Gemini |
| `GEMINI_BASE_URL` | Gemini API base URL (optional, for custom endpoints) | `https://generativelanguage.googleapis.com/v1beta` |

> **💡 Note:** `EMBEDDING_MODEL` is a universal environment variable that works with all embedding providers. Simply set it to the model name you want to use (e.g., `text-embedding-3-large` for OpenAI, `voyage-code-3` for VoyageAI, etc.).

> **Supported Model Names:**
> 
> - OpenAI Models: See `getSupportedModels` in [`openai-embedding.ts`](https://github.com/zilliztech/claude-context/blob/master/packages/core/src/embedding/openai-embedding.ts) for the full list of supported models.
> 
> - VoyageAI Models: See `getSupportedModels` in [`voyageai-embedding.ts`](https://github.com/zilliztech/claude-context/blob/master/packages/core/src/embedding/voyageai-embedding.ts) for the full list of supported models.
> 
> - Gemini Models: See `getSupportedModels` in [`gemini-embedding.ts`](https://github.com/zilliztech/claude-context/blob/master/packages/core/src/embedding/gemini-embedding.ts) for the full list of supported models.
> 
> - Ollama Models: Depends on the model you install locally.

> **📖 For detailed provider-specific configuration examples and setup instructions, see the [MCP Configuration Guide](../../packages/mcp/README.md#embedding-provider-configuration).**

### Vector Database
| Variable | Description | Default |
|----------|-------------|---------|
| `VECTOR_DATABASE_BACKEND` | Vector database backend: `milvus`, `lancedb`, or `qdrant` | `qdrant` |
| `LANCEDB_URI` | Local LanceDB directory when `VECTOR_DATABASE_BACKEND=lancedb` | `~/.context/lancedb` |
| `QDRANT_URL` | Qdrant endpoint when `VECTOR_DATABASE_BACKEND=qdrant` | `http://127.0.0.1:6333` |
| `QDRANT_API_KEY` | Optional Qdrant API key | None |
| `MILVUS_TOKEN` | Milvus authentication token. Get [Zilliz Personal API Key](https://github.com/zilliztech/claude-context/blob/master/assets/signup_and_get_apikey.png) | Recommended |
| `MILVUS_ADDRESS` | Milvus server address. Optional when using Zilliz Personal API Key | Auto-resolved from token |

### Ollama (Optional)
| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_HOST` | Ollama server URL | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL`(alternative to `EMBEDDING_MODEL`) | Model name |  |

### BGE-M3 (Optional, Local/Self-hosted)
| Variable | Description | Default |
|----------|-------------|---------|
| `BGE_M3_ENDPOINT` | Local BGE-M3 sidecar endpoint. Required when `EMBEDDING_PROVIDER=BGE_M3` | None |
| `BGE_M3_MODEL` | BGE-M3 model name | `BAAI/bge-m3` |
| `BGE_M3_MODE` | `full` for dense+sparse+ColBERT retrieval, or `dense` for dense-only mode | `full` |
| `BGE_M3_CANDIDATE_LIMIT` | First-stage dense+sparse candidates sent to ColBERT reranking | `100` |
| `BGE_M3_RERANK_LIMIT` | Max results retained after ColBERT reranking | Search limit |
| `BGE_M3_STORE_COLBERT` | Store ColBERT token vectors for full mode. `full` mode requires this to remain `true`. | `true` |
| `BGE_M3_COLBERT_TOKEN_LIMIT` | Max ColBERT token vectors stored per chunk to keep Milvus rows under payload limits | `4` |
| `BGE_M3_COLBERT_DECIMAL_PLACES` | Decimal places retained for stored ColBERT vectors | `6` |

`BGE_M3_MODE=full` requires the sidecar to return dense vectors, model-generated sparse lexical weights, and ColBERT token vectors from `POST /embed` and `POST /embed_batch`. It also requires `BGE_M3_STORE_COLBERT=true` because search reranking depends on stored document token vectors. Existing dense-only and BM25-hybrid indexes cannot be reused for BGE-M3 full retrieval; reindex with `force=true`.

The repository includes a local Python sidecar at `python/bge_m3_sidecar.py`.
Use Python 3.10-3.12, install `python/requirements-bge-m3-sidecar.txt`, and run
`python bge_m3_sidecar.py --device cuda --mode full` to use a local NVIDIA GPU.
ColBERT vectors can be large; the default storage cap keeps local Milvus payloads
small enough for typical code chunks.

Full BGE-M3 indexes use more local Milvus disk than dense-only indexes because
they store dense vectors, model-generated sparse weights, and ColBERT token
vectors. On local Milvus, inspect usage with:

```bash
pnpm milvus:storage-audit -- --json
```

If local Milvus was installed under a non-default path, set
`MILVUS_LOCAL_VOLUME_PATH` or pass `--local-volume-path <path>`. The audit reports
aggregate filesystem estimates for `wp`, `insert_log`, and `index_files`; those
paths are Milvus/MinIO implementation details and are not safe cleanup targets.


### Advanced Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `HYBRID_MODE` | Enable hybrid search (BM25 + dense vector). Set to `false` for dense-only search | `true` |
| `EMBEDDING_BATCH_SIZE` | Legacy embedding batch size. Used only when `INDEX_EMBEDDING_BATCH_SIZE` is unset | `100` |
| `INDEX_EMBEDDING_BATCH_SIZE` | Chunks grouped per embedding request. Values above `10000` are clamped by the core indexer | `EMBEDDING_BATCH_SIZE` or `100` |
| `INDEX_INSERT_BATCH_SIZE` | Embedded documents grouped per vector database insert request. Defaults to the effective embedding batch size to preserve existing write behavior | `INDEX_EMBEDDING_BATCH_SIZE` |
| `INDEX_EMBEDDING_MAX_CONTENT_CHARS` | Optional payload-safe cap on total chunk content characters per embedding request. `auto`/unset leaves dense-only providers unchanged; BGE-M3 full applies its conservative effective default. | `auto` |
| `INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS` | Optional payload-safe cap on estimated tokens per embedding request. `auto`/unset leaves dense-only providers unchanged; BGE-M3 full applies its conservative effective default. | `auto` |
| `CODE_CHUNK_LIMIT` | Maximum number of code chunks to index per codebase. Increase for very large repositories when you accept extra indexing time and vector database storage. If a previous run stopped at a lower limit, run a force reindex after raising this value to include chunks that were skipped before. | `450000` |
| `1C_INDEX_SCOPE_PROFILE` | Scope profile for exported 1C configuration trees: `full`, `developer`, or `minimal`. Reduced profiles must be selected explicitly and require `force=true` when changing an existing index profile. | `full` |
| `CODE_SYMBOL_RETRIEVAL` | Enable code-symbol lexical/provider fusion during search. Set to `false` to return to semantic-only ranking. | `true` |
| `CODE_SYMBOL_MAX_LEXICAL_CANDIDATES` | Max no-reindex lexical candidates fetched from stored `content` and `relativePath` fields. | `max(50, topK * 10)` |
| `CODE_SYMBOL_MAX_PROVIDER_CANDIDATES` | Max candidates requested from configured code-symbol providers. | `max(20, topK * 5)` |
| `CODE_SYMBOL_PROVIDER_TIMEOUT_MS` | Timeout for code-symbol provider availability and query calls. | `750` |
| `RLM_TOOLS_BSL_COMMAND` | Optional subprocess command for the `rlm-tools-bsl` JSON provider. The provider remains disabled unless structured availability args are also configured. | None |
| `RLM_TOOLS_BSL_ARGS_JSON` | JSON argv template for provider search. Supports `{codebasePath}`, `{query}`, and `{limit}` placeholders; argv arrays are used without shell interpolation. | `["symbol-search","--json","--path","{codebasePath}","--query","{query}","--limit","{limit}"]` |
| `RLM_TOOLS_BSL_AVAILABILITY_ARGS_JSON` | JSON argv template that returns structured provider status such as `available`, `stale`, `missing`, or `busy`. Required before `rlm-tools-bsl` candidates are used. | None |
| `RLM_TOOLS_BSL_ROOT` | Optional source root used to translate provider absolute paths into indexed relative paths. | None |
| `SPLITTER_TYPE` | Code splitter type: `ast`, `langchain` | `ast` |
| `CUSTOM_EXTENSIONS` | Additional file extensions to include (comma-separated, e.g., `.vue,.svelte,.astro`) | None |
| `CUSTOM_IGNORE_PATTERNS` | Additional ignore patterns (comma-separated, e.g., `temp/**,*.backup,private/**`) | None |

### 1C Exported Configuration Scope Profiles

`1C_INDEX_SCOPE_PROFILE` only affects recognized exported 1C configuration
trees. Non-1C repositories keep existing traversal behavior when the profile is
left at `full`.

| Profile | Coverage | Use case |
|---------|----------|----------|
| `full` | Preserve existing include/exclude behavior for all supported files. | Complete indexing and compatibility with existing users. |
| `developer` | Include BSL modules and developer-relevant metadata such as `Configuration.xml`; exclude documented generated or low-value export files. | Faster 1C code search with visible reduced-coverage warning. |
| `minimal` | Include only high-value BSL module artifacts such as common, object, manager, form, and command modules. | Fastest scoped code search when metadata search is not needed. |

MCP `index_codebase` also accepts `oneCIndexScopeProfile` for a per-call
override. Search and indexing status expose `oneCIndexScopeProfile`,
`oneCIndexScope`, and `reducedCoverageWarning` for reduced indexes so users can
distinguish scoped results from full coverage.

### Accelerated Indexing Backpressure

These options apply to accelerated indexing when `INDEX_ACCELERATOR_MODE=auto`.
Adaptive backpressure changes effective batch admission only; configured hard
maximums stay visible in status and remain the upper bound.

| Variable | Description | Default |
|----------|-------------|---------|
| `INDEX_ACCELERATOR_MODE` | Accelerator mode: `off` or `auto` | `off` |
| `INDEX_EMBEDDING_BATCH_SIZE` | Chunks submitted per embedding batch. Defaults preserve the legacy `EMBEDDING_BATCH_SIZE` behavior | `EMBEDDING_BATCH_SIZE` or `100` |
| `INDEX_INSERT_BATCH_SIZE` | Chunks submitted per vector insert batch. Lower values split embedded batches before writing while preserving document IDs and metadata | `INDEX_EMBEDDING_BATCH_SIZE` |
| `INDEX_EMBEDDING_MAX_CONTENT_CHARS` | Optional payload-safe cap on embedding request content characters. Explicit values apply to all retrieval modes. When unset, BGE-M3 full uses `1000000`; dense-only modes are not reduced. | `auto` |
| `INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS` | Optional payload-safe cap on embedding request estimated tokens. Explicit values apply to all retrieval modes. When unset, BGE-M3 full uses `250000`; dense-only modes are not reduced. | `auto` |
| `INDEX_EMBEDDING_CONCURRENCY` | Configured maximum in-flight embedding batches | `2` in auto, else `1` |
| `INDEX_INSERT_CONCURRENCY` | Configured maximum in-flight vector insert batches | `1` |
| `INDEX_INSERT_QUEUE_CAPACITY` | Maximum insert backlog waiting for insert lanes | `2` |
| `INDEX_ADAPTIVE_BACKPRESSURE` | Enable adaptive effective concurrency and producer admission throttling | `true` in auto |
| `INDEX_ADAPTIVE_MIN_EMBEDDING_CONCURRENCY` | Lowest effective embedding concurrency while throttled | `1` |
| `INDEX_ADAPTIVE_HIGH_PRESSURE_THRESHOLD` | Pressure score that decreases effective concurrency | `1` |
| `INDEX_ADAPTIVE_LOW_PRESSURE_THRESHOLD` | Pressure score considered healthy for recovery | `0.5` |
| `INDEX_ADAPTIVE_HEALTHY_SAMPLE_COUNT` | Healthy samples required before increasing concurrency | `3` |
| `INDEX_ADAPTIVE_COOLDOWN_MS` | Minimum recovery cooldown after throttling | `5000` |
| `INDEX_ADAPTIVE_INSERT_BACKLOG_THRESHOLD` | Insert backlog threshold for downstream pressure | `2` |
| `INDEX_ADAPTIVE_INSERT_BACKLOG_MIN_BATCHES` | Minimum submitted batches before insert-backlog pressure applies | `30` |
| `INDEX_ADAPTIVE_INSERT_LATENCY_MS_THRESHOLD` | Average insert latency threshold in milliseconds | `30000` |
| `INDEX_ADAPTIVE_RETRY_RATE_THRESHOLD` | Retried-batch ratio threshold | `0.5` |
| `INDEX_ADAPTIVE_RETRY_RATE_MIN_BATCHES` | Minimum submitted batches before retry-rate pressure applies | `10` |
| `INDEX_ADAPTIVE_REJECTED_WORKERS_THRESHOLD` | Rejected BGE-M3 worker threshold | `1` |
| `INDEX_ADAPTIVE_MEMORY_FREE_PERCENT_THRESHOLD` | Host memory free-percent guardrail | `3` |
| `INDEX_ADAPTIVE_VRAM_USAGE_LIMIT_PERCENT` | VRAM usage guardrail when VRAM pressure is measured | `90` |

VRAM pressure is measured by the managed BGE-M3 worker planner when managed
workers are enabled and GPU memory metrics are available.

Changing the default batch sizes requires benchmark evidence from both a small
repository and a larger repository. Compare wall-clock time, retry rate, insert
latency, and memory/VRAM notes before promoting a candidate default.

Use `INDEX_ADAPTIVE_BACKPRESSURE=false` to keep accelerated indexing on the
static scheduler limits while preserving the bounded queue behavior.

## 🚀 Quick Setup

### 1. Create Global Config
```bash
mkdir -p ~/.context
cat > ~/.context/.env << 'EOF'
EMBEDDING_PROVIDER=OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
EMBEDDING_MODEL=text-embedding-3-small
MILVUS_TOKEN=your-zilliz-cloud-api-key
EOF
```

See the [Example File](../../.env.example) for more details.

### 2. Simplified MCP Configuration

**Claude Code:**
```bash
claude mcp add claude-context -- npx @zilliz/claude-context-mcp@latest
```

**Cursor/Windsurf/Others:**
```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"]
    }
  }
}
```

## 📚 Additional Information

For detailed information about file processing rules and how custom patterns work, see:
- [What files does Claude Context decide to embed?](../troubleshooting/faq.md#q-what-files-does-claude-context-decide-to-embed)
