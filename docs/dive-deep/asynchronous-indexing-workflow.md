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
`oneCIndexScopeProfile` (`full`, `developer`, or `minimal`) or the
`1C_INDEX_SCOPE_PROFILE` environment variable. `full` is the default and keeps
existing traversal behavior.

Reduced profiles are persisted with the codebase index metadata.
`get_indexing_status` and `search_code` include:

- `oneCIndexScopeProfile` - the selected profile for the persisted index.
- `oneCIndexScope` - include/exclude counts by reason when traversal statistics
  are available.
- `reducedCoverageWarning` - warning text for `developer` and `minimal`
  indexes.

Changing between profiles changes indexed coverage, so `index_codebase` rejects
the request without `force=true` when an existing index was built with a
different 1C scope profile.

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

Interpret `backpressureWaitMs` as "the producer had to wait for capacity" and
adaptive throttle fields as "why capacity was intentionally reduced." A healthy
adaptive run can show some throttle time if it avoids larger insert queues,
worker retries, or memory pressure. With `INDEX_ACCELERATOR_MODE=off`, indexing
remains sequential and adaptive backpressure is inactive. With
`INDEX_ADAPTIVE_BACKPRESSURE=false`, accelerated indexing keeps the static
configured limits.

## Key Benefits

- **Non-blocking**: Agent gets immediate response
- **Progressive**: Can search partial results while indexing
- **Resilient**: Handles errors gracefully with retry capability
- **Transparent**: Always know current status
