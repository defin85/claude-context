## 1. Pressure Model

- [x] 1.1 Define pressure inputs for insert backlog, insert latency, retry rate, rejected workers, memory, and VRAM.
- [x] 1.2 Add adaptive controller config with defaults, thresholds, hysteresis, and enable/disable switch.
- [x] 1.3 Implement effective embedding concurrency calculation from hard limits plus pressure.
- [x] 1.4 Add unit tests for pressure scoring and threshold behavior.

## 2. Scheduler Integration

- [x] 2.1 Apply effective concurrency to batch admission without changing configured hard maximums.
- [x] 2.2 Add gradual recovery after sustained healthy pressure.
- [x] 2.3 Ensure cancellation and terminal failure bypass adaptive waits cleanly.
- [x] 2.4 Preserve static behavior when adaptive backpressure is disabled or accelerator mode is off.

## 3. Observability

- [x] 3.1 Expose effective concurrency, pressure score, throttle reason, and throttle time in accelerator status.
- [x] 3.2 Add benchmark summary fields for throttle decisions and effective concurrency ranges.
- [x] 3.3 Update docs with how to interpret backpressure versus adaptive throttling.

## 4. Verification

- [x] 4.1 Run scheduler unit tests for adaptive admission, hysteresis, and static fallback.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [x] 4.3 Benchmark `examples/demo-do30-1c` before/after adaptive throttling with the same retrieval profile.
- [x] 4.4 Confirm `examples/demo-1c` avoids wall-clock regression and document the bounded `examples/demo-do30-1c` outcome without claiming unproven backpressure/retry reduction.
- [x] 4.5 Run `pnpm exec openspec validate indexing-perf-03-adaptive-indexing-backpressure --strict`.
