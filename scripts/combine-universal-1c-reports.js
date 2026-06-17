#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { positional: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args.positional.push(arg);
      continue;
    }
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function addGroupTotals(target, source) {
  for (const [groupName, groups] of Object.entries(source || {})) {
    target[groupName] ||= {};
    for (const [key, value] of Object.entries(groups)) {
      target[groupName][key] ||= {
        queryCount: 0,
        failures: 0,
        strictHitAt10Count: 0,
        acceptableHitAt10Count: 0,
      };
      target[groupName][key].queryCount += value.queryCount || 0;
      target[groupName][key].failures += value.failures || 0;
      target[groupName][key].strictHitAt10Count += value.strict?.hitAt10Count || 0;
      target[groupName][key].acceptableHitAt10Count += value.acceptable?.hitAt10Count || 0;
    }
  }
}

function buildMarkdown(combined) {
  const lines = [];
  lines.push('# Universal 1C search matrix report');
  lines.push('');
  lines.push(`- Reports: ${combined.reportCount}`);
  lines.push(`- Fixtures: ${combined.fixtureCount}`);
  lines.push(`- Positive queries: ${combined.totals.queryCount}`);
  lines.push(`- Strict Hit@10: ${combined.totals.strictHitAt10Count}/${combined.totals.queryCount}`);
  lines.push(`- Acceptable Hit@10: ${combined.totals.acceptableHitAt10Count}/${combined.totals.queryCount}`);
  lines.push(`- Negative controls: ${combined.totals.negativePassCount}/${combined.totals.negativeQueryCount} passed`);
  lines.push(`- Tool errors: ${combined.totals.toolErrors}`);
  lines.push(`- Missing ColBERT vector errors: ${combined.totals.missingColbertErrors}`);
  lines.push('');
  lines.push('| fixture | strict hit@10 | acceptable hit@10 | negatives | backend | ranking profile |');
  lines.push('| --- | ---: | ---: | ---: | --- | --- |');
  for (const report of combined.reports) {
    lines.push(`| ${report.fixtureKey} | ${report.strictHitAt10Count}/${report.queryCount} | ${report.acceptableHitAt10Count}/${report.queryCount} | ${report.negativePassCount}/${report.negativeQueryCount} | ${report.backendLabel || ''} | ${report.rankingProfile || ''} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const reportPaths = [
    ...String(args.reports || '').split(',').map((item) => item.trim()).filter(Boolean),
    ...args.positional,
  ];
  if (reportPaths.length === 0) {
    console.error('Usage: combine-universal-1c-reports.js --reports <summary-a.json,summary-b.json> [--out combined.json] [--markdown-out combined.md]');
    process.exit(2);
  }
  const summaries = reportPaths.map((reportPath) => ({
    path: reportPath,
    summary: readJson(reportPath),
  }));
  const fixtures = new Set();
  const grouped = {};
  const combined = {
    dataset: 'universal-1c-search-matrix',
    generatedAt: new Date().toISOString(),
    reportCount: summaries.length,
    fixtureCount: 0,
    totals: {
      queryCount: 0,
      strictHitAt10Count: 0,
      acceptableHitAt10Count: 0,
      negativeQueryCount: 0,
      negativePassCount: 0,
      negativeFailCount: 0,
      toolErrors: 0,
      missingColbertErrors: 0,
    },
    reports: [],
    grouped,
  };

  for (const { path: reportPath, summary } of summaries) {
    const fixtureKey = summary.matrix?.fixtureKey || summary.run?.matrixFixture || path.basename(summary.fixture || reportPath);
    fixtures.add(fixtureKey);
    const report = {
      path: reportPath,
      fixtureKey,
      queryCount: summary.metrics?.queryCount || 0,
      strictHitAt10Count: summary.metrics?.strict?.hitAt10Count || summary.metrics?.hitAt10Count || 0,
      acceptableHitAt10Count: summary.metrics?.acceptable?.hitAt10Count || 0,
      negativeQueryCount: summary.negativeControls?.queryCount || 0,
      negativePassCount: summary.negativeControls?.passCount || 0,
      negativeFailCount: summary.negativeControls?.failCount || 0,
      backendLabel: summary.run?.backendLabel,
      retrievalMode: summary.run?.retrievalMode,
      rankingProfile: summary.run?.rankingProfile,
      indexStatus: summary.run?.indexStatus,
      toolErrors: summary.run?.rawSummary?.toolErrors || 0,
      missingColbertErrors: summary.run?.rawSummary?.missingColbertErrors || 0,
    };
    combined.reports.push(report);
    combined.totals.queryCount += report.queryCount;
    combined.totals.strictHitAt10Count += report.strictHitAt10Count;
    combined.totals.acceptableHitAt10Count += report.acceptableHitAt10Count;
    combined.totals.negativeQueryCount += report.negativeQueryCount;
    combined.totals.negativePassCount += report.negativePassCount;
    combined.totals.negativeFailCount += report.negativeFailCount;
    combined.totals.toolErrors += report.toolErrors;
    combined.totals.missingColbertErrors += report.missingColbertErrors;
    addGroupTotals(grouped, summary.grouped);
  }
  combined.fixtureCount = fixtures.size;

  const output = JSON.stringify(combined, null, 2);
  if (args.out) {
    writeJson(args.out, combined);
  } else {
    process.stdout.write(`${output}\n`);
  }
  if (args.markdownOut) {
    fs.mkdirSync(path.dirname(args.markdownOut), { recursive: true });
    fs.writeFileSync(args.markdownOut, buildMarkdown(combined), 'utf8');
  }
}

if (require.main === module) {
  main();
}
