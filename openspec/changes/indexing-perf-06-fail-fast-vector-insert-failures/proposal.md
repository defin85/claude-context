## Why

Parallel vector inserts can leave partial writes after the first insert-stage failure because already queued insert work may continue running while the indexing job is destined to fail. This follow-up tightens failure containment after the parallel insert scheduler is introduced.

## What Changes

- Stop scheduling new embedding or insert work after the first insert-stage failure.
- Reject queued embedding and queued insert batches with the first insert failure.
- Wait for already running insert operations to settle before returning the failed indexing result.
- Preserve the original insert-stage error and batch context as the indexing failure reported to callers.
- Add tests for fail-fast cancellation with multiple insert lanes and queued insert backlog.

Non-goals:

- Do not attempt to abort an in-flight vector database request after it has been sent to the adapter.
- Do not add vector database transactions or collection rollback.
- Do not change document identity, retrieval schema, ranking, or embedding dispatch semantics.
- Do not change existing indexed collections or require migration.

## Capabilities

### New Capabilities

- `vector-insert-failure-containment`: Covers fail-fast containment for parallel vector insert failures and partial-write-safe scheduler shutdown.

### Modified Capabilities

- None.

## Impact

- Affected code:
  - `packages/core/src/embedding-batch-scheduler.ts`: fail-fast state, queued batch rejection, and drain semantics after insert failure.
  - `packages/core/src/context.ts`: preservation of the first insert-stage error from scheduler completion.
  - `packages/core/src/embedding-batch-scheduler.test.ts` and `packages/core/src/context.accelerator.test.ts`: scheduler and mocked-vector-db regression coverage.
- Runtime impact:
  - Failed insert runs should stop launching additional queued work earlier.
  - Already running insert requests may still complete, so partial writes remain possible but are bounded to work already in flight.
- Migration impact:
  - No migration for existing indexed collections.
