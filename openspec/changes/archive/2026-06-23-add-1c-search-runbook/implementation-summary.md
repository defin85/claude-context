# Implementation Summary

## Changes

- Added `docs/dive-deep/one-c-semantic-search-runbook.md` with an agent-facing workflow for decomposing 1C semantic searches.
- Linked the runbook from `docs/README.md` and `evaluation/README.md`.
- Added bundle-oriented role labels to `demo-bp30-1c::ssl09` in `evaluation/retrieval/universal-1c-search-matrix.json`.
- Extended evaluation scoring and reporting with required result role coverage:
  - role prefixes are validated for applicable universal matrix targets;
  - missing required roles are reported separately from strict misses;
  - ordinary Hit@k metrics remain unchanged.
- Added unit coverage for role validation, scoring, markdown reporting, and production-ranking boundary checks.

## Verification

Commands:

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
```

Result: 39/39 tests passed.

```bash
node - <<'NODE'
const path=require('path');
const {validateLabels}=require('./scripts/run-demo-1c-relevance-eval.js');
const dataset=JSON.parse(require('fs').readFileSync('evaluation/retrieval/universal-1c-search-matrix.json','utf8'));
for(const fixture of Object.keys(dataset.fixtures)){
  const validation=validateLabels(dataset,path.resolve('examples',fixture),{matrixFixture:fixture});
  console.log(JSON.stringify({
    fixture,
    needs:validation.needsInspectionCount,
    unreachable:validation.unreachablePrefixCount,
    issues:validation.issueCount,
    resultRolePrefixes:validation.resultRolePrefixCount||0,
    strictReady:validation.strictAcceptanceReady
  }));
}
NODE
```

Result: all seven fixtures reported `needs=0`, `unreachable=0`, `issues=0`, and `strictReady=true`. Only `demo-bp30-1c` currently declares result roles, with 10 reachable role prefixes.

Live `demo-bp30-1c` sanity checks used `search_code` with `rankingProfile=one-c` and `limit=10`.

Key results:

- Natural exploratory query `реализовать длительную операцию с прогрессом`: no required role in top 5, confirming it is exploration only.
- `ДлительныеОперации ВыполнитьВФоне ПараметрыВыполненияВФоне`: BSP server API rank 1.
- `ДлительныеОперацииКлиент ОжидатьЗавершение ПараметрыОжидания прогресс`: client waiting/progress rank 1.
- `ДлительныеОперацииВызовСервера состояние завершение результат`: server completion checks rank 5.
- `ВыполнитьВФоне ОжидатьЗавершение форма обработка пример`: applied usage rank 1 after source-inspected BP30 applied examples were added to the role.
