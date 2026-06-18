## Why

Qdrant is now the default local vector store, and large BGE-M3 indexes write high-volume point batches with dense, sparse, ColBERT, and payload data through JSON over HTTP. The next performance question is whether Qdrant gRPC writes can reduce transport and serialization overhead without changing retrieval behavior or risking existing indexed collections.

## What Changes

- Add an optional Qdrant gRPC vector-write transport for indexing batch inserts/upserts.
- Keep HTTP as the default and preserve the existing Qdrant REST adapter behavior.
- Add configuration to select Qdrant transport and gRPC endpoint details.
- Reuse the existing `VectorDatabase` contract so the indexer can select HTTP or gRPC without changing chunking, embedding, or ranking logic.
- Add a measured HTTP-versus-gRPC indexing comparison on temporary Qdrant collections.
- Document observed performance, operational defaults, and rollback behavior.

Non-goals:

- Do not migrate, rewrite, or reindex existing Qdrant collections automatically.
- Do not change retrieval ranking, BGE-M3 schema names, payload schema, or document IDs.
- Do not replace all Qdrant search/admin operations with gRPC in the first implementation.
- Do not make gRPC the default until local benchmark evidence shows a stable benefit.

## Capabilities

### New Capabilities

- `qdrant-grpc-vector-writes`: Covers optional Qdrant gRPC writes for vector batch indexing, transport configuration, payload/vector parity, fallback behavior, and benchmark validation.

### Modified Capabilities

- None.

## Impact

- Affected code:
  - `packages/core`: Qdrant vector database adapter, point/vector/payload mapping, write retry behavior, and adapter tests.
  - `packages/mcp`: environment configuration and vector database factory wiring.
  - `scripts`: benchmark or diagnostic runner for HTTP-versus-gRPC write comparison.
  - `docs` or OpenSpec verification: operator notes for transport selection and benchmark outcome.
- Dependencies:
  - Add the official Qdrant JavaScript gRPC client dependency if it provides the cleanest supported API surface.
- Runtime impact:
  - Existing deployments continue using HTTP unless configured otherwise.
  - gRPC mode requires Qdrant gRPC endpoint availability, normally `127.0.0.1:6334`.
  - Existing Qdrant collections remain readable and writable through the current HTTP path.
- Migration impact:
  - No collection migration is required.
  - Existing indexed collections keep their names, point identifiers, vectors, and payload format.
  - Operators can roll back to HTTP by changing configuration and restarting the daemon.
