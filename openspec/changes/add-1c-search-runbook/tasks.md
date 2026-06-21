## 1. Runbook Documentation

- [ ] 1.1 Choose the final documentation location for the agent-facing 1C search runbook.
- [ ] 1.2 Write the concise runbook with the multi-query workflow, result roles, stopping criteria, and RLM boundary.
- [ ] 1.3 Add the long-running operations example with natural-task, BSP API, client waiting, server completion, and applied-usage searches.
- [ ] 1.4 Cross-link the runbook from the relevant 1C retrieval or evaluation documentation.

## 2. Matrix Coverage

- [ ] 2.1 Extend the universal 1C search matrix shape to represent required result roles for task-oriented context bundles.
- [ ] 2.2 Update the long-running operations matrix row so `demo-bp30-1c` declares source-inspected roles for BSP server API, client waiting/progress, server completion checks, and applied usage.
- [ ] 2.3 Keep role labels in evaluation data only; verify production search code does not read them.

## 3. Evaluation Support

- [ ] 3.1 Update matrix validation so every role prefix for an applicable target must exist under the fixture path.
- [ ] 3.2 Update scoring/reporting so missing bundle roles are reported separately from ordinary strict misses.
- [ ] 3.3 Add or update tests for matrix loading, role validation, and long-running operations coverage counts.

## 4. Verification

- [ ] 4.1 Run the universal matrix unit test suite.
- [ ] 4.2 Run a live `demo-bp30-1c` semantic-search sanity check for the long-running operations runbook queries.
- [ ] 4.3 Record the verification commands and key results in the implementation summary.
