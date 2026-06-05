#!/usr/bin/env node

const path = require('path');
const fs = require('fs/promises');
const os = require('os');

function parseList(value) {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function parseInteger(value, flagName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${flagName} must be a positive integer.`);
    }
    return parsed;
}

function normalizeExtensions(extensions) {
    return [
        ...new Set(
            extensions
                .map((ext) => ext.trim())
                .filter((ext) => ext.length > 0)
                .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)),
        ),
    ];
}

function normalizePatterns(patterns) {
    return [
        ...new Set(
            patterns
                .map((pattern) => pattern.trim())
                .filter((pattern) => pattern.length > 0),
        ),
    ];
}

function getCustomExtensionsFromEnv() {
    return normalizeExtensions(parseList(process.env.CUSTOM_EXTENSIONS));
}

function getCustomIgnorePatternsFromEnv() {
    return normalizePatterns(parseList(process.env.CUSTOM_IGNORE_PATTERNS));
}

function parseArgs(argv) {
    const args = {
        root: undefined,
        extensions: undefined,
        ignore: undefined,
        hash: true,
        concurrencyValues: [undefined],
        engine: undefined,
        repeats: 1,
        format: 'json',
        useEffectiveConfig: true,
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
            args.concurrencyValues = parseList(argv[++i]).map((value) => parseInteger(value, '--concurrency'));
        } else if (arg === '--engine') {
            args.engine = argv[++i];
        } else if (arg === '--repeat' || arg === '--repeats') {
            args.repeats = parseInteger(argv[++i], arg);
        } else if (arg === '--format') {
            args.format = argv[++i];
        } else if (arg === '--ndjson') {
            args.format = 'ndjson';
        } else if (arg === '--json') {
            args.format = 'json';
        } else if (arg === '--no-effective-config') {
            args.useEffectiveConfig = false;
        } else if (!args.root) {
            args.root = arg;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!args.root) {
        throw new Error(
            'Usage: node scripts/preindex-diagnostic.js <codebasePath> ' +
            '[--extensions .ts,.js] [--ignore dist/,*.spec.ts] [--concurrency 1,8] ' +
            '[--engine ts|auto|native] [--repeat 3] [--json|--ndjson] [--no-hash] [--no-effective-config]',
        );
    }
    if (args.format !== 'json' && args.format !== 'ndjson') {
        throw new Error('--format must be json or ndjson.');
    }

    return args;
}

async function readIgnorePatterns(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));
    } catch {
        return [];
    }
}

async function findRootIgnoreFiles(root) {
    try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && entry.name.startsWith('.') && entry.name.endsWith('ignore'))
            .map((entry) => path.join(root, entry.name));
    } catch {
        return [];
    }
}

async function loadFileIgnorePatterns(root) {
    const ignoreFiles = await findRootIgnoreFiles(root);
    const globalIgnoreFile = path.join(os.homedir(), '.context', '.contextignore');
    const patterns = [];
    for (const ignoreFile of [...ignoreFiles, globalIgnoreFile]) {
        patterns.push(...await readIgnorePatterns(ignoreFile));
    }
    return normalizePatterns(patterns);
}

async function resolveTraversalConfig(defaults, root, args) {
    if (!args.useEffectiveConfig) {
        return {
            supportedExtensions: args.extensions || defaults.DEFAULT_SUPPORTED_EXTENSIONS,
            ignorePatterns: args.ignore || [],
            source: 'explicit',
        };
    }

    const fileIgnorePatterns = await loadFileIgnorePatterns(root);
    return {
        supportedExtensions: args.extensions || normalizeExtensions([
            ...defaults.DEFAULT_SUPPORTED_EXTENSIONS,
            ...getCustomExtensionsFromEnv(),
        ]),
        ignorePatterns: args.ignore || normalizePatterns([
            ...defaults.DEFAULT_IGNORE_PATTERNS,
            ...getCustomIgnorePatternsFromEnv(),
            ...fileIgnorePatterns,
        ]),
        source: 'effective',
    };
}

function summarizeUnsupportedFiles(unsupportedFilesByExtension) {
    return Object.values(unsupportedFilesByExtension || {})
        .reduce((sum, count) => sum + count, 0);
}

async function runDiagnostic(core, root, config, args, concurrency, iteration) {
    const startedAt = new Date();
    const result = await core.traversePreIndex(root, {
        supportedExtensions: config.supportedExtensions,
        ignorePatterns: config.ignorePatterns,
        includeHashes: args.hash,
        concurrency,
        engine: args.engine,
        diagnostics: true,
    });
    const diagnostics = result.diagnostics || {};

    return {
        codebasePath: result.rootDir,
        startedAt: startedAt.toISOString(),
        run: {
            iteration,
            requestedConcurrency: concurrency ?? 'auto',
            effectiveConcurrency: result.concurrency,
            includeHashes: args.hash,
            configSource: config.source,
            supportedExtensionCount: config.supportedExtensions.length,
            ignorePatternCount: config.ignorePatterns.length,
            engine: diagnostics.engine || 'ts',
            requestedEngine: diagnostics.requestedEngine || 'ts',
            engineFallbackReason: diagnostics.engineFallbackReason,
        },
        selection: {
            selectedFileCount: result.selectedFileCount,
            hashedFileCount: result.hashedFileCount,
            selectedPathFingerprint: diagnostics.selectedPathFingerprint,
            selectedPathHashFingerprint: diagnostics.selectedPathHashFingerprint,
        },
        timings: {
            preIndexScanMs: result.timings.scanMs,
            preIndexHashMs: result.timings.hashMs,
            preIndexFileListMs: result.timings.fileListMs,
            preIndexTotalMs: result.timings.totalMs,
            matcherMs: diagnostics.matcherMs ?? 0,
            splitMs: null,
            embeddingMs: null,
            insertMs: null,
        },
        diagnostics: {
            directoriesVisited: diagnostics.directoriesVisited ?? 0,
            directoryEntriesVisited: diagnostics.directoryEntriesVisited ?? 0,
            directoryReadErrors: diagnostics.directoryReadErrors ?? 0,
            filesSeen: diagnostics.filesSeen ?? 0,
            unsupportedFilesTotal: summarizeUnsupportedFiles(diagnostics.unsupportedFilesByExtension),
            unsupportedFilesByExtension: diagnostics.unsupportedFilesByExtension || {},
            ignoredDirectories: diagnostics.ignoredDirectories ?? 0,
            ignoredFiles: diagnostics.ignoredFiles ?? 0,
            hashBytes: diagnostics.hashBytes ?? 0,
            matcherCalls: diagnostics.matcherCalls ?? 0,
            matcherCacheHits: diagnostics.matcherCacheHits ?? 0,
            matcherCacheMisses: diagnostics.matcherCacheMisses ?? 0,
            matcherPatternEvaluations: diagnostics.matcherPatternEvaluations ?? 0,
            enqueuedDirectories: diagnostics.enqueuedDirectories ?? 0,
            enqueuedFiles: diagnostics.enqueuedFiles ?? 0,
            enqueuedTasks: diagnostics.enqueuedTasks ?? 0,
            completedTasks: diagnostics.completedTasks ?? 0,
            maxQueueLength: diagnostics.maxQueueLength ?? 0,
            maxActiveTasks: diagnostics.maxActiveTasks ?? 0,
        },
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const root = path.resolve(args.root);
    const core = require('../packages/core/dist/sync/preindex-traversal');
    const defaults = require('../packages/core/dist/config-defaults');
    const config = await resolveTraversalConfig(defaults, root, args);
    const results = [];

    for (const concurrency of args.concurrencyValues) {
        for (let iteration = 1; iteration <= args.repeats; iteration++) {
            const result = await runDiagnostic(core, root, config, args, concurrency, iteration);
            if (args.format === 'ndjson') {
                console.log(JSON.stringify(result));
            } else {
                results.push(result);
            }
        }
    }

    if (args.format === 'json') {
        console.log(JSON.stringify({
            codebasePath: root,
            resultCount: results.length,
            results,
        }, null, 2));
    }

    process.exit(0);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
