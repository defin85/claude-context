## Context

The current 1C retrieval stack already supports indexed exported configurations, BGE-M3 full retrieval, lexical/symbol fusion, and `one-c` ranking signals. Recent live checks on `demo-bp30-1c` showed that exact API-oriented searches for BSP long-running operations return strong results, while a single natural-language task query returns partial context and noise.

The useful agent behavior is therefore procedural rather than architectural: use semantic search as an exploration tool with multiple focused queries, then assemble results by role before editing code. This change captures that behavior as a runbook and adds evaluation coverage to keep the runbook grounded in real fixtures.

## Goals / Non-Goals

**Goals:**

- Provide an agent-facing runbook for semantic search in exported 1C repositories.
- Make the runbook short enough to use during normal coding tasks.
- Preserve the existing "semantic search first, RLM only for deeper follow-up" workflow.
- Add evaluation coverage that checks whether the long-running operations scenario can retrieve a useful context bundle.

**Non-Goals:**

- Add an LLM-based query planner.
- Add RLM calls to indexing or production search.
- Replace `search_code` ranking with scenario-specific production rules.
- Change BGE-M3 storage, Qdrant/Milvus schemas, or existing indexed collection compatibility.
- Require existing indexes to be rebuilt.

## Decisions

1. **Document a deterministic runbook instead of introducing a planner.**

   Agents already have enough context to issue several searches. A static runbook avoids extra latency, cost, and nondeterminism while still improving retrieval behavior.

2. **Use query roles instead of scenario-specific recipes.**

   The runbook will teach agents to search for:
   - the user's natural task;
   - inferred 1C/BSP terms;
   - client-side calls;
   - server-side calls;
   - applied examples;
   - related metadata when state or configuration is involved.

   This generalizes beyond long-running operations without hard-coding a separate recipe for every domain.

3. **Validate the runbook with bundle-oriented matrix coverage.**

   The universal matrix should be able to express that a useful answer requires several result roles. For long-running operations, the expected bundle includes the BSP API module, the client waiting/progress module, the server wrapper, and applied form examples.

4. **Keep production search label-free.**

   Matrix labels remain evaluation truth only. They must not become production ranking rules, query rewrites, or hidden search hints.

## Risks / Trade-offs

- **Risk: The runbook becomes too long to follow.** -> Keep the default path to 4-6 searches and put examples in a compact checklist.
- **Risk: Agents still use one broad query.** -> Add matrix and test coverage that demonstrates why bundle retrieval matters.
- **Risk: Evaluation overfits to long-running operations.** -> Define bundle roles generically, with long-running operations as the first concrete acceptance case.
- **Risk: More searches add latency.** -> The runbook is for agent workflows where answer quality matters; it should recommend stopping once the role bundle is sufficient.

## Migration Plan

No runtime or index migration is required. Existing indexed collections continue to work because the change affects documentation and evaluation data only.
