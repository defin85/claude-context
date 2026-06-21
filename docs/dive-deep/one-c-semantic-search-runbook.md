# 1C Semantic Search Runbook

Use this runbook when an agent needs implementation context from an exported
1C configuration. The goal is not to guess one file. The goal is to collect a
small context bundle that is useful for editing or explaining code.

## Default Workflow

1. Search the user's task as written.
   Treat this as exploration. Do not stop after the first relevant result.
2. Infer 1C terms from the first results and the task domain.
   Use subsystem names, common module names, metadata names, method names,
   register names, document names, and BSP or BED API terms.
3. Run focused searches for the needed result roles.
   A typical implementation task needs API entry points, client calls, server
   calls, applied examples, and related metadata.
4. Compare results across roles.
   Prefer code from the target configuration over generic library code when
   you need an applied example.
5. Stop when the bundle is enough to answer or edit safely.
   Continue searching only for missing roles, contradictory results, or unclear
   ownership.

## Result Roles

- API module: exported library or platform-facing entry points.
- Client module: form or client common module calls, waiting, progress, and UI
  callbacks.
- Server module: server wrappers, completion checks, background-job handling,
  and validation.
- Applied usage: real documents, reports, forms, or data processors from the
  target configuration.
- Metadata: registers, constants, scheduled jobs, session parameters, and other
  objects that hold state or configuration.

Use the roles as a checklist, not as production ranking hints.

## Query Pattern

Start broad:

```text
реализовать длительную операцию с прогрессом
```

Then search with inferred 1C terms:

```text
ДлительныеОперации ВыполнитьВФоне ПараметрыВыполненияВФоне
ДлительныеОперацииКлиент ОжидатьЗавершение ПараметрыОжидания прогресс
ДлительныеОперацииВызовСервера состояние завершение результат
ВыполнитьВФоне ОжидатьЗавершение форма обработка пример
```

For other tasks, keep the same shape:

- natural user task;
- known subsystem or library terms;
- client-side calls;
- server-side calls;
- applied usage in target documents, forms, reports, or data processors;
- metadata that stores state or configuration.

## Long-Running Operations Example

For a task such as "implement a long-running operation", a useful context
bundle usually contains:

- BSP server API: `CommonModules/ДлительныеОперации/Ext/Module.bsl`;
- client waiting and progress: `CommonModules/ДлительныеОперацииКлиент/Ext/Module.bsl`;
- server completion checks: `CommonModules/ДлительныеОперацииВызовСервера/Ext/Module.bsl`;
- applied form or data processor usage from the target configuration;
- related state metadata such as `InformationRegisters/ДлительныеОперации` or
  `SessionParameters/ДлительныеОперации.xml`.

A single broad semantic query can return partial context or unrelated long
background jobs. The API-oriented searches above usually retrieve the BSP
modules first; applied-usage searches then show how the target configuration
wires those modules into real forms.

## RLM Boundary

Use semantic search first. RLM is a follow-up inspection tool after semantic
search has identified candidate modules or call sites. Do not use RLM as an
indexing enrichment path or as a replacement for production `search_code`.
