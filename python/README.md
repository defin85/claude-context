# Python → TypeScript Claude Context Bridge

A simple utility to call TypeScript Claude Context methods from Python.

## What's This?

This directory contains a basic bridge that allows you to run Claude Context TypeScript functions from Python scripts. It's not a full SDK - just a simple way to test and use the TypeScript codebase from Python.

## Files

- `ts_executor.py` - Executes TypeScript methods from Python
- `test_context.ts` - TypeScript test script with Claude Context workflow
- `test_endtoend.py` - Python script that calls the TypeScript test
- `bge_m3_sidecar.py` - Local HTTP sidecar for BGE-M3 dense+sparse+ColBERT embeddings
- `requirements-bge-m3-sidecar.txt` - Python runtime dependencies for the BGE-M3 sidecar

## Prerequisites

```bash
# Make sure you have Node.js dependencies installed
cd .. && pnpm install

# Set your OpenAI API key (required for actual indexing)
export OPENAI_API_KEY="your-openai-api-key"

# Optional: Set Milvus address (defaults to localhost:19530)
export MILVUS_ADDRESS="localhost:19530"
```

## Quick Usage

```bash
# Run the end-to-end test
python test_endtoend.py
```

This will:
1. Create embeddings using OpenAI
2. Connect to Milvus vector database  
3. Index the `packages/core/src` codebase
4. Perform a semantic search
5. Show results

## Manual Usage

```python
from ts_executor import TypeScriptExecutor

executor = TypeScriptExecutor()
result = executor.call_method(
    './test_context.ts',
    'testContextEndToEnd',
    {
        'openaiApiKey': 'sk-your-key',
        'milvusAddress': 'localhost:19530',
        'codebasePath': '../packages/core/src',
        'searchQuery': 'vector database configuration'
    }
)

print(result)
```
## How It Works

1. `ts_executor.py` creates temporary TypeScript wrapper files
2. Runs them with `ts-node` 
3. Captures JSON output and returns to Python
4. Supports async functions and complex parameters

That's it! This is just a simple bridge for testing purposes. 

## BGE-M3 Sidecar

The BGE-M3 sidecar is a small FastAPI service used by
`EMBEDDING_PROVIDER=BGE_M3`. It exposes:

- `GET /health`
- `GET /metadata`
- `POST /embed`
- `POST /embed_batch`

Use Python 3.10-3.12 for the runtime environment. PyTorch wheels may not be
available for newer Python versions.

```bash
cd python
python3.12 -m venv .venv-bge-m3
source .venv-bge-m3/bin/activate
pip install -r requirements-bge-m3-sidecar.txt

python bge_m3_sidecar.py \
  --host 127.0.0.1 \
  --port 8000 \
  --model BAAI/bge-m3 \
  --mode full \
  --device cuda
```

Then configure Claude Context:

```bash
EMBEDDING_PROVIDER=BGE_M3
BGE_M3_ENDPOINT=http://127.0.0.1:8000
BGE_M3_MODEL=BAAI/bge-m3
BGE_M3_MODE=full
```

Run the lightweight sidecar tests without installing model dependencies. FastAPI
endpoint checks run when FastAPI is installed and are skipped otherwise:

```bash
cd python
python -m unittest test_bge_m3_sidecar.py
```
