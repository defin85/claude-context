# @zilliz/claude-context-mcp

![](../../assets/claude-context.png)
Model Context Protocol (MCP) integration for Claude Context - A powerful MCP server that enables AI assistants and agents to index and search codebases using semantic search.

[![npm version](https://img.shields.io/npm/v/@zilliz/claude-context-mcp.svg)](https://www.npmjs.com/package/@zilliz/claude-context-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@zilliz/claude-context-mcp.svg)](https://www.npmjs.com/package/@zilliz/claude-context-mcp)

> 📖 **New to Claude Context?** Check out the [main project README](../../README.md) for an overview and setup instructions.

## 🚀 Use Claude Context as MCP in Claude Code and others

![img](https://lh7-rt.googleusercontent.com/docsz/AD_4nXf2uIf2c5zowp-iOMOqsefHbY_EwNGiutkxtNXcZVJ8RI6SN9DsCcsc3amXIhOZx9VcKFJQLSAqM-2pjU9zoGs1r8GCTUL3JIsLpLUGAm1VQd5F2o5vpEajx2qrc77iXhBu1zWj?key=qYdFquJrLcfXCUndY-YRBQ)

Model Context Protocol (MCP) allows you to integrate Claude Context with your favorite AI coding assistants, e.g. Claude Code.

## Quick Start

### Prerequisites

Before using the MCP server, make sure you have:

- API key or local runtime for your chosen embedding provider (OpenAI, VoyageAI, Gemini, Ollama, or BGE-M3 sidecar)
- Milvus vector database (local or cloud)

> 💡 **Setup Help:** See the [main project setup guide](../../README.md#-quick-start) for detailed installation instructions.

### Prepare Environment Variables

#### Embedding Provider Configuration

Claude Context MCP supports multiple embedding providers. Choose the one that best fits your needs:

> 📋 **Quick Reference**: For a complete list of environment variables and their descriptions, see the [Environment Variables Guide](../../docs/getting-started/environment-variables.md).

```bash
# Supported providers: OpenAI, VoyageAI, Gemini, Ollama, BGE_M3
EMBEDDING_PROVIDER=OpenAI
```

<details>
<summary><strong>1. OpenAI Configuration (Default)</strong></summary>

OpenAI provides high-quality embeddings with excellent performance for code understanding.

```bash
# Required: Your OpenAI API key
OPENAI_API_KEY=sk-your-openai-api-key

# Optional: Specify embedding model (default: text-embedding-3-small)
EMBEDDING_MODEL=text-embedding-3-small

# Optional: Custom API base URL (for Azure OpenAI or other compatible services)
OPENAI_BASE_URL=https://api.openai.com/v1
```

**Available Models:**
See `getSupportedModels` in [`openai-embedding.ts`](https://github.com/zilliztech/claude-context/blob/master/packages/core/src/embedding/openai-embedding.ts) for the full list of supported models.

**Getting API Key:**

1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Generate a new API key
4. Set up billing if needed

</details>

<details>
<summary><strong>2. VoyageAI Configuration</strong></summary>

VoyageAI offers specialized code embeddings optimized for programming languages.

```bash
# Required: Your VoyageAI API key
VOYAGEAI_API_KEY=pa-your-voyageai-api-key

# Optional: Specify embedding model (default: voyage-code-3)
EMBEDDING_MODEL=voyage-code-3
```

**Available Models:**
See `getSupportedModels` in [`voyageai-embedding.ts`](https://github.com/zilliztech/claude-context/blob/master/packages/core/src/embedding/voyageai-embedding.ts) for the full list of supported models.

**Getting API Key:**

1. Visit [VoyageAI Console](https://dash.voyageai.com/)
2. Sign up for an account
3. Navigate to API Keys section
4. Create a new API key

</details>

<details>
<summary><strong>3. Gemini Configuration</strong></summary>

Google's Gemini provides competitive embeddings with good multilingual support.

```bash
# Required: Your Gemini API key
GEMINI_API_KEY=your-gemini-api-key

# Optional: Specify embedding model (default: gemini-embedding-001)
EMBEDDING_MODEL=gemini-embedding-001

# Optional: Custom API base URL (for custom endpoints)
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

**Available Models:**
See `getSupportedModels` in [`gemini-embedding.ts`](https://github.com/zilliztech/claude-context/blob/master/packages/core/src/embedding/gemini-embedding.ts) for the full list of supported models.

**Getting API Key:**

1. Visit [Google AI Studio](https://aistudio.google.com/)
2. Sign in with your Google account
3. Go to "Get API key" section
4. Create a new API key

</details>

<details>
<summary><strong>4. Ollama Configuration (Local/Self-hosted)</strong></summary>

Ollama allows you to run embeddings locally without sending data to external services.

```bash
# Required: Specify which Ollama model to use
EMBEDDING_MODEL=nomic-embed-text

# Optional: Specify Ollama host (default: http://127.0.0.1:11434)
OLLAMA_HOST=http://127.0.0.1:11434
```

**Setup Instructions:**

1. Install Ollama from [ollama.com](https://ollama.com/)
2. Pull the embedding model:

   ```bash
   ollama pull nomic-embed-text
   ```

3. Ensure Ollama is running:

   ```bash
   ollama serve
   ```

</details>

<details>
<summary><strong>5. BGE-M3 Configuration (Local/Self-hosted)</strong></summary>

BGE-M3 full mode uses a local sidecar that returns dense vectors, model-generated sparse lexical weights, and ColBERT token vectors. Claude Context stores these in a distinct `bge_m3_code_chunks_*` collection and reranks first-stage dense+sparse candidates with ColBERT MaxSim.

```bash
# Required: select BGE-M3 and point at your sidecar
EMBEDDING_PROVIDER=BGE_M3
BGE_M3_ENDPOINT=http://127.0.0.1:8000

# Optional: defaults shown
BGE_M3_MODEL=BAAI/bge-m3
BGE_M3_MODE=full
BGE_M3_CANDIDATE_LIMIT=100
BGE_M3_STORE_COLBERT=true
BGE_M3_COLBERT_TOKEN_LIMIT=4
BGE_M3_COLBERT_DECIMAL_PLACES=6

# Local Milvus is supported
MILVUS_ADDRESS=localhost:19530
```

The sidecar must expose:

- `POST /embed` for one input.
- `POST /embed_batch` for indexing batches.

This repository includes a local Python sidecar in `python/bge_m3_sidecar.py`.
Run it from a Python 3.10-3.12 environment with `FlagEmbedding`, PyTorch, and
FastAPI installed:

```bash
cd python
python3.12 -m venv .venv-bge-m3
source .venv-bge-m3/bin/activate
pip install -r requirements-bge-m3-sidecar.txt
python bge_m3_sidecar.py --device cuda --mode full
```

`BGE_M3_MODE=dense` is explicit dense-only mode. It must not be treated as full dense+sparse+ColBERT retrieval. `BGE_M3_MODE=full` requires `BGE_M3_STORE_COLBERT=true`; disabling ColBERT storage is rejected because reranking needs stored document token vectors. Switching from existing dense-only or BM25-hybrid indexes to `BGE_M3_MODE=full` requires reindexing with `force=true`.
The stored ColBERT token cap defaults to `4` to keep the same-collection JSON
payload under Milvus `VarChar` row limits; raise it only after validating row
sizes for your chunking settings.

</details>

#### Get a free vector database on Zilliz Cloud

Claude Context needs a vector database. You can [sign up](https://cloud.zilliz.com/signup?utm_source=github&utm_medium=referral&utm_campaign=2507-codecontext-readme) on Zilliz Cloud to get an API key.

![](../../assets/signup_and_get_apikey.png)

Copy your Personal Key to replace `your-zilliz-cloud-api-key` in the configuration examples.

```bash
MILVUS_TOKEN=your-zilliz-cloud-api-key
```

#### Embedding Batch Size

You can set the embedding batch size to optimize the performance of the MCP server, depending on your embedding model throughput. The default value is 100.

```bash
EMBEDDING_BATCH_SIZE=512
```

For payload-sensitive providers, you can also cap the total content characters
or estimated tokens sent in one embedding request:

```bash
INDEX_EMBEDDING_MAX_CONTENT_CHARS=1000000
INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS=250000
```

Unset or `auto` values leave dense-only modes unchanged. BGE-M3 full uses these
conservative effective defaults when the variables are unset.

#### Code Chunk Limit

You can set the maximum number of code chunks to index per codebase. The default value is 450000.

```bash
CODE_CHUNK_LIMIT=900000
```

#### Custom File Processing (Optional)

You can configure custom file extensions and ignore patterns globally via environment variables:

```bash
# Additional file extensions to include beyond defaults
CUSTOM_EXTENSIONS=.vue,.svelte,.astro,.twig

# Additional ignore patterns to exclude files/directories
CUSTOM_IGNORE_PATTERNS=temp/**,*.backup,private/**,uploads/**
```

These settings work in combination with tool parameters - patterns from both sources will be merged together.

## Daemon-First Mode

Updated clients can target one shared local daemon instead of starting a new subprocess per repository.

### Start the daemon

```bash
MCP_RUNTIME_MODE=daemon \
MCP_DAEMON_TOKEN=local-secret \
MCP_DAEMON_ALLOW_ROOTS=/repo/a:/repo/b \
npx @zilliz/claude-context-mcp@latest
```

### Discover active daemon bootstrap config

```bash
npx @zilliz/claude-context-mcp@latest --daemon-discover
```

This prints JSON with the current daemon endpoint, compatibility version, allowed roots, and bearer token for updated clients. The discovery file is stored under `~/.context/mcp/daemon/client-config.json`.

### Operator commands

```bash
# Inspect active runtimes, known repositories, and workload state
npx @zilliz/claude-context-mcp@latest --daemon-status

# Cancel queued/active indexing work for one codebase
npx @zilliz/claude-context-mcp@latest --daemon-cancel /repo/a

# Remove stale daemon registry/discovery/runtime artifacts and recover stale snapshot ownership
npx @zilliz/claude-context-mcp@latest --daemon-cleanup-stale

# Restart daemon mode using the current CLI/env config, with fallback to active discovery metadata
npx @zilliz/claude-context-mcp@latest --daemon-restart --mode daemon --allow-root /repo/a

# Stop the active daemon gracefully
npx @zilliz/claude-context-mcp@latest --daemon-stop
```

`--daemon-restart` reuses active discovery metadata for daemon host/port/path/token/allow-roots when those flags are omitted, but it still inherits embedding/vector DB environment from the current shell.

### Local web dashboard

The daemon can also serve an opt-in local dashboard on the same loopback HTTP server. It is disabled by default and uses the daemon bearer token for all `/api` routes.

```bash
pnpm build:web-dashboard

MCP_RUNTIME_MODE=daemon \
MCP_DAEMON_TOKEN=local-secret \
MCP_DAEMON_ALLOW_ROOTS=/repo/a:/repo/b \
MCP_DASHBOARD_ENABLED=true \
MCP_DASHBOARD_STATIC_DIR=packages/web-dashboard/dist \
npx @zilliz/claude-context-mcp@latest
```

Open `http://127.0.0.1:39393/dashboard` and paste the daemon bearer token into the token field. The static dashboard files do not embed the token; the browser sends it as an `Authorization: Bearer ...` header only for dashboard API requests.

Dashboard options:

- `--dashboard` or `MCP_DASHBOARD_ENABLED=true`: enable the dashboard in daemon mode.
- `--dashboard-route <path>` or `MCP_DASHBOARD_ROUTE`: route prefix, default `/dashboard`.
- `--dashboard-static-dir <path>` or `MCP_DASHBOARD_STATIC_DIR`: production build directory. If omitted, the daemon serves a minimal placeholder page.

The dashboard currently provides polling-based daemon status, known codebase listing, indexing status, profile state visibility, search, index, clear, and cancel actions. API routes reject non-loopback requests, non-local web origins, missing bearer tokens, and route collisions with the MCP endpoint.

Status and search responses may include a structured `profileState` object. The dashboard uses it as the preferred source for daemon retrieval defaults, selected-codebase index-time retrieval and 1C/RLM BSL state, and latest-search ranking state. Existing fields such as `retrievalConfiguration`, `retrievalProfile`, `retrievalMode`, `retrievalSchemaVersion`, `rankingProfile`, `oneCIndexScopeProfile`, and `rlmBslEnrichment` remain available for compatibility and dashboard fallback rendering.

Keep the dashboard bound to `127.0.0.1`. Do not expose it on a non-local interface, reverse proxy, or shared host without a separate deployment review for authentication, TLS, origin policy, and secret handling.

For frontend development, start a daemon with the dashboard enabled, then run:

```bash
DASHBOARD_API_TARGET=http://127.0.0.1:39393/dashboard pnpm dev:web-dashboard
```

The Vite dev server proxies `/api` to the daemon dashboard API. Paste the daemon bearer token into the local UI; do not put the token into static files or Vite environment variables.

Useful verification commands:

```bash
pnpm --filter @zilliz/claude-context-mcp exec tsx --test src/config.test.ts src/dashboard-api.test.ts
pnpm build:mcp-with-dashboard
pnpm lint
pnpm typecheck
pnpm build
pnpm exec openspec validate add-web-dashboard --strict
```

## Usage with MCP Clients

<details>
<summary><strong>Claude Code</strong></summary>

Use the command line interface to add the Claude Context MCP server:

```bash
# Add the Claude Context MCP server
claude mcp add claude-context -e OPENAI_API_KEY=your-openai-api-key -e MILVUS_TOKEN=your-zilliz-cloud-api-key -- npx @zilliz/claude-context-mcp@latest

```

See the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp) for more details about MCP server management.

</details>

<details>
<summary><strong>OpenAI Codex CLI</strong></summary>

Codex CLI uses TOML configuration files:

1. Create or edit the `~/.codex/config.toml` file.

2. For the classic subprocess setup, add the following configuration:

```toml
# IMPORTANT: the top-level key is `mcp_servers` rather than `mcpServers`.
[mcp_servers.claude-context]
command = "npx"
args = ["@zilliz/claude-context-mcp@latest"]
env = { "OPENAI_API_KEY" = "your-openai-api-key", "MILVUS_TOKEN" = "your-zilliz-cloud-api-key" }
startup_timeout_sec = 20
```

3. For one shared daemon across multiple repositories, point Codex CLI at the daemon HTTP endpoint instead of starting a subprocess per project:

```toml
[mcp_servers.claude-context]
url = "http://127.0.0.1:39393/mcp"
bearer_token_env_var = "MCP_DAEMON_TOKEN"
startup_timeout_sec = 20
tool_timeout_sec = 180
```

Start the daemon once with all allowed roots:

```bash
MCP_RUNTIME_MODE=daemon \
MCP_DAEMON_TOKEN=local-secret \
MCP_DAEMON_ALLOW_ROOTS=/repo/a:/repo/b:/repo/c \
npx @zilliz/claude-context-mcp@latest
```

One Codex CLI session can then serve all allowlisted repositories by passing different canonical absolute `path` values to `index_codebase`, `search_code`, and `get_indexing_status`. Prefer POSIX paths such as `/home/egor/code/repo`; WSL UNC paths are normalized automatically, but POSIX form is recommended.

If a repository was only recovered from cloud state and reports missing persisted sync config, run one daemon-side `index_codebase` with `force=true` for that repository to restore restart-safe sync semantics.

4. Save the file and restart Codex CLI to apply the changes.

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Gemini CLI requires manual configuration through a JSON file:

1. Create or edit the `~/.gemini/settings.json` file.

2. Add the following configuration:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

3. Save the file and restart Gemini CLI to apply the changes.

</details>

<details>
<summary><strong>Qwen Code</strong></summary>

Create or edit the `~/.qwen/settings.json` file and add the following configuration:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Go to: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

Pasting the following configuration into your Cursor `~/.cursor/mcp.json` file is the recommended approach. You may also install in a specific project by creating `.cursor/mcp.json` in your project folder. See [Cursor MCP docs](https://cursor.com/docs/context/mcp) for more info.

**OpenAI Configuration (Default):**

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "EMBEDDING_PROVIDER": "OpenAI",
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

**VoyageAI Configuration:**

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "EMBEDDING_PROVIDER": "VoyageAI",
        "VOYAGEAI_API_KEY": "your-voyageai-api-key",
        "EMBEDDING_MODEL": "voyage-code-3",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

**Gemini Configuration:**

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "EMBEDDING_PROVIDER": "Gemini",
        "GEMINI_API_KEY": "your-gemini-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

**Ollama Configuration:**

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "EMBEDDING_PROVIDER": "Ollama",
        "EMBEDDING_MODEL": "nomic-embed-text",
        "OLLAMA_HOST": "http://127.0.0.1:11434",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Void</strong></summary>

Go to: `Settings` -> `MCP` -> `Add MCP Server`

Add the following configuration to your Void MCP settings:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_ADDRESS": "your-zilliz-cloud-public-endpoint",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Windsurf supports MCP configuration through a JSON file. Add the following configuration to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code</strong></summary>

The Claude Context MCP server can be used with VS Code through MCP-compatible extensions. Add the following configuration to your VS Code MCP settings:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cherry Studio</strong></summary>

Cherry Studio allows for visual MCP server configuration through its settings interface. While it doesn't directly support manual JSON configuration, you can add a new server via the GUI:

1. Navigate to **Settings → MCP Servers → Add Server**.
2. Fill in the server details:
   - **Name**: `claude-context`
   - **Type**: `STDIO`
   - **Command**: `npx`
   - **Arguments**: `["@zilliz/claude-context-mcp@latest"]`
   - **Environment Variables**:
     - `OPENAI_API_KEY`: `your-openai-api-key`
     - `MILVUS_TOKEN`: `your-zilliz-cloud-api-key`
3. Save the configuration to activate the server.

</details>

<details>
<summary><strong>Cline</strong></summary>

Cline uses a JSON configuration file to manage MCP servers. To integrate the provided MCP server configuration:

1. Open Cline and click on the **MCP Servers** icon in the top navigation bar.

2. Select the **Installed** tab, then click **Advanced MCP Settings**.

3. In the `cline_mcp_settings.json` file, add the following configuration:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

4. Save the file.

</details>

<details>
<summary><strong>Augment</strong></summary>

To configure Claude Context MCP in Augment Code, you can use either the graphical interface or manual configuration.

#### **A. Using the Augment Code UI**

1. Click the hamburger menu.

2. Select **Settings**.

3. Navigate to the **Tools** section.

4. Click the **+ Add MCP** button.

5. Enter the following command:

   ```
   npx @zilliz/claude-context-mcp@latest
   ```

6. Name the MCP: **Claude Context**.

7. Click the **Add** button.

------

#### **B. Manual Configuration**

1. Press Cmd/Ctrl Shift P or go to the hamburger menu in the Augment panel
2. Select Edit Settings
3. Under Advanced, click Edit in settings.json
4. Add the server configuration to the `mcpServers` array in the `augment.advanced` object

```json
"augment.advanced": { 
  "mcpServers": [ 
    { 
      "name": "claude-context", 
      "command": "npx", 
      "args": ["-y", "@zilliz/claude-context-mcp@latest"] 
    } 
  ] 
}
```

</details>

<details>
<summary><strong>Roo Code</strong></summary>

Roo Code utilizes a JSON configuration file for MCP servers:

1. Open Roo Code and navigate to **Settings → MCP Servers → Edit Global Config**.

2. In the `mcp_settings.json` file, add the following configuration:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
      }
    }
  }
}
```

3. Save the file to activate the server.

</details>

<details>
<summary><strong>Zencoder</strong></summary>

Zencoder offers support for MCP tools and servers in both its JetBrains and VS Code plugin versions.

1. Go to the Zencoder menu (...)
2. From the dropdown menu, select `Tools`
3. Click on the `Add Custom MCP`
4. Add the name (i.e. `Claude Context` and server configuration from below, and make sure to hit the `Install` button

```json
{
    "command": "npx",
    "args": ["@zilliz/claude-context-mcp@latest"],
    "env": {
      "OPENAI_API_KEY": "your-openai-api-key",
      "MILVUS_ADDRESS": "your-zilliz-cloud-public-endpoint",
      "MILVUS_TOKEN": "your-zilliz-cloud-api-key"
    }
}

```

5. Save the server by hitting the `Install` button.

</details>

<details>
<summary><strong>LangChain/LangGraph</strong></summary>

For LangChain/LangGraph integration examples, see [this example](https://github.com/zilliztech/claude-context/blob/643796a0d30e706a2a0dff3d55621c9b5d831807/evaluation/retrieval/custom.py#L88).

</details>

<details>
<summary><strong>Other MCP Clients</strong></summary>

The server uses stdio transport and follows the standard MCP protocol. It can be integrated with any MCP-compatible client by running:

```bash
npx @zilliz/claude-context-mcp@latest
```

</details>

## Features

- 🔌 **MCP Protocol Compliance**: Full compatibility with MCP-enabled AI assistants and agents
- 🔍 **Hybrid Code Search**: Natural language queries using advanced hybrid search (BM25 + dense vector) to find relevant code snippets
- 📁 **Codebase Indexing**: Index entire codebases for fast hybrid search across millions of lines of code
- 🔄 **Incremental Indexing**: Efficiently re-index only changed files using Merkle trees for auto-sync
- 🧩 **Intelligent Code Chunking**: AST-based code analysis for syntax-aware chunking with automatic fallback
- 🗄️ **Scalable**: Integrates with Zilliz Cloud for scalable vector search, no matter how large your codebase is
- 🛠️ **Customizable**: Configure file extensions, ignore patterns, and embedding models
- ⚡ **Real-time**: Interactive indexing and searching with progress feedback

## Available Tools

> Path guidance: for all codebase tools, use a canonical absolute POSIX path such as `/home/egor/code/repo`. WSL UNC paths like `\\wsl.localhost\\archlinux\\home\\egor\\code\\repo` are normalized automatically, but POSIX form is recommended.

### 1. `index_codebase`

Index a codebase directory for hybrid search (BM25 + dense vector).

**Parameters:**

- `path` (required): Canonical absolute path to the codebase directory to index; prefer POSIX form such as `/home/egor/code/repo`
- `force` (optional): Force re-indexing even if already indexed (default: false)
- `splitter` (optional): Code splitter to use - 'ast' for syntax-aware splitting with automatic fallback, 'langchain' for character-based splitting (default: "ast")
- `customExtensions` (optional): Additional file extensions to include beyond defaults (e.g., ['.vue', '.svelte', '.astro']). Extensions should include the dot prefix or will be automatically added (default: [])
- `ignorePatterns` (optional): Additional ignore patterns to exclude specific files/directories beyond defaults (e.g., ['static/**', '*.tmp', 'private/**']) (default: [])
- `oneCIndexScopeProfile` (optional): 1C exported-configuration scope profile: `full`, `developer`, `minimal`, or `v8unpack`. Use `v8unpack` for ordinary-form `v8unpack` exports; it includes BSL plus useful JSON metadata/form files and excludes heavy resources such as `.mxl`, `.bin`, `.c1b64`, `.c1brace`, and images. Use `full` with explicit `customExtensions` and ignore patterns when those heavy resources are required.

### 2. `search_code`

Search the indexed codebase using natural language queries with hybrid search (BM25 + dense vector).

**Parameters:**

- `path` (required): Canonical absolute path to the codebase directory to search in; prefer POSIX form such as `/home/egor/code/repo`
- `query` (required): Natural language query to search for in the codebase
- `limit` (optional): Maximum number of results to return (default: 10, max: 50)
- `extensionFilter` (optional): List of file extensions to filter results (e.g., ['.ts', '.py']) (default: [])
- `rankingProfile` (optional): Retrieval ranking profile. Use `auto` for backward-compatible path-based behavior, `generic` to disable 1C-specific boosts, or `one-c` to explicitly enable 1C ranking signals for exported 1C configurations (default: `auto`).

Structured search responses include `profileState.search` when profile diagnostics are available. It reports the requested and resolved ranking profile as request-time state and does not persist ranking profile as codebase configuration.

For non-trivial 1C exported-configuration tasks, treat `search_code` as context-bundle discovery rather than a single-result lookup. Search the original user task first, then focused roles for library API, client usage, server usage, applied usage, and metadata/state. Some metadata/state context can be outside the current indexed scope/profile, so check coverage or filesystem context when expected metadata is missing. This is agent search guidance only; it does not change ranking, scoring, schemas, providers, or collection requirements. See the maintained runbook at [`docs/dive-deep/one-c-semantic-search-runbook.md`](../../docs/dive-deep/one-c-semantic-search-runbook.md).

### 3. `clear_index`

Clear the search index for a specific codebase.

**Parameters:**

- `path` (required): Canonical absolute path to the codebase directory to clear index for; prefer POSIX form such as `/home/egor/code/repo`

### 4. `get_indexing_status`

Get the current indexing status of a codebase. Shows progress percentage for actively indexing codebases and completion status for indexed codebases.

**Parameters:**

- `path` (required): Canonical absolute path to the codebase directory to check status for; prefer POSIX form such as `/home/egor/code/repo`

## Contributing

This package is part of the Claude Context monorepo. Please see:

- [Main Contributing Guide](../../CONTRIBUTING.md) - General contribution guidelines  
- [MCP Package Contributing](CONTRIBUTING.md) - Specific development guide for this package

## Related Projects

- **[@zilliz/claude-context-core](../core)** - Core indexing engine used by this MCP server
- **[VSCode Extension](../vscode-extension)** - Alternative VSCode integration
- [Model Context Protocol](https://modelcontextprotocol.io/) - Official MCP documentation

## License

MIT - See [LICENSE](../../LICENSE) for details
