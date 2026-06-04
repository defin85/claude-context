#!/usr/bin/env node

const path = require('path');

function parseList(value) {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function parseArgs(argv) {
    const args = {
        root: undefined,
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.m', '.mm', '.bsl', '.os', '.md', '.markdown', '.ipynb'],
        ignore: [],
        hash: true,
        concurrency: undefined,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--') {
            continue;
        } else if (arg === '--extensions') {
            args.extensions = parseList(argv[++i]);
        } else if (arg === '--ignore') {
            args.ignore = parseList(argv[++i]);
        } else if (arg === '--no-hash') {
            args.hash = false;
        } else if (arg === '--concurrency') {
            args.concurrency = Number.parseInt(argv[++i], 10);
        } else if (!args.root) {
            args.root = arg;
        }
    }

    if (!args.root) {
        throw new Error('Usage: node scripts/preindex-diagnostic.js <codebasePath> [--extensions .ts,.js] [--ignore dist/,*.spec.ts] [--concurrency 8] [--no-hash]');
    }

    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const core = require('../packages/core/dist');
    const result = await core.traversePreIndex(path.resolve(args.root), {
        supportedExtensions: args.extensions,
        ignorePatterns: args.ignore,
        includeHashes: args.hash,
        concurrency: args.concurrency,
    });

    console.log(JSON.stringify({
        codebasePath: result.rootDir,
        selectedFileCount: result.selectedFileCount,
        hashedFileCount: result.hashedFileCount,
        concurrency: result.concurrency,
        timings: {
            preIndexScanMs: result.timings.scanMs,
            preIndexHashMs: result.timings.hashMs,
            preIndexFileListMs: result.timings.fileListMs,
            preIndexTotalMs: result.timings.totalMs,
            splitMs: null,
            embeddingMs: null,
            insertMs: null,
        },
    }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
