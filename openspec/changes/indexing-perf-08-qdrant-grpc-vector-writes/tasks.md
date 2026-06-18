## 1. Configuration and Dependency Setup

- [ ] 1.1 Add the official Qdrant JavaScript gRPC client dependency to the workspace package that owns the Qdrant adapter.
- [ ] 1.2 Add Qdrant transport configuration with HTTP as the default and gRPC as an explicit opt-in.
- [ ] 1.3 Add Qdrant gRPC endpoint configuration, defaulting to the local Qdrant gRPC port when transport is gRPC.
- [ ] 1.4 Wire the MCP vector database factory so Qdrant HTTP and Qdrant gRPC write mode can be selected without changing callers.

## 2. gRPC Write Adapter

- [ ] 2.1 Add a Qdrant gRPC write client wrapper for point upsert operations.
- [ ] 2.2 Implement point mapping for dense-only vector documents.
- [ ] 2.3 Implement point mapping for full BGE-M3 documents with dense, sparse, and ColBERT named vectors.
- [ ] 2.4 Preserve existing stable point identifier generation and payload field names.
- [ ] 2.5 Route `insert`, `insertHybrid`, `insertBgeM3`, and `upsertBgeM3` through gRPC when gRPC transport is configured.
- [ ] 2.6 Keep collection administration, search, query, scroll/count, delete, and diagnostics on the existing HTTP path for this change.
- [ ] 2.7 Preserve existing HTTP retry and conservative failure behavior semantics for ambiguous gRPC write failures.

## 3. Tests and Parity Checks

- [ ] 3.1 Add unit tests for Qdrant transport configuration parsing and defaults.
- [ ] 3.2 Add mapper tests that compare HTTP-shaped and gRPC-shaped point data for dense-only documents.
- [ ] 3.3 Add mapper tests that compare HTTP-shaped and gRPC-shaped point data for full BGE-M3 documents.
- [ ] 3.4 Add adapter tests for unavailable gRPC endpoint failure reporting.
- [ ] 3.5 Add an integration or smoke test that writes to a disposable Qdrant collection through gRPC and reads back the point data for parity.

## 4. Benchmark and Documentation

- [ ] 4.1 Add or extend a benchmark script that can run the same disposable fixture with Qdrant HTTP writes and Qdrant gRPC writes.
- [ ] 4.2 Ensure benchmark runs never clear or rewrite existing Business Automation demo collections.
- [ ] 4.3 Record transport, endpoint, compression mode when applicable, wall-clock time, insert-stage timing, insert batch counts, failures, and fixture identity in the benchmark summary.
- [ ] 4.4 Document the measured result and state whether HTTP remains the recommended default or gRPC should be proposed as a later default change.

## 5. Verification

- [ ] 5.1 Run targeted Qdrant adapter and configuration tests.
- [ ] 5.2 Run `pnpm build:core`.
- [ ] 5.3 Run `pnpm typecheck`.
- [ ] 5.4 Run the HTTP-versus-gRPC disposable benchmark and save the summary path in `verification.md`.
- [ ] 5.5 Run `pnpm exec openspec validate indexing-perf-08-qdrant-grpc-vector-writes --strict`.
