#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultCodebasePath = '/run/media/egor/D6B64A72B64A52E3/Projects/OneC/bp-unicom-sdd';
const defaultUnitName = 'claude-context-mcp-daemon';
const terminalStatuses = new Set(['indexed', 'indexfailed']);
const sensitiveEnvNames = new Set([
    'MCP_DAEMON_TOKEN',
    'MILVUS_TOKEN',
    'QDRANT_API_KEY',
    'OPENAI_API_KEY',
    'VOYAGEAI_API_KEY',
    'GEMINI_API_KEY'
]);

function usage() {
    console.log(`Usage:
  node scripts/measure-indexing-baseline.js [options]

Options:
  --codebase <path>       Codebase to measure (default: ${defaultCodebasePath})
  --artifact-dir <path>   Output directory (default: .artifacts/indexing-baselines)
  --interval-ms <ms>      Poll interval while measuring (default: 30000)
  --timeout-ms <ms>       Stop polling after timeout, 0 disables timeout (default: 0)
  --unit <name>           systemd --user unit name (default: ${defaultUnitName})
  --accelerator-mode <mode>
                          Accelerator mode for daemon restart: off or auto (default: off)
  --embedding-batch-size <n>
                          INDEX_EMBEDDING_BATCH_SIZE for daemon restart (default: 100)
  --insert-batch-size <n>
                          INDEX_INSERT_BATCH_SIZE for daemon restart (default: embedding batch size)
  --embedding-max-content-chars <n|auto>
                          INDEX_EMBEDDING_MAX_CONTENT_CHARS for daemon restart (default: current env/auto)
  --embedding-max-estimated-tokens <n|auto>
                          INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS for daemon restart (default: current env/auto)
  --embedding-concurrency <n>
                          INDEX_EMBEDDING_CONCURRENCY for daemon restart (default: 1)
  --insert-concurrency <n>
                          INDEX_INSERT_CONCURRENCY for daemon restart (default: 1)
  --insert-queue-capacity <n>
                          INDEX_INSERT_QUEUE_CAPACITY for daemon restart (default: 2)
  --adaptive-backpressure <bool>
                          INDEX_ADAPTIVE_BACKPRESSURE for daemon restart (default: true in auto)
  --managed-workers <bool>
                          BGE_M3_ACCELERATOR_MANAGED_WORKERS for daemon restart (default: false)
  --max-workers <n>
                          BGE_M3_ACCELERATOR_MAX_WORKERS for daemon restart (default: 1)
  --one-c-index-scope-profile <profile>
                          1C_INDEX_SCOPE_PROFILE for daemon restart and index_codebase request: full, developer, or minimal (default: full)
  --prepare-only          Recreate daemon with baseline env, do not start indexing
  --start                 Start force indexing and poll until indexed/indexfailed
  --monitor-only          Poll current indexing run without starting a new one
  --run-dir <path>        Existing run directory for --monitor-only
  --no-restart            Reuse the current daemon instead of recreating the unit
  --no-force              Do not pass force=true to index_codebase
  --cancel-on-timeout     Cancel daemon workload when timeout stops polling before terminal status
  --self-test-compact-output
                          Validate compact sample shaping and exit
  --help                  Show this help

Default daemon env overrides:
  INDEX_ACCELERATOR_MODE=<--accelerator-mode>
  INDEX_EMBEDDING_MAX_CONTENT_CHARS=<--embedding-max-content-chars when set>
  INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS=<--embedding-max-estimated-tokens when set>
  INDEX_EMBEDDING_CONCURRENCY=<--embedding-concurrency>
  INDEX_INSERT_CONCURRENCY=<--insert-concurrency>
  INDEX_INSERT_QUEUE_CAPACITY=<--insert-queue-capacity>
  INDEX_ADAPTIVE_BACKPRESSURE=<--adaptive-backpressure>
  BGE_M3_ACCELERATOR_MANAGED_WORKERS=<--managed-workers>
  BGE_M3_ACCELERATOR_MAX_WORKERS=<--max-workers>
  VECTOR_DATABASE_BACKEND=<current env or milvus>
  LANCEDB_URI=<current env when set>
  QDRANT_URL=<current env when set>
`);
}

