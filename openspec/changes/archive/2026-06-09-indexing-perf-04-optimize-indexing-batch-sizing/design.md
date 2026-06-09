## Context

One batch size cannot optimize both model inference and vector database writes. BGE-M3 full mode also has token and ColBERT payload costs that can make oversized batches unstable.

This change creates the measurement and configuration needed to tune batch sizes deliberately.

## Goals / Non-Goals

**Goals:**

- Separate embedding and insert batch-size concerns.
- Capture enough metrics to choose defaults from evidence.
- Avoid batch sizes that increase retries or memory pressure.
- Preserve deterministic chunks and document IDs.

**Non-Goals:**

- No per-language auto-tuning in the first version.
- No change to splitter output.
- No quality changes to retrieval ranking.

## Decisions

### Decision: keep chunking separate from batching

Chunk boundaries SHALL remain controlled by splitters and chunk configuration. Batch tuning only groups already-created chunks for embedding and insertion.

### Decision: tune embedding and insert separately

The system MAY use different maximum chunk/token limits for embedding requests and insert groups. The insert scheduler MAY coalesce or split embedded batches when safe.

### Decision: require benchmark evidence before changing defaults

Default batch-size changes SHALL be backed by benchmark artifacts that include wall clock, retry rate, insert latency, and memory/VRAM notes.

## Risks / Trade-offs

- Larger batches can improve throughput but increase tail latency and failure blast radius.
- Smaller batches can reduce retries but increase overhead.
- Insert coalescing must preserve metadata and cancellation behavior.

## Migration Plan

No index migration. Batch-size changes affect future indexing runs only.
