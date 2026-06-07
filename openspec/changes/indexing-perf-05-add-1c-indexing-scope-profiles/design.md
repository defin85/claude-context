## Context

For 1C exported configurations, not all files carry equal search value. BSL modules are usually high-value, while some generated XML and metadata noise can dominate traversal and indexing cost. Operators need an explicit and reversible scope choice rather than hard-coded exclusions.

## Goals / Non-Goals

**Goals:**

- Provide explicit 1C-aware scope profiles.
- Reduce indexing cost for common developer search use cases.
- Persist and report scope so users know whether results are complete.
- Keep `full` behavior available and default.

**Non-Goals:**

- No semantic parsing of all metadata XML in the first version.
- No automatic profile selection.
- No deletion of existing full indexes unless reindex is explicitly requested.

## Decisions

### Decision: default to full scope

The default scope SHALL preserve existing traversal and indexing behavior. Reduced profiles require explicit config or per-call selection.

### Decision: classify by stable 1C export path conventions first

The first implementation SHALL use path-based classification for common 1C export layout elements such as `CommonModules`, `Catalogs`, `Documents`, forms, commands, manager modules, object modules, and metadata XML.

### Decision: persist scope with codebase index metadata

The selected scope profile SHALL be persisted and exposed in status so search users can distinguish full and reduced indexes.

### Decision: reduced scope requires compatibility guard

Changing between incompatible scope profiles SHALL require explicit force reindex, because indexed coverage changes.

## Risks / Trade-offs

- Reduced profiles can omit files a user expects to search.
- Path-based classification can miss unusual export layouts.
- Scope profiles complicate benchmark comparisons; artifacts must record selected scope.

## Migration Plan

Existing indexes are treated as `full` or unknown-inferred full scope. Reduced scope applies only to new or force reindex runs.