function parseArgs(argv) {
    const options = {
        codebasePath: defaultCodebasePath,
        artifactDir: path.join(repoRoot, '.artifacts', 'indexing-baselines'),
        intervalMs: 30_000,
        timeoutMs: 0,
        unitName: defaultUnitName,
        acceleratorMode: 'off',
        embeddingBatchSize: 100,
        insertBatchSize: undefined,
        embeddingMaxContentChars: undefined,
        embeddingMaxEstimatedTokens: undefined,
        embeddingConcurrency: 1,
        insertConcurrency: 1,
        insertQueueCapacity: 2,
        adaptiveBackpressure: undefined,
        managedWorkers: false,
        maxWorkers: 1,
        oneCIndexScopeProfile: 'full',
        prepareOnly: false,
        start: false,
        monitorOnly: false,
        runDir: undefined,
        restart: true,
        force: true,
        cancelOnTimeout: false,
        selfTestCompactOutput: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        const next = () => {
            const value = argv[index + 1];
            if (!value) {
                throw new Error(`Missing value for ${current}`);
            }
            index += 1;
            return value;
        };

        switch (current) {
            case '--':
                break;
            case '--codebase':
                options.codebasePath = path.resolve(next());
                break;
            case '--artifact-dir':
                options.artifactDir = path.resolve(next());
                break;
            case '--interval-ms':
                options.intervalMs = Number(next());
                break;
            case '--timeout-ms':
                options.timeoutMs = Number(next());
                break;
            case '--unit':
                options.unitName = next();
                break;
            case '--accelerator-mode':
                options.acceleratorMode = next();
                break;
            case '--embedding-batch-size':
                options.embeddingBatchSize = Number(next());
                break;
            case '--insert-batch-size':
                options.insertBatchSize = Number(next());
                break;
            case '--embedding-max-content-chars':
                options.embeddingMaxContentChars = parsePayloadLimitArg(next(), '--embedding-max-content-chars');
                break;
            case '--embedding-max-estimated-tokens':
                options.embeddingMaxEstimatedTokens = parsePayloadLimitArg(next(), '--embedding-max-estimated-tokens');
                break;
            case '--embedding-concurrency':
                options.embeddingConcurrency = Number(next());
                break;
            case '--insert-concurrency':
                options.insertConcurrency = Number(next());
                break;
            case '--insert-queue-capacity':
                options.insertQueueCapacity = Number(next());
                break;
            case '--adaptive-backpressure':
                options.adaptiveBackpressure = parseBooleanArg(next(), '--adaptive-backpressure');
                break;
            case '--managed-workers':
                options.managedWorkers = parseBooleanArg(next(), '--managed-workers');
                break;
            case '--max-workers':
                options.maxWorkers = Number(next());
                break;
            case '--one-c-index-scope-profile':
                options.oneCIndexScopeProfile = next();
                break;
            case '--prepare-only':
                options.prepareOnly = true;
                break;
            case '--start':
                options.start = true;
                break;
            case '--monitor-only':
                options.monitorOnly = true;
                options.restart = false;
                break;
            case '--run-dir':
                options.runDir = path.resolve(next());
                break;
            case '--no-restart':
                options.restart = false;
                break;
            case '--no-force':
                options.force = false;
                break;
            case '--cancel-on-timeout':
                options.cancelOnTimeout = true;
                break;
            case '--self-test-compact-output':
                options.selfTestCompactOutput = true;
                break;
            case '--help':
            case '-h':
                usage();
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown option: ${current}`);
        }
    }

    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
        throw new Error('--interval-ms must be a positive number');
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
        throw new Error('--timeout-ms must be a non-negative number');
    }
    if (!['off', 'auto'].includes(options.acceleratorMode)) {
        throw new Error('--accelerator-mode must be off or auto');
    }
    if (!['full', 'developer', 'minimal'].includes(options.oneCIndexScopeProfile)) {
        throw new Error('--one-c-index-scope-profile must be full, developer, or minimal');
    }
    for (const [name, value] of [
        ['--embedding-batch-size', options.embeddingBatchSize],
        ['--insert-batch-size', options.insertBatchSize ?? options.embeddingBatchSize],
        ['--embedding-concurrency', options.embeddingConcurrency],
        ['--insert-concurrency', options.insertConcurrency],
        ['--insert-queue-capacity', options.insertQueueCapacity],
        ['--max-workers', options.maxWorkers],
    ]) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${name} must be a positive number`);
        }
    }
    if (options.selfTestCompactOutput) {
        return options;
    }

    const selectedModes = [options.prepareOnly, options.start, options.monitorOnly].filter(Boolean).length;
    if (selectedModes > 1) {
        throw new Error('Use only one of --prepare-only, --start, or --monitor-only');
    }
    if (selectedModes === 0) {
        options.prepareOnly = true;
    }
    if (options.runDir && !options.monitorOnly) {
        throw new Error('--run-dir is only supported with --monitor-only');
    }

    return options;
}

function parseBooleanArg(value, name) {
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new Error(`${name} must be true or false`);
}

