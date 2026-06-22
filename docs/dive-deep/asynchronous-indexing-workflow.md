# Asynchronous Indexing Workflow

This document explains how Claude Context MCP handles codebase indexing asynchronously in the background.

## Core Concept

Claude Context MCP server allows users to start indexing and get an immediate response, while the actual indexing happens in the background. Users can search and monitor progress at any time.

## How It Works

![Sequence Diagram](../../assets/docs/indexing-sequence-diagram.png)

The sequence diagram above demonstrates the timing and interaction between the agent, MCP server, and background process. 

The agent receives an immediate response when starting indexing, then the users can perform searches and status checks through the agent while indexing continues in the background.


## State Flow

![Indexing Flow Diagram](../../assets/docs/indexing-flow-diagram.png)

The flow diagram above shows the complete indexing workflow, illustrating how the system handles different states and user interactions. The key insight is that indexing starts immediately but runs in the background, allowing users to interact with the system at any time.

## MCP Tools

- **`index_codebase`** - Starts background indexing, returns immediately
- **`search_code`** - Searches codebase (works during indexing with partial results)
- **`get_indexing_status`** - Shows current progress and status
- **`clear_index`** - Removes indexed data

## Status States

- **`indexed`** - ✅ Ready for search
- **`indexing`** - 🔄 Background process running
- **`indexfailed`** - ❌ Error occurred, can retry
- **`not_found`** - ❌ Not indexed yet

## 1C Scope Status

For exported 1C configuration trees, `index_codebase` can use
`oneCIndexScopeProfile` (`full`, `developer`, `minimal`, or `v8unpack`) or the
`1C_INDEX_SCOPE_PROFILE` environment variable. `full` is the default and keeps
existing traversal behavior.

Use `v8unpack` for ordinary-form exports produced by `v8unpack`. It includes
BSL modules and useful JSON object/form metadata without requiring
`customExtensions: ['.json']`, while excluding heavy resources such as `.mxl`,
`.bin`, `.c1b64`, `.c1brace`, and image files. Use `full` with explicit
`customExtensions` and ignore patterns when those heavy resources are required.

Reduced/scoped profiles are persisted with the codebase index metadata.
`get_indexing_status` and `search_code` include:

- `oneCIndexScopeProfile` - the selected profile for the persisted index.
- `oneCIndexScope` - include/exclude counts by reason when traversal statistics
  are available.
- `reducedCoverageWarning` - warning text for `developer`, `minimal`, and `v8unpack`
  indexes.

Changing between profiles changes indexed coverage, so `index_codebase` rejects
the request without `force=true` when an existing index was built with a
different 1C scope profile.

## Retrieval Profile Status

`index_codebase` also accepts `retrievalProfile` (`fast`, `balanced`, or
`quality`) for per-codebase retrieval performance selection. The selected
profile is persisted with `retrievalMode` and `retrievalSchemaVersion`.

`get_indexing_status` includes:

- `retrievalProfile` - the persisted profile, when known.
- `retrievalMode` - the concrete collection/search mode such as `dense`,
  `hybrid_bm25`, `bge_m3_dense`, or `bge_m3_full`.
- `retrievalSchemaVersion` - the schema version used by the stored collection.

Changing to an incompatible retrieval profile requires `force=true` because it
changes the indexed storage/search shape. Changing `rankingProfile` on
`search_code` does not require reindexing because it only affects scoring of
available candidates.

## Accelerated Indexing Backpressure

When accelerated indexing is enabled, status may include an `accelerator` object
with both configured hard limits and adaptive effective limits.

- `embeddingConcurrency` and `insertConcurrency` are configured maximums.
- `embeddingBatchSize` and `insertBatchSize` are configured batch-size
  boundaries. The embedding size controls chunk grouping before embedding, while
  the insert size controls how embedded documents are split before vector
  database writes.
- `effectiveEmbeddingConcurrency` is the current admission limit after adaptive
  pressure is applied.
- `configuredInsertConcurrency` and `effectiveInsertConcurrency` distinguish
  the operator upper bound from the backend-safe insert lane count.
- `vectorWritePolicy` and `backendClampReason` explain whether the active
  backend permits parallel writes to one collection or was clamped to
  single-writer behavior.
- `coalescedInsertBatches`, `coalescedInsertDocuments`,
  `queuedCoalescedDocuments`, and `coalescingFlushReasons` describe completed
  embedding batches that were combined before vector database writes.
- `adaptivePressureScore` is the highest normalized pressure signal currently
  seen by the scheduler.
- `adaptiveThrottleReason` identifies the dominant signal, such as
  `insert_backlog`, `insert_latency`, `retry_rate`, `worker_rejection`,
  `memory`, or `vram`.
- `adaptiveThrottleTimeMs` is time spent with effective embedding concurrency
  below the configured maximum.
- `backpressureWaitMs` is producer wait time caused by bounded queue capacity.
- `adaptivePressureSignals.vramUsedPercent` is included when managed BGE-M3
  worker planning has measured VRAM usage for the current daemon run.
- `adaptivePressureSignals.insertQueueDepth` and
  `adaptivePressureSignals.coalescingQueueDepth` separate write queue pressure
  from buffered coalescing pressure.

Interpret `backpressureWaitMs` as "the producer had to wait for capacity" and
adaptive throttle fields as "why capacity was intentionally reduced." A healthy
adaptive run can show some throttle time if it avoids larger insert queues,
worker retries, or memory pressure. With `INDEX_ACCELERATOR_MODE=off`, indexing
remains sequential and adaptive backpressure is inactive. With
`INDEX_ADAPTIVE_BACKPRESSURE=false`, accelerated indexing keeps the static
configured limits.

Write coalescing is downstream of embedding. It can reduce vector write call
count for payload-safe BGE-M3 batches, but it does not change embedding
content-character or estimated-token caps.

## Key Benefits

- **Non-blocking**: Agent gets immediate response
- **Progressive**: Can search partial results while indexing
- **Resilient**: Handles errors gracefully with retry capability
- **Transparent**: Always know current status
