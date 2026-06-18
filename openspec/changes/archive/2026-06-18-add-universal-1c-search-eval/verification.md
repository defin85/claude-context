# Verification

Date: 2026-06-17

## Implemented Artifacts

- Dataset: `evaluation/retrieval/universal-1c-search-matrix.json`
- Scorer and validation support: `scripts/run-demo-1c-relevance-eval.js`
- One-fixture live runner wrapper: `scripts/run-universal-1c-live-mcp-eval.js`
- Saved-report combiner: `scripts/combine-universal-1c-reports.js`
- Focused tests: `scripts/run-demo-1c-relevance-eval.test.js`

## Dataset Coverage

- Fixtures: `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, `demo-unf-1c`
- Positive rows: 40
- Negative-control rows: 6
- Every matrix row has targets for all 4 fixtures.
- Positive coverage includes reports, information registers, accumulation registers, accounting registers, document posting, before-write validation, fill-on-base, exchange plans, scheduled jobs, accounting, VAT, trade, warehouse, production, retail, and money-movement scenarios where source-inspected targets were available.
- Initial source-inspected applicable coverage:
  - `demo-do30-1c`: 39 positive applicable targets plus 6 negative controls
  - `demo-bp30-1c`: 22 positive applicable targets plus 6 negative controls
  - `demo-ut-1c`: 24 positive applicable targets plus 6 negative controls
  - `demo-unf-1c`: 25 positive applicable targets plus 6 negative controls
- Unresolved manual inspection:
  - `demo-do30-1c`: 0 `needs-inspection`
  - `demo-bp30-1c`: 23 `needs-inspection`
  - `demo-ut-1c`: 21 `needs-inspection`
  - `demo-unf-1c`: 21 `needs-inspection`

## Label Validation Artifacts

Command:

```bash
node - <<'NODE'
const fs=require('fs');
const path=require('path');
const {validateLabels}=require('./scripts/run-demo-1c-relevance-eval.js');
const dataset=require('./evaluation/retrieval/universal-1c-search-matrix.json');
const outDir='.artifacts/test/universal-1c-label-validation';
fs.mkdirSync(outDir,{recursive:true});
for (const [fixture, info] of Object.entries(dataset.fixtures)) {
  const result=validateLabels(dataset, info.path, {matrixFixture: fixture});
  const out=path.join(outDir, `${fixture}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2)+'\n');
  console.log(`${fixture}: applicable=${result.applicableTargetCount} optional=${result.optionalTargetCount} notApplicable=${result.notApplicableTargetCount} needs=${result.needsInspectionCount} unreachable=${result.unreachablePrefixCount} issues=${result.issueCount} strictReady=${result.strictAcceptanceReady}`);
}
NODE
```

Result:

```text
demo-do30-1c: applicable=39 optional=0 notApplicable=7 needs=0 unreachable=0 issues=0 strictReady=true
demo-bp30-1c: applicable=22 optional=0 notApplicable=1 needs=23 unreachable=0 issues=0 strictReady=false
demo-ut-1c: applicable=24 optional=0 notApplicable=1 needs=21 unreachable=0 issues=0 strictReady=false
demo-unf-1c: applicable=25 optional=0 notApplicable=0 needs=21 unreachable=0 issues=0 strictReady=false
```

## Baseline Scoring Artifacts

Source-backed saved-result scoring was used to verify the matrix scorer, report shape, not-applicable audit trail, and per-fixture denominator handling without requiring every fixture to be reindexed through MCP. Unlike the previous deterministic report-shape artifacts, these raw saved results reference existing files under `examples/<fixture>` and contain no `__synthetic__.bsl` paths.

- Raw saved results: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/raw-results/*.json`
- Per-fixture summaries: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/*/summary.json`
- Per-fixture Markdown: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/*/summary.md`
- Per-fixture label validation: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/*/label-validation.json`
- Combined JSON: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/combined.json`
- Combined Markdown: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/combined.md`

Combined source-backed saved-result report:

```text
queryCount=86
strictHitAt10Count=86
acceptableHitAt10Count=86
negativeQueryCount=24
negativePassCount=24
negativeFailCount=0
toolErrors=0
missingColbertErrors=0
```

Per-fixture saved-result denominators:

```text
demo-do30-1c: Hit@10 33/33, negative controls 6/6, strictReady=true
demo-bp30-1c: Hit@10 16/16, negative controls 6/6, strictReady=false
demo-ut-1c: Hit@10 18/18, negative controls 6/6, strictReady=false
demo-unf-1c: Hit@10 19/19, negative controls 6/6, strictReady=false
```

The lower denominators are expected: `needs-inspection` and `not-applicable` targets are excluded from positive scoring denominators, and `not-applicable` reasons are preserved in JSON and Markdown reports.

## Live MCP

Live MCP collection was run for the already indexed `demo-do30-1c` fixture.

Command:

```bash
node scripts/run-universal-1c-live-mcp-eval.js \
  --fixture demo-do30-1c \
  --run-name 2026-06-17-demo-do30-1c-universal-1c-live \
  --allow-no-baseline-improvement
```

Artifacts:

- Raw results: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-demo-do30-1c-universal-1c-live/raw-results.json`
- Summary JSON: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-demo-do30-1c-universal-1c-live/summary.json`
- Summary Markdown: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-demo-do30-1c-universal-1c-live/summary.md`
- Label validation: `.artifacts/hybrid-code-symbol-retrieval/2026-06-17-demo-do30-1c-universal-1c-live/label-validation.json`

Result:

```text
backend=qdrant-default-live
retrievalMode=mcp-search_code
rankingProfile=one-c
Hit@10=20/33
negativeControls=6/6
toolErrors=0
missingColbertErrors=0
notApplicable=7
thresholdRecommendation=Hit@10 20/33 is valid for the current reachable label set.
```

`demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c` still have unresolved `needs-inspection` labels, so their saved-result runs use the explicit `--allow-incomplete-matrix-labels` override and are not strict acceptance evidence.

## Threshold Decisions

- No production ranking weights or thresholds were tuned for this change.
- Threshold recommendations are derived from the current measured denominator of each report, not from a hard-coded `24/30`.
- `demo-do30-1c` is strict-ready and can use its measured live recommendation: `Hit@10 20/33`.
- `demo-bp30-1c`, `demo-ut-1c`, and `demo-unf-1c` must not use their saved-result `Hit@10` counts as strict acceptance until unresolved labels are inspected or excluded.
- `needs-inspection` targets are excluded from positive scoring denominators and fail strict matrix acceptance until resolved.
- `not-applicable` targets are excluded from positive scoring denominators, and their reasons are preserved for audit in `run.labelValidation.notApplicable`, `matrix.notApplicableTargets`, and Markdown reports.
- Negative controls are reported separately from positive misses.
- The change does not require reindexing existing collections; live MCP runs can reuse existing indexed fixtures.

## Commands Run

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
```

Result: 26 tests passed.

```bash
node --check scripts/run-demo-1c-relevance-eval.js
node --check scripts/run-demo-1c-live-mcp-eval.js
node --check scripts/run-universal-1c-live-mcp-eval.js
node --check scripts/combine-universal-1c-reports.js
```

Result: passed.

```bash
node scripts/run-demo-1c-relevance-eval.js \
  --dataset evaluation/retrieval/universal-1c-search-matrix.json \
  --results .artifacts/test/universal-1c-baseline-inputs/demo-bp30-1c.json \
  --matrix-fixture demo-bp30-1c \
  --validate-labels-against examples/demo-bp30-1c \
  --out .artifacts/test/strict-acceptance-should-fail.json
```

Result: failed as expected with `Universal matrix labels are not strict-acceptance ready for demo-bp30-1c: 23 needs-inspection target(s), 0 unreachable prefix(es), 0 validation issue(s).`

```bash
node scripts/run-universal-1c-live-mcp-eval.js \
  --fixture demo-do30-1c \
  --run-name 2026-06-17-demo-do30-1c-universal-1c-live \
  --allow-no-baseline-improvement
```

Result: passed; artifacts listed in the Live MCP section.

```bash
node scripts/combine-universal-1c-reports.js \
  --reports .artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/demo-do30-1c/summary.json,.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/demo-bp30-1c/summary.json,.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/demo-ut-1c/summary.json,.artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/demo-unf-1c/summary.json \
  --out .artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/combined.json \
  --markdown-out .artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved/combined.md
```

Result: passed.

```bash
rg -n "__synthetic__" .artifacts/hybrid-code-symbol-retrieval/2026-06-17-universal-1c-source-backed-saved || true
```

Result: no matches.

```bash
pnpm build:core
pnpm typecheck
pnpm lint
pnpm build
openspec validate --type change add-universal-1c-search-eval --strict
```

Result: all passed; OpenSpec reported `Change 'add-universal-1c-search-eval' is valid`.
