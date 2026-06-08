## Context

`indexing-perf-02-parallel-vector-insert-scheduler` adds independent insert scheduling after embedding. With insert concurrency greater than one, an insert-stage failure can arrive while other insert work is queued or running. The current conservative behavior fails the indexing job and avoids unsafe retry, but it can still launch additional queued work after the first known failure.

The implementation should tighten scheduler shutdown without claiming transactional rollback. Dense-only, hybrid, and BGE-M3 full retrieval all use the same scheduler boundary; BGE-M3 full writes may use idempotent upsert, while regular and hybrid paths may still use plain inserts.

## Goals / Non-Goals

**Goals:**

- Fail fast after the first insert-stage failure.
- Prevent queued embedding and queued insert batches from starting after the first insert-stage failure.
- Preserve the first insert-stage error and batch id as the primary indexing failure.
- Wait for already running insert operations to settle before returning the failed indexing result.
- Add race-focused tests for multiple insert lanes and queued insert backlog.

**Non-Goals:**

- No cancellation of adapter calls already in flight.
- No Milvus transaction, rollback, delete compensation, or collection recreation.
- No changes to retrieval schemas, dense-only versus BGE-M3 full behavior, ranking, or document ID generation.
- No migration of existing collections.

## Decisions

### Decision: first insert failure closes the scheduler to new work

When `runInsert()` catches an insert-stage error, the scheduler records that error as the terminal scheduler failure. After that, `scheduleEmbedding()` and `scheduleInsert()` must not start more work. Queued embedding batches and queued insert batches are rejected with the same terminal error.

Alternative considered: keep processing queued work and report failure at the end. That maximizes throughput but increases partial-write exposure after the failure is already known.

### Decision: running inserts are allowed to settle

Already running insert operations should not be interrupted by scheduler state alone because the vector database request may already be in progress and the adapter API does not expose reliable cancellation. The scheduler should wait for those operations to resolve or reject before `drain()` completes.

Alternative considered: return immediately after first failure. That shortens failure latency but can leave background promises mutating vector DB state after the caller has already received the error.

### Decision: report the first insert failure

The indexing job should reject with the first insert-stage error, including the existing `Indexing batch <id> failed during insert: ...` context. Later failures from already running inserts may be recorded in status counters, but they should not replace the primary failure.

Alternative considered: aggregate all insert failures. Aggregation is useful for diagnostics, but it makes the caller-facing error less stable and is not needed for fail-fast containment.

## Risks / Trade-offs

- Running insert requests may still write after the first failure -> Mitigation: bound exposure to already running insert lanes and queued work that has already been started.
- Earlier cancellation can reduce diagnostic evidence from later batches -> Mitigation: keep failed insert counters and batch states for rejected queued work.
- Scheduler state transitions can introduce promise rejection races -> Mitigation: add tests for queued insert rejection, running insert settlement, and no unhandled rejections.
- Latency on failure can include slow running inserts -> Mitigation: this is intentional to avoid background writes after the caller receives failure.

## Migration Plan

No data migration. Deploy as a scheduler behavior change. Rollback is reverting to the previous scheduler behavior; existing collections remain readable in either direction.
