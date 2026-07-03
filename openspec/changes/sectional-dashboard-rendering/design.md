## Context

The web dashboard frontend is a small TypeScript application in `packages/web-dashboard/src/main.ts`. It currently keeps one state object, polls daemon and selected-codebase status every five seconds, and calls a single `render()` function when the full refresh fingerprint changes.

That `render()` replaces `#app` with `root.innerHTML = ...`. The approach is simple and avoids framework dependencies, but it destroys normal browser selection in static text, result snippets, diagnostics, and logs whenever active indexing changes status often enough to trigger a render.

## Goals / Non-Goals

**Goals:**

- Preserve unchanged dashboard DOM sections across periodic refreshes.
- Keep text selection stable in unchanged result snippets, logs, paths, and diagnostics.
- Keep the current no-framework browser TypeScript implementation.
- Keep dashboard polling, daemon API contracts, authentication, indexing behavior, and retrieval behavior unchanged.
- Add focused tests for the section-diffing behavior.

**Non-Goals:**

- No React, Svelte, or other UI framework.
- No server-side rendering or streaming status channel.
- No change to dashboard API response shapes.
- No change to indexed collections, BGE-M3 retrieval modes, ranking, or storage layout.

## Decisions

### Decision: render stable sections instead of the whole root

Create a static application shell once, with named section containers for:

- metrics/status grid;
- codebase list;
- selected-codebase toolbar;
- operations;
- worker telemetry;
- notices and operator log;
- profile diagnostics;
- search controls;
- search results.

Each section gets a small render function that returns its HTML and a fingerprint derived only from the data it uses. A section updates its `innerHTML` only when its fingerprint changes.

Selectable text must not share a replace boundary with controls whose markup changes only because of `busy`, disabled state, or polling metadata. In practice, keep path text, result snippets, diagnostics, and the log list in their own stable containers, separate from action buttons such as index, cancel, clear, copy diagnostics, and search.

Alternative considered: keep one full `root.innerHTML` and skip auto-render while any text is selected. That is a useful emergency guard, but it lets the displayed status go stale during selection and still leaves full DOM replacement as the normal path.

### Decision: keep lightweight section templates

Continue using string templates and `innerHTML`, but scope replacement to a section. This keeps the change small and avoids new build, dependency, and component lifecycle concerns.

Alternative considered: migrate to React or Svelte. That would solve reconciliation more generally, but the dashboard is still small and does not justify adding a framework for this fix.

### Decision: protect selectable sections by content identity

Search results, operator log, diagnostics, and static path text are treated as selectable sections. If their fingerprint is unchanged, their DOM nodes must not be replaced by polling renders. Frequently changing indexing metrics and progress panels can update independently.

Alternative considered: capture and restore global text selection. Restoring arbitrary `Selection` ranges across replaced nodes is brittle and unnecessary if unchanged selectable nodes are kept alive.

If a parent section needs to update controls, but the selected text container is unchanged, update the control subsection separately instead of replacing the parent.

### Decision: keep storage and latency behavior unchanged

The refactor is browser-only. It does not affect dense-only BGE-M3, full BGE-M3 dense+sparse+ColBERT, indexed collection storage, vector writes, or search latency. Browser work may decrease during active indexing because unchanged sections are not rebuilt; status freshness stays tied to the existing five-second polling interval.

## Risks / Trade-offs

- Risk: Section fingerprints omit a field and a section fails to update. -> Mitigation: keep fingerprints close to the section render functions and add tests for representative refresh changes.
- Risk: Event handlers are lost for a replaced section. -> Mitigation: re-bind handlers after section updates, or use event delegation from stable parent nodes.
- Risk: Manual section rendering adds more bookkeeping than one `render()`. -> Mitigation: keep a tiny helper for `renderSection(id, fingerprint, html)` and avoid a generic component system.
- Risk: Text selection can still disappear when the selected section truly changes. -> Mitigation: this is expected; only unchanged selectable content is preserved.

## Migration Plan

1. Add stable shell creation and section render helpers.
2. Move existing markup into section render functions with section-level fingerprints.
3. Change refresh and user actions to update only affected sections.
4. Add tests that prove unchanged search results or log DOM is not replaced during status-only refresh.
5. Run the web-dashboard test/typecheck/build commands and OpenSpec validation.

Rollback is straightforward: restore the current single `render()` path. No persisted data or indexed collections require migration.

## Open Questions

None.
