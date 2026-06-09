## Context

Static concurrency can oversubmit work when downstream insertion is slow or workers are unstable. Backpressure is useful as a safety signal, but accumulated wait time alone does not correct the pipeline.

This change turns pressure signals into adaptive effective concurrency and queue admission decisions.

## Goals / Non-Goals

**Goals:**

- Reduce unproductive waiting and retry churn.
- Protect daemon responsiveness during long indexing jobs.
- Make throttle decisions explainable in status.
- Preserve configured hard maximums and off-mode determinism.

**Non-Goals:**

- No automatic tuning of retrieval profile.
- No multi-host scheduling.
- No removal of operator-configured limits.

## Decisions

### Decision: compute effective concurrency from pressure

The accelerator SHALL keep configured maximums but compute lower effective concurrency when downstream pressure exceeds thresholds. Pressure inputs include insert backlog, insert latency, retry rate, rejected workers, and memory/VRAM guardrails where available.

### Decision: adapt gradually

Concurrency changes SHALL use hysteresis or cooldown to avoid oscillation. The scheduler SHOULD decrease quickly on failure pressure and increase slowly after sustained healthy throughput.

### Decision: report throttle reasons

Status SHALL include the current effective embedding concurrency, effective insert concurrency when applicable, pressure score, and the dominant throttle reason.

### Decision: preserve explicit off mode

When acceleration is off, adaptive backpressure SHALL NOT change sequential behavior.

## Risks / Trade-offs

- Bad thresholds can reduce throughput unnecessarily.
- Too many signals can make behavior hard to reason about.
- Adaptive behavior complicates benchmarks; summaries must capture effective concurrency over time.

## Migration Plan

No index migration. New behavior applies only when acceleration and adaptive backpressure are enabled.