function parsePayloadLimitArg(value, name) {
    if (value === 'auto') {
        return 'auto';
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    throw new Error(`${name} must be a positive number or auto`);
}

function selfTestCompactOutput() {
    const compacted = compactStructuredContent({
        status: 'indexing',
        accelerator: {
            retriedBatches: 2,
            failedBatches: 1,
            insertConcurrency: 2,
            insertQueueCapacity: 4,
            embeddingBatchSize: 100,
            insertBatchSize: 50,
            embeddingMaxContentChars: undefined,
            embeddingMaxEstimatedTokens: undefined,
            effectiveEmbeddingMaxContentChars: 1000000,
            effectiveEmbeddingMaxEstimatedTokens: 250000,
            queuedInsertBatches: 1,
            runningInsertBatches: 1,
            completedInsertBatches: 3,
            failedInsertBatches: 1,
            insertMs: 1234,
            retryReasons: { embedding_timeout: 1, embedding_error: 1 },
            retrySafeFailures: 2,
            retryUnsafeFailures: 0,
            activeWorkers: 1,
            rejectedWorkers: 1,
            workerLifecycle: { rejected: 1, recovered: 0, recoveryFailed: 0 },
            workers: [{
                endpoint: 'http://127.0.0.1:8000',
                poolState: 'rejected',
                healthy: false,
                inFlight: 0,
                rejectedFailureReason: 'embedding_error',
                rejectedRetrySafe: true,
                recoveryAttempts: 1,
            }],
            batches: [
                {
                    id: 1,
                    state: 'completed',
                    attempts: 1,
                    chunkCount: 100,
                    contentCharCount: 1800,
                    estimatedTokens: 450,
                    effectiveMaxContentChars: 1000000,
                    effectiveMaxEstimatedTokens: 250000,
                    payloadSplitReason: 'content_chars',
                    payloadRetrySplitCount: 1,
                    insertChunkCounts: [50, 50],
                },
                {
                    id: 2,
                    state: 'failed',
                    attempts: 2,
                    chunkCount: 100,
                    contentCharCount: 2080,
                    estimatedTokens: 520,
                    effectiveMaxContentChars: 1000000,
                    effectiveMaxEstimatedTokens: 250000,
                    payloadSplitReason: 'single_chunk_limit_exceeded',
                    payloadRetrySplitCount: 2,
                    insertChunkCounts: [50, 50],
                },
            ],
        },
    });

    if (compacted.accelerator.batches !== undefined) {
        throw new Error('Expected compacted accelerator.batches to be omitted.');
    }
    if (compacted.accelerator.batchesSummary.count !== 2) {
        throw new Error('Expected batchesSummary.count to preserve batch count.');
    }
    if (compacted.accelerator.retrySummary.retryReasons.embedding_timeout !== 1) {
        throw new Error('Expected retrySummary retry reasons to be preserved.');
    }
    if (compacted.accelerator.workerSummary.rejectedWorkers !== 1) {
        throw new Error('Expected workerSummary rejected worker count to be preserved.');
    }
    if (compacted.accelerator.insertSummary.queuedInsertBatches !== 1) {
        throw new Error('Expected insertSummary queued insert count to be preserved.');
    }
    if (compacted.accelerator.insertSummary.insertMs !== 1234) {
        throw new Error('Expected insertSummary insert timing to be preserved.');
    }
    if (compacted.accelerator.batchSizeSummary.embeddingBatchSize !== 100) {
        throw new Error('Expected batchSizeSummary embedding batch size to be preserved.');
    }
    if (compacted.accelerator.batchSizeSummary.effectiveEmbeddingMaxContentChars !== 1000000) {
        throw new Error('Expected batchSizeSummary effective content cap to be preserved.');
    }
    if (compacted.accelerator.batchesSummary.contentChars.max !== 2080) {
        throw new Error('Expected batchesSummary content characters to be summarized.');
    }
    if (compacted.accelerator.batchesSummary.tokenEstimate.max !== 520) {
        throw new Error('Expected batchesSummary token estimates to be summarized.');
    }
    if (compacted.accelerator.batchesSummary.byPayloadSplitReason.content_chars !== 1) {
        throw new Error('Expected batchesSummary payload split reasons to be counted.');
    }
    if (compacted.accelerator.batchesSummary.payloadRetrySplits.max !== 2) {
        throw new Error('Expected batchesSummary payload retry split counts to be summarized.');
    }
    if (compacted.accelerator.batchesSummary.singleChunkFatal !== true) {
        throw new Error('Expected batchesSummary single-chunk fatal flag to be preserved.');
    }
    if (compacted.accelerator.batchesSummary.latestTail[0].effectiveMaxContentChars !== 1000000) {
        throw new Error('Expected compact batch tail to preserve effective payload caps.');
    }
    if (compacted.accelerator.batchesSummary.insertChunks.max !== 50) {
        throw new Error('Expected batchesSummary insert chunk sizes to be summarized.');
    }

    const compactedStatusOnly = compactStructuredContent({
        status: 'indexing',
        accelerator: {
            embeddingBatchSize: 100,
            insertBatchSize: 100,
            retriedBatches: 1,
            failedBatches: 0,
            insertConcurrency: 1,
            insertQueueCapacity: 2,
            queuedInsertBatches: 0,
            runningInsertBatches: 1,
            completedInsertBatches: 2,
            failedInsertBatches: 0,
            insertMs: 456,
            retryReasons: { embedding_error: 1 },
            retrySafeFailures: 1,
            retryUnsafeFailures: 0,
            activeWorkers: 4,
            rejectedWorkers: 0,
            workerLifecycle: { rejected: 0, recovered: 0, recoveryFailed: 0 },
        },
    });

    if (compactedStatusOnly.accelerator.retrySummary?.retryReasons.embedding_error !== 1) {
        throw new Error('Expected retrySummary to be added when accelerator.batches is absent.');
    }
    if (compactedStatusOnly.accelerator.workerSummary?.activeWorkers !== 4) {
        throw new Error('Expected workerSummary to be added when accelerator.batches is absent.');
    }
    if (compactedStatusOnly.accelerator.insertSummary?.runningInsertBatches !== 1) {
        throw new Error('Expected insertSummary to be added when accelerator.batches is absent.');
    }
    if (compactedStatusOnly.accelerator.batchesSummary !== undefined) {
        throw new Error('Expected batchesSummary to be omitted when accelerator.batches is absent.');
    }
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        ...options,
    });
    if (result.status !== 0) {
        const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
        const stdout = result.stdout ? `\n${result.stdout.trim()}` : '';
        throw new Error(`Command failed: ${command} ${args.join(' ')}${stderr}${stdout}`);
    }
    return result.stdout || '';
}

