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

Deterministic saved-result scoring was used to verify the matrix scorer and report shape without live MCP calls or reindexing.

- Inputs: `.artifacts/test/universal-1c-baseline-inputs/*.json`
- Per-fixture summaries: `.artifacts/test/universal-1c-baseline-summaries/*.json`
- Per-fixture Markdown: `.artifacts/test/universal-1c-baseline-summaries/*.md`
- Combined JSON: `.artifacts/test/universal-1c-baseline-summaries/combined.json`
- Combined Markdown: `.artifacts/test/universal-1c-baseline-summaries/combined.md`

Combined deterministic report-shape result. Runs for fixtures with unresolved `needs-inspection` targets use the explicit `--allow-incomplete-matrix-labels` override and are not strict acceptance evidence.

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

## Commands Run

```bash
node --test scripts/run-demo-1c-relevance-eval.test.js
```

Result: 24 tests passed.

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
pnpm build:core
pnpm typecheck
pnpm lint
pnpm build
openspec validate --type change add-universal-1c-search-eval --strict
```

Result: all passed; OpenSpec reported `Change 'add-universal-1c-search-eval' is valid`.

## Threshold Decisions

- No production ranking weights or thresholds were tuned for this change.
- `needs-inspection` targets are excluded from positive scoring denominators and fail strict matrix acceptance until resolved. Exploratory saved-report generation can opt in to `--allow-incomplete-matrix-labels`; this does not make the run acceptance evidence.
- `not-applicable` targets are excluded from positive scoring denominators.
- Negative controls are reported separately from positive misses.
- The change does not require reindexing existing collections; live MCP runs can reuse existing indexed fixtures.

## Live MCP

Live MCP collection was not run for this verification pass. The implementation adds `scripts/run-universal-1c-live-mcp-eval.js` for one-fixture live runs and records backend label, retrieval mode, ranking profile, index status, latency, MCP tool errors, and missing ColBERT vector errors when those fields are available from live reports.
