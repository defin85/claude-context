## 1. Pressure Model

- [ ] 1.1 Define pressure inputs for insert backlog, insert latency, retry rate, rejected workers, memory, and VRAM.
- [ ] 1.2 Add adaptive controller config with defaults, thresholds, hysteresis, and enable/disable switch.
- [ ] 1.3 Implement effective embedding concurrency calculation from hard limits plus pressure.
- [ ] 1.4 Add unit tests for pressure scoring and threshold behavior.

## 2. Scheduler Integration

- [ ] 2.1 Apply effective concurrency to batch admission without changing configured hard maximums.
- [ ] 2.2 Add gradual recovery after sustained healthy pressure.
- [ ] 2.3 Ensure cancellation and terminal failure bypass adaptive waits cleanly.
- [ ] 2.4 Preserve static behavior when adaptive backpressure is disabled or accelerator mode is off.

## 3. Observability

- [ ] 3.1 Expose effective concurrency, pressure score, throttle reason, and throttle time in accelerator status.
- [ ] 3.2 Add benchmark summary fields for throttle decisions and effective concurrency ranges.
- [ ] 3.3 Update docs with how to interpret backpressure versus adaptive throttling.

## 4. Verification

- [ ] 4.1 Run scheduler unit tests for adaptive admission, hysteresis, and static fallback.
- [ ] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- [ ] 4.3 Benchmark `examples/demo-do30-1c` before/after adaptive throttling with the same retrieval profile.
- [ ] 4.4 Confirm adaptive mode reduces backpressure/retry churn without regressing wall-clock on `examples/demo-1c`.
- [ ] 4.5 Run `pnpm exec openspec validate indexing-perf-03-adaptive-indexing-backpressure --strict`.