function splitSystemdEnvironment(raw) {
    const result = [];
    let current = '';
    let quote = null;
    let escaped = false;

    for (const char of raw.trim()) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                result.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }

    if (current) {
        result.push(current);
    }
    return result;
}

function parseEnvironment(raw) {
    const env = {};
    for (const item of splitSystemdEnvironment(raw)) {
        const separator = item.indexOf('=');
        if (separator <= 0) {
            continue;
        }
        env[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return env;
}

function redactEnv(env) {
    return Object.fromEntries(Object.entries(env)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sensitiveEnvNames.has(key) && value ? '<redacted>' : value]));
}

function getCurrentServiceEnvironment(unitName) {
    const raw = run('systemctl', ['--user', 'show', `${unitName}.service`, '--property=Environment', '--value']);
    return parseEnvironment(raw);
}

function buildMeasurementEnvironment(currentEnv, options) {
    const adaptiveBackpressure = options.adaptiveBackpressure ?? (options.acceleratorMode === 'auto');
    const measurementEnv = {
        ...currentEnv,
        MCP_RUNTIME_MODE: 'daemon',
        INDEX_ACCELERATOR_MODE: options.acceleratorMode,
        INDEX_EMBEDDING_BATCH_SIZE: String(options.embeddingBatchSize),
        INDEX_INSERT_BATCH_SIZE: String(options.insertBatchSize ?? options.embeddingBatchSize),
        INDEX_EMBEDDING_CONCURRENCY: String(options.embeddingConcurrency),
        INDEX_INSERT_CONCURRENCY: String(options.insertConcurrency),
        INDEX_INSERT_QUEUE_CAPACITY: String(options.insertQueueCapacity),
        INDEX_ADAPTIVE_BACKPRESSURE: String(adaptiveBackpressure),
        BGE_M3_ACCELERATOR_MANAGED_WORKERS: String(options.managedWorkers),
        BGE_M3_ACCELERATOR_MAX_WORKERS: String(options.maxWorkers),
        VECTOR_DATABASE_BACKEND: process.env.VECTOR_DATABASE_BACKEND || currentEnv.VECTOR_DATABASE_BACKEND || 'milvus',
    };
    if (process.env.LANCEDB_URI || currentEnv.LANCEDB_URI) {
        measurementEnv.LANCEDB_URI = process.env.LANCEDB_URI || currentEnv.LANCEDB_URI;
    }
    if (process.env.QDRANT_URL || currentEnv.QDRANT_URL) {
        measurementEnv.QDRANT_URL = process.env.QDRANT_URL || currentEnv.QDRANT_URL;
    }
    if (process.env.QDRANT_API_KEY || currentEnv.QDRANT_API_KEY) {
        measurementEnv.QDRANT_API_KEY = process.env.QDRANT_API_KEY || currentEnv.QDRANT_API_KEY;
    }
    if (options.embeddingMaxContentChars !== undefined) {
        measurementEnv.INDEX_EMBEDDING_MAX_CONTENT_CHARS = String(options.embeddingMaxContentChars);
    }
    if (options.embeddingMaxEstimatedTokens !== undefined) {
        measurementEnv.INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS = String(options.embeddingMaxEstimatedTokens);
    }
    return measurementEnv;
}

function stopUnit(unitName) {
    spawnSync('systemctl', ['--user', 'stop', `${unitName}.service`], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    spawnSync('systemctl', ['--user', 'reset-failed', `${unitName}.service`], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    stopClientConfigDaemon();
}

function stopClientConfigDaemon() {
    let config;
    try {
        config = readClientConfig();
    } catch {
        return;
    }
    if (!isPidAlive(config.pid)) {
        return;
    }
    try {
        process.kill(config.pid, 'SIGTERM');
    } catch {
        return;
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && isPidAlive(config.pid)) {
        sleepSync(250);
    }
    if (isPidAlive(config.pid)) {
        process.kill(config.pid, 'SIGKILL');
    }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function startUnit(unitName, env) {
    const setEnvArgs = Object.entries(env)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `--setenv=${key}=${value}`);
    run('systemd-run', [
        '--user',
        `--unit=${unitName}`,
        '--collect',
        `--working-directory=${repoRoot}`,
        ...setEnvArgs,
        '/usr/bin/node',
        'packages/mcp/dist/index.js',
        '--mode',
        'daemon',
    ]);
}

function readClientConfig() {
    const configPath = path.join(os.homedir(), '.context', 'mcp', 'daemon', 'client-config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForDaemon(previousRuntimeId, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const config = readClientConfig();
            if (config.runtimeId !== previousRuntimeId && isPidAlive(config.pid)) {
                return config;
            }
        } catch {
            // keep polling
        }
        await sleep(250);
    }
    throw new Error('Timed out waiting for daemon client config after restart');
}

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTool(clientConfig, name, args) {
    const endpointUrl = clientConfig.endpointUrl || clientConfig.url;
    const token = clientConfig.bearerToken || clientConfig.token;
    const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name,
                arguments: args,
            },
        }),
    });
    const body = await response.text();
    const dataLine = body.split('\n').find((line) => line.startsWith('data: '));
    const payload = JSON.parse(dataLine ? dataLine.slice(6) : body);
    if (payload.error) {
        throw new Error(JSON.stringify(payload.error));
    }
    return payload.result;
}

