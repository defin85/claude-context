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


### Advanced Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `HYBRID_MODE` | Enable hybrid search (BM25 + dense vector). Set to `false` for dense-only search | `true` |
| `EMBEDDING_BATCH_SIZE` | Batch size for processing. Larger batch size means less indexing time | `100` |
| `CODE_CHUNK_LIMIT` | Maximum number of code chunks to index per codebase. Increase for very large repositories when you accept extra indexing time and vector database storage | `450000` |
| `SPLITTER_TYPE` | Code splitter type: `ast`, `langchain` | `ast` |
| `CUSTOM_EXTENSIONS` | Additional file extensions to include (comma-separated, e.g., `.vue,.svelte,.astro`) | None |
| `CUSTOM_IGNORE_PATTERNS` | Additional ignore patterns (comma-separated, e.g., `temp/**,*.backup,private/**`) | None |

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
