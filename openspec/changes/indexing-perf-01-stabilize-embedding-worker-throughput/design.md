## Context

The current accelerator can keep four BGE-M3 workers active, but observed runs still show rejected workers and high retry counts. Retries may be harmless when they happen before write submission, but they consume wall clock and can make throughput comparisons misleading.

This change treats worker stability as a prerequisite for the later throughput changes.

## Goals / Non-Goals

**Goals:**

- Make worker retry and rejection causes visible in status and benchmark artifacts.
- Distinguish safe embedding retries from ambiguous failures.
- Recover temporarily rejected workers without interrupting healthy workers.
- Keep retry overhead measurable per run.

**Non-Goals:**

- No change to vector insert scheduling.
- No change to retrieval scoring.
- No attempt to make crashed GPU workers invisible; failures remain visible and bounded.

## Decisions

### Decision: classify failures by worker stage

The worker pool SHALL classify failures as startup, health, metadata, embedding request, timeout, cancellation, or unknown. Status SHALL expose counts by class, while logs may include endpoint and batch context without secrets.

### Decision: keep retry ownership inside the embedding provider

The batch scheduler SHALL submit provider-level embedding batches. The BGE-M3 provider remains responsible for choosing workers, excluding unhealthy endpoints, and retrying safe embedding failures.

### Decision: expose retry cost, not full batch history

Benchmark samples SHALL store compact retry and worker summaries. Full `accelerator.batches[]` history SHALL NOT be copied into every sample.

### Decision: fail ambiguous post-write errors conservatively

Failures after vector write submission are not retried as if no write occurred. Ambiguous write failures remain a separate concern for the insert scheduler change.

## Risks / Trade-offs

- More status fields can become noisy; keep them summarized and structured.
- Aggressive recovery can reintroduce unstable workers; use cooldown and health validation before accepting them.
- Lower retry budgets can fail runs earlier; defaults should preserve current successful behavior while exposing cost.

## Migration Plan

No data migration. Existing indexes remain valid. New fields are additive in status and benchmark output.
