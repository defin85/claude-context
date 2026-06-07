## Context

The accelerator already separates embedding and insert limits, but observed runs still effectively use one insert lane. When embedding concurrency is four, a single insert path can make the producer wait even when workers are healthy.

This change makes vector insertion a first-class scheduled stage with its own queue, safety rules, and observability.

## Goals / Non-Goals

**Goals:**

- Reduce wall-clock time when Milvus can accept concurrent writes.
- Keep insert concurrency bounded and configurable.
- Preserve stable document IDs and retrieval metadata under out-of-order writes.
- Make insert bottlenecks measurable.

**Non-Goals:**

- No change to chunking or embedding output.
- No background migration of existing collections.
- No optimistic retry of ambiguous write failures.

## Decisions

### Decision: use a bounded insert queue

Embedded batches SHALL enter a bounded insert scheduler. The scheduler SHALL enforce configured insert concurrency and expose queued, running, completed, and failed insert counts.

### Decision: prefer idempotent upsert where supported

Parallel insert SHALL use upsert semantics for accelerated writes when the vector database adapter supports it. If only plain insert is available, ambiguous failures SHALL fail the indexing job rather than retrying blindly.

### Decision: separate insert completion from file progress

File processing progress MAY advance while embedded batches wait to insert, but final indexing completion SHALL wait until all insert tasks settle.

### Decision: keep defaults conservative

The default insert concurrency SHOULD remain `1` until local Milvus benchmarks show safe improvement. Operators MAY opt into higher values.

## Risks / Trade-offs

- Concurrent inserts can overload Milvus or increase memory pressure.
- Parallel writes can expose ordering assumptions in tests or status output.
- Upsert semantics may differ across vector database adapters.

## Migration Plan

No collection migration. The change only affects new indexing runs under configured insert concurrency.