function textFromResult(result) {
    return (result.content || [])
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n');
}

function writeJson(filePath, payload) {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function appendJsonl(filePath, payload) {
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`);
}

function compactBatch(batch) {
    if (!batch || typeof batch !== 'object') {
        return batch;
    }
    return {
        id: batch.id,
        chunkCount: batch.chunkCount,
        attempts: batch.attempts,
        state: batch.state,
        firstFile: batch.firstFile,
        lastFile: batch.lastFile,
        contentCharCount: batch.contentCharCount,
        estimatedTokens: batch.estimatedTokens,
        effectiveMaxContentChars: batch.effectiveMaxContentChars,
        effectiveMaxEstimatedTokens: batch.effectiveMaxEstimatedTokens,
        payloadSplitReason: batch.payloadSplitReason,
        payloadRetrySplitCount: batch.payloadRetrySplitCount,
        insertChunkCounts: batch.insertChunkCounts,
    };
}

function summarizeBatches(batches) {
    const byState = {};
    const byPayloadSplitReason = {};
    const chunkCounts = [];
    const contentCharCounts = [];
    const tokenEstimates = [];
    const payloadRetrySplitCounts = [];
    const insertChunkCounts = [];
    let singleChunkFatal = false;
    for (const batch of batches) {
        const state = batch?.state || 'unknown';
        byState[state] = (byState[state] || 0) + 1;
        if (batch?.payloadSplitReason) {
            byPayloadSplitReason[batch.payloadSplitReason] = (byPayloadSplitReason[batch.payloadSplitReason] || 0) + 1;
            if (batch.payloadSplitReason === 'single_chunk_limit_exceeded' && batch.state === 'failed') {
                singleChunkFatal = true;
            }
        }
        if (Number.isFinite(batch?.chunkCount)) {
            chunkCounts.push(batch.chunkCount);
        }
        if (Number.isFinite(batch?.contentCharCount)) {
            contentCharCounts.push(batch.contentCharCount);
        }
        if (Number.isFinite(batch?.estimatedTokens)) {
            tokenEstimates.push(batch.estimatedTokens);
        }
        if (Number.isFinite(batch?.payloadRetrySplitCount)) {
            payloadRetrySplitCounts.push(batch.payloadRetrySplitCount);
        }
        if (Array.isArray(batch?.insertChunkCounts)) {
            for (const count of batch.insertChunkCounts) {
                if (Number.isFinite(count)) {
                    insertChunkCounts.push(count);
                }
            }
        }
    }
    const active = batches
        .filter((batch) => batch?.state && batch.state !== 'completed')
        .slice(-10)
        .map(compactBatch);
    return {
        count: batches.length,
        byState,
        byPayloadSplitReason,
        chunkCount: summarizeNumbers(chunkCounts),
        contentChars: summarizeNumbers(contentCharCounts),
        tokenEstimate: summarizeNumbers(tokenEstimates),
        payloadRetrySplits: summarizeNumbers(payloadRetrySplitCounts),
        payloadSplitCount: Object.values(byPayloadSplitReason).reduce((sum, count) => sum + count, 0),
        singleChunkFatal,
        insertChunks: summarizeNumbers(insertChunkCounts),
        activeTail: active,
        latestTail: batches.slice(-10).map(compactBatch),
    };
}

function summarizeNumbers(values) {
    if (values.length === 0) {
        return undefined;
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: Math.round(total / values.length),
    };
}

function summarizeRetryAndWorkers(accelerator) {
    const workers = Array.isArray(accelerator.workers) ? accelerator.workers : [];
    return {
        retrySummary: {
            retriedBatches: accelerator.retriedBatches || 0,
            failedBatches: accelerator.failedBatches || 0,
            retryReasons: accelerator.retryReasons || {},
            retrySafeFailures: accelerator.retrySafeFailures || 0,
            retryUnsafeFailures: accelerator.retryUnsafeFailures || 0,
        },
        workerSummary: {
            activeWorkers: accelerator.activeWorkers || 0,
            rejectedWorkers: accelerator.rejectedWorkers || 0,
            lifecycle: accelerator.workerLifecycle || {},
            workers: workers.map((worker) => ({
                endpoint: worker.endpoint,
                poolState: worker.poolState,
                healthy: worker.healthy,
                inFlight: worker.inFlight,
                rejectedFailureReason: worker.rejectedFailureReason,
                rejectedRetrySafe: worker.rejectedRetrySafe,
                recoveryAttempts: worker.recoveryAttempts,
            })),
        },
        insertSummary: {
            insertConcurrency: accelerator.insertConcurrency || 1,
            insertQueueCapacity: accelerator.insertQueueCapacity || 0,
            queuedInsertBatches: accelerator.queuedInsertBatches || 0,
            runningInsertBatches: accelerator.runningInsertBatches || 0,
            completedInsertBatches: accelerator.completedInsertBatches || 0,
            failedInsertBatches: accelerator.failedInsertBatches || 0,
            insertMs: accelerator.insertMs || 0,
        },
        batchSizeSummary: {
            embeddingBatchSize: accelerator.embeddingBatchSize || 100,
            insertBatchSize: accelerator.insertBatchSize || accelerator.embeddingBatchSize || 100,
            embeddingMaxContentChars: accelerator.embeddingMaxContentChars,
            embeddingMaxEstimatedTokens: accelerator.embeddingMaxEstimatedTokens,
            effectiveEmbeddingMaxContentChars: accelerator.effectiveEmbeddingMaxContentChars,
            effectiveEmbeddingMaxEstimatedTokens: accelerator.effectiveEmbeddingMaxEstimatedTokens,
            totalChunks: accelerator.batchesSummary?.chunkCount?.count || accelerator.batches?.reduce((sum, batch) => sum + (batch?.chunkCount || 0), 0) || 0,
            submittedBatches: accelerator.submittedBatches || 0,
            completedBatches: accelerator.completedBatches || 0,
            failedBatches: accelerator.failedBatches || 0,
            retryRate: accelerator.submittedBatches
                ? (accelerator.retriedBatches || 0) / accelerator.submittedBatches
                : 0,
        },
        adaptiveSummary: {
            enabled: Boolean(accelerator.adaptiveBackpressureEnabled),
            configuredEmbeddingConcurrency: accelerator.configuredEmbeddingConcurrency || accelerator.embeddingConcurrency || 1,
            effectiveEmbeddingConcurrency: accelerator.effectiveEmbeddingConcurrency || accelerator.embeddingConcurrency || 1,
            configuredInsertConcurrency: accelerator.configuredInsertConcurrency || accelerator.insertConcurrency || 1,
            effectiveInsertConcurrency: accelerator.effectiveInsertConcurrency || accelerator.insertConcurrency || 1,
            pressureScore: accelerator.adaptivePressureScore || 0,
            throttleReason: accelerator.adaptiveThrottleReason || 'none',
            throttleTimeMs: accelerator.adaptiveThrottleTimeMs || 0,
            throttleEvents: accelerator.adaptiveThrottleEvents || 0,
            effectiveEmbeddingConcurrencyMin: accelerator.adaptiveEffectiveEmbeddingConcurrencyMin || accelerator.effectiveEmbeddingConcurrency || accelerator.embeddingConcurrency || 1,
            effectiveEmbeddingConcurrencyMax: accelerator.adaptiveEffectiveEmbeddingConcurrencyMax || accelerator.effectiveEmbeddingConcurrency || accelerator.embeddingConcurrency || 1,
            pressureSignals: accelerator.adaptivePressureSignals || {},
        },
    };
}

function compactStructuredContent(structuredContent) {
    if (!structuredContent || typeof structuredContent !== 'object') {
        return structuredContent;
    }

    const accelerator = structuredContent.accelerator;
    if (!accelerator || typeof accelerator !== 'object') {
        return structuredContent;
    }
    const hasBatchHistory = Array.isArray(accelerator.batches);

    return {
        ...structuredContent,
        accelerator: {
            ...accelerator,
            ...summarizeRetryAndWorkers(accelerator),
            ...(hasBatchHistory ? {
                batchesSummary: summarizeBatches(accelerator.batches),
                batches: undefined,
            } : {}),
        },
    };
}

function readJsonIfExists(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function createRunDir(artifactDir, mode) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(artifactDir, `${stamp}-${mode}`);
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
}

async function prepareDaemon(options, runDir) {
    const previousConfig = (() => {
        try {
            return readClientConfig();
        } catch {
            return null;
        }
    })();

    let serviceEnv = {};
    try {
        serviceEnv = getCurrentServiceEnvironment(options.unitName);
    } catch {
        serviceEnv = process.env;
    }

    const measurementEnv = buildMeasurementEnvironment(serviceEnv, options);

    if (options.restart) {
        stopUnit(options.unitName);
        startUnit(options.unitName, measurementEnv);
    }

    const clientConfig = await waitForDaemon(options.restart ? previousConfig?.runtimeId : undefined);
    const statusPath = clientConfig.runtimeStatusFilePath || path.join(os.homedir(), '.context', 'mcp', 'runtime', `${clientConfig.pid}.json`);
    const runtimeStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

    writeJson(path.join(runDir, 'daemon-prepared.json'), {
        preparedAt: new Date().toISOString(),
        codebasePath: options.codebasePath,
        unitName: options.unitName,
        restart: options.restart,
        daemon: {
            runtimeId: clientConfig.runtimeId,
            pid: clientConfig.pid,
            endpointUrl: clientConfig.endpointUrl,
            allowedRoots: clientConfig.allowedRoots,
            runtimeStatusFilePath: statusPath,
        },
        measurementEnv: redactEnv({
            INDEX_ACCELERATOR_MODE: measurementEnv.INDEX_ACCELERATOR_MODE,
            INDEX_EMBEDDING_BATCH_SIZE: measurementEnv.INDEX_EMBEDDING_BATCH_SIZE,
            INDEX_INSERT_BATCH_SIZE: measurementEnv.INDEX_INSERT_BATCH_SIZE,
            INDEX_EMBEDDING_MAX_CONTENT_CHARS: measurementEnv.INDEX_EMBEDDING_MAX_CONTENT_CHARS,
            INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS: measurementEnv.INDEX_EMBEDDING_MAX_ESTIMATED_TOKENS,
            INDEX_EMBEDDING_CONCURRENCY: measurementEnv.INDEX_EMBEDDING_CONCURRENCY,
            INDEX_INSERT_CONCURRENCY: measurementEnv.INDEX_INSERT_CONCURRENCY,
            INDEX_INSERT_QUEUE_CAPACITY: measurementEnv.INDEX_INSERT_QUEUE_CAPACITY,
            INDEX_ADAPTIVE_BACKPRESSURE: measurementEnv.INDEX_ADAPTIVE_BACKPRESSURE,
            BGE_M3_ACCELERATOR_MANAGED_WORKERS: measurementEnv.BGE_M3_ACCELERATOR_MANAGED_WORKERS,
            BGE_M3_ACCELERATOR_MAX_WORKERS: measurementEnv.BGE_M3_ACCELERATOR_MAX_WORKERS,
            EMBEDDING_PROVIDER: measurementEnv.EMBEDDING_PROVIDER,
            BGE_M3_MODE: measurementEnv.BGE_M3_MODE,
            BGE_M3_STORE_COLBERT: measurementEnv.BGE_M3_STORE_COLBERT,
            VECTOR_DATABASE_BACKEND: measurementEnv.VECTOR_DATABASE_BACKEND,
            LANCEDB_URI: measurementEnv.LANCEDB_URI,
            QDRANT_URL: measurementEnv.QDRANT_URL,
            QDRANT_API_KEY: measurementEnv.QDRANT_API_KEY,
            '1C_INDEX_SCOPE_PROFILE': measurementEnv['1C_INDEX_SCOPE_PROFILE'],
            MILVUS_ADDRESS: measurementEnv.MILVUS_ADDRESS,
        }),
        runtimeWorkload: runtimeStatus.workload,
        runtimeSync: runtimeStatus.sync,
    });

    return clientConfig;
}

async function measure(options, clientConfig, runDir) {
    const samplesPath = path.join(runDir, 'samples.jsonl');
    const previousSummary = options.monitorOnly
        ? readJsonIfExists(path.join(runDir, 'summary.json'))
        : null;
    const startedAt = previousSummary?.startedAt
        ? new Date(previousSummary.startedAt)
        : new Date();
    const monitorStartedAt = new Date();

    if (!options.monitorOnly) {
        const indexResult = await callTool(clientConfig, 'index_codebase', {
            path: options.codebasePath,
            force: options.force,
            oneCIndexScopeProfile: options.oneCIndexScopeProfile,
        });

        writeJson(path.join(runDir, 'index-start-response.json'), {
            capturedAt: new Date().toISOString(),
            text: textFromResult(indexResult),
            structuredContent: indexResult.structuredContent,
        });
    }

    const deadline = options.timeoutMs > 0 ? Date.now() + options.timeoutMs : Number.POSITIVE_INFINITY;
    let finalResult = null;
    let lastAcceleratorSample = null;

    while (Date.now() <= deadline) {
        const statusResult = await callTool(clientConfig, 'get_indexing_status', {
            path: options.codebasePath,
        });
        const structuredContent = compactStructuredContent(statusResult.structuredContent);
        const sample = {
            capturedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedAt.getTime(),
            text: textFromResult(statusResult),
            structuredContent,
        };
        appendJsonl(samplesPath, sample);
        finalResult = sample;
        if (hasInsertSchedulerEvidence(structuredContent?.accelerator, options.codebasePath)) {
            lastAcceleratorSample = sample;
        }

        const status = structuredContent?.status;
        if (terminalStatuses.has(status)) {
            break;
        }

        await sleep(options.intervalMs);
    }

    let cancellationResult;
    if (
        options.cancelOnTimeout &&
        finalResult?.structuredContent?.status &&
        !terminalStatuses.has(finalResult.structuredContent.status)
    ) {
        const cancelResult = await callTool(clientConfig, 'cancel_codebase_workload', {
            path: options.codebasePath,
            reason: `measure-indexing-baseline timeout after ${options.timeoutMs}ms`,
        });
        cancellationResult = {
            capturedAt: new Date().toISOString(),
            text: textFromResult(cancelResult),
            structuredContent: cancelResult.structuredContent,
        };
        writeJson(path.join(runDir, 'cancel-response.json'), cancellationResult);
    }

    const endedAt = new Date();
    const adaptiveBackpressure = options.adaptiveBackpressure ?? (options.acceleratorMode === 'auto');
    writeJson(path.join(runDir, 'summary.json'), {
        codebasePath: options.codebasePath,
        mode: options.acceleratorMode,
        oneCIndexScopeProfile: options.oneCIndexScopeProfile,
        embeddingBatchSize: options.embeddingBatchSize,
        insertBatchSize: options.insertBatchSize ?? options.embeddingBatchSize,
        embeddingMaxContentChars: options.embeddingMaxContentChars,
        embeddingMaxEstimatedTokens: options.embeddingMaxEstimatedTokens,
        embeddingConcurrency: options.embeddingConcurrency,
        insertConcurrency: options.insertConcurrency,
        insertQueueCapacity: options.insertQueueCapacity,
        adaptiveBackpressure,
        force: options.force,
        monitorOnly: options.monitorOnly,
        cancelledOnTimeout: Boolean(cancellationResult),
        startedAt: startedAt.toISOString(),
        monitorStartedAt: options.monitorOnly ? monitorStartedAt.toISOString() : undefined,
        endedAt: endedAt.toISOString(),
        wallClockMs: endedAt.getTime() - startedAt.getTime(),
        finalStatus: finalResult?.structuredContent?.status,
        insertSummary: selectInsertSummary(finalResult, lastAcceleratorSample, options.codebasePath),
        batchSizeSummary: selectBatchSizeSummary(finalResult, lastAcceleratorSample, options.codebasePath),
        adaptiveSummary: selectAdaptiveSummary(finalResult, lastAcceleratorSample, options.codebasePath),
        lastAcceleratorStructuredContent: lastAcceleratorSample?.structuredContent,
        cancellation: cancellationResult,
        finalStructuredContent: finalResult?.structuredContent,
        samplesPath,
    });
}

function hasInsertSchedulerEvidence(accelerator, codebasePath) {
    if (!accelerator) {
        return false;
    }
    if (!acceleratorMatchesCodebase(accelerator, codebasePath)) {
        return false;
    }
    const insertSummary = accelerator.insertSummary || accelerator;
    return Boolean(
        insertSummary.completedInsertBatches ||
        insertSummary.failedInsertBatches ||
        insertSummary.runningInsertBatches ||
        insertSummary.queuedInsertBatches ||
        insertSummary.insertMs,
    );
}

function acceleratorMatchesCodebase(accelerator, codebasePath) {
    const batchesSummary = accelerator?.batchesSummary;
    const batches = [
        ...(Array.isArray(batchesSummary?.activeTail) ? batchesSummary.activeTail : []),
        ...(Array.isArray(batchesSummary?.latestTail) ? batchesSummary.latestTail : []),
    ];
    if (batches.length === 0) {
        return true;
    }
    return batches.some((batch) => (
        typeof batch?.firstFile === 'string' && batch.firstFile.startsWith(codebasePath)
    ) || (
        typeof batch?.lastFile === 'string' && batch.lastFile.startsWith(codebasePath)
    ));
}

function selectInsertSummary(finalResult, lastAcceleratorSample, codebasePath) {
    const finalSummary = finalResult?.structuredContent?.accelerator?.insertSummary;
    if (hasInsertSchedulerEvidence(finalResult?.structuredContent?.accelerator, codebasePath)) {
        return finalSummary;
    }
    return lastAcceleratorSample?.structuredContent?.accelerator?.insertSummary || finalSummary;
}

function selectBatchSizeSummary(finalResult, lastAcceleratorSample, codebasePath) {
    const finalAccelerator = finalResult?.structuredContent?.accelerator;
    if (hasInsertSchedulerEvidence(finalAccelerator, codebasePath)) {
        return finalAccelerator?.batchSizeSummary;
    }
    return lastAcceleratorSample?.structuredContent?.accelerator?.batchSizeSummary
        || finalAccelerator?.batchSizeSummary;
}

function selectAdaptiveSummary(finalResult, lastAcceleratorSample, codebasePath) {
    const finalAccelerator = finalResult?.structuredContent?.accelerator;
    if (acceleratorMatchesCodebase(finalAccelerator, codebasePath)) {
        return finalAccelerator?.adaptiveSummary || finalAccelerator;
    }
    const sampledAccelerator = lastAcceleratorSample?.structuredContent?.accelerator;
    if (acceleratorMatchesCodebase(sampledAccelerator, codebasePath)) {
        return sampledAccelerator?.adaptiveSummary || sampledAccelerator;
    }
    return finalAccelerator?.adaptiveSummary || sampledAccelerator?.adaptiveSummary;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTestCompactOutput) {
        selfTestCompactOutput();
        console.log('Compact benchmark output self-test passed.');
        return;
    }
    const adaptiveBackpressure = options.adaptiveBackpressure ?? (options.acceleratorMode === 'auto');
    const payloadSlug = `maxchars${options.embeddingMaxContentChars ?? 'env'}-maxtokens${options.embeddingMaxEstimatedTokens ?? 'env'}`;
    const runDir = options.runDir || createRunDir(
        options.artifactDir,
        `${options.acceleratorMode}-scope${options.oneCIndexScopeProfile}-embbatch${options.embeddingBatchSize}-insertbatch${options.insertBatchSize ?? options.embeddingBatchSize}-${payloadSlug}-insert${options.insertConcurrency}-adaptive${adaptiveBackpressure}`,
    );
    fs.mkdirSync(runDir, { recursive: true });
    const clientConfig = options.monitorOnly
        ? readClientConfig()
        : await prepareDaemon(options, runDir);

    if (options.prepareOnly) {
        console.log(`Prepared INDEX_ACCELERATOR_MODE=${options.acceleratorMode} daemon measurement with 1C_INDEX_SCOPE_PROFILE=${options.oneCIndexScopeProfile}.`);
        console.log(`Run dir: ${runDir}`);
        console.log(`Runtime: ${clientConfig.runtimeId} pid=${clientConfig.pid}`);
        console.log(`Start measurement with: node scripts/measure-indexing-baseline.js --start --no-restart --codebase ${options.codebasePath} --one-c-index-scope-profile ${options.oneCIndexScopeProfile}`);
        return;
    }

    await measure(options, clientConfig, runDir);
    console.log(`Measurement complete. Run dir: ${runDir}`);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
