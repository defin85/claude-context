#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultArtifactDir = path.join(repoRoot, '.artifacts', 'bge-m3-vector-backend-benchmark');
const defaultBackends = ['milvus-current', 'qdrant-native', 'lancedb-native'];
const schemaVersion = 1;
const parityStatusPassed = 'passed';
const parityStatusFailed = 'failed';
const parityStatusSkipped = 'skipped';
const parityStatusNotRun = 'not_run';
const defaultParityQueryCount = 5;
const defaultParityTopK = 10;
const defaultParityCandidateLimit = 50;
const defaultParityMinOverlap = 0.5;

class SkipRunError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'SkipRunError';
        this.details = details;
    }
}

function usage() {
    console.log(`Usage:
  node scripts/benchmark-bge-m3-vector-backends.js --generate-fixture --codebase <path> --fixture <path> [options]
  node scripts/benchmark-bge-m3-vector-backends.js --run --fixture <path> [options]
  node scripts/benchmark-bge-m3-vector-backends.js --self-test

Modes:
  --generate-fixture              Capture a canonical post-embedding BGE-M3 VectorDocument fixture.
  --run                           Replay a fixture into selected backend candidates.
  --self-test                     Run a synthetic fixture through dry-run and forced-skip candidates.

Fixture options:
  --codebase <path>               Codebase root for fixture capture.
  --fixture <path>                Fixture path to write/read.
  --dataset <name>                Dataset name (default: codebase basename or fixture dataset).
  --one-c-index-scope-profile <p> 1C scope profile: full, developer, minimal (default: developer).
  --expected-chunks <n>           Fail closed unless fixture chunk count matches this value.
  --accept-chunk-count            Accept chunk-count drift and record it in metadata.
  --bounded                       Mark generated fixture/run as bounded.
  --bounded-reason <text>         Boundary reason for bounded fixtures/runs.
  --bge-m3-endpoint <url>         BGE-M3 sidecar endpoint (default: BGE_M3_ENDPOINT).
  --bge-m3-worker-endpoints <csv> Optional BGE-M3 worker endpoints.
  --timeout-ms <ms>               Abort fixture generation after timeout.
  --synthetic-fixture             Generate a tiny synthetic fixture instead of scanning codebase.

Run options:
  --backends <csv>                Backends: milvus-current,qdrant-native,lancedb-native,dry-run,parity-miss,forced-skip.
  --skip-backend <name>           Mark a selected backend skipped before execution; repeatable.
  --batch-size <n>                Documents per write request (default: 100).
  --artifact-dir <path>           Output root (default: .artifacts/bge-m3-vector-backend-benchmark).
  --collection-prefix <prefix>    Temporary collection/table prefix (default: bge_m3_bench).
  --cleanup                       Drop/delete temporary backend collections when supported.

Backend options:
  --milvus-address <addr>         Milvus address (default: MILVUS_ADDRESS or localhost:19530).
  --milvus-token-env <name>       Env var containing Milvus token (default: MILVUS_TOKEN).
  --milvus-username-env <name>    Env var containing Milvus username.
  --milvus-password-env <name>    Env var containing Milvus password.
  --qdrant-url <url>              Qdrant URL (default: QDRANT_URL or http://localhost:6333).
  --qdrant-api-key-env <name>     Env var containing Qdrant API key.
  --lancedb-uri <path>            LanceDB URI (default: artifact-dir/lancedb).

Examples:
  node scripts/benchmark-bge-m3-vector-backends.js --self-test
  node scripts/benchmark-bge-m3-vector-backends.js --generate-fixture --codebase examples/demo-1c --dataset demo-1c --expected-chunks 893 --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json
  node scripts/benchmark-bge-m3-vector-backends.js --run --fixture .artifacts/bge-m3-vector-backend-benchmark/fixtures/demo-1c.json --backends milvus-current,qdrant-native,lancedb-native
`);
}

function parseArgs(argv) {
    const options = {
        mode: undefined,
        codebasePath: undefined,
        fixturePath: undefined,
        dataset: undefined,
        oneCIndexScopeProfile: 'developer',
        expectedChunks: undefined,
        acceptChunkCount: false,
        bounded: false,
        boundedReason: undefined,
        bgeM3Endpoint: process.env.BGE_M3_ENDPOINT,
        bgeM3WorkerEndpoints: parseCsv(process.env.BGE_M3_WORKER_ENDPOINTS || ''),
        timeoutMs: 0,
        syntheticFixture: false,
        backends: [...defaultBackends],
        skipBackends: new Set(),
        batchSize: 100,
        artifactDir: defaultArtifactDir,
        collectionPrefix: 'bge_m3_bench',
        cleanup: false,
        milvusAddress: process.env.MILVUS_ADDRESS || 'localhost:19530',
        milvusTokenEnv: 'MILVUS_TOKEN',
        milvusUsernameEnv: undefined,
        milvusPasswordEnv: undefined,
        qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
        qdrantApiKeyEnv: undefined,
        lancedbUri: undefined,
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
            case '--generate-fixture':
                options.mode = setMode(options.mode, 'generate-fixture');
                break;
            case '--run':
                options.mode = setMode(options.mode, 'run');
                break;
            case '--self-test':
                options.mode = setMode(options.mode, 'self-test');
                break;
            case '--codebase':
                options.codebasePath = path.resolve(next());
                break;
            case '--fixture':
                options.fixturePath = path.resolve(next());
                break;
            case '--dataset':
                options.dataset = next();
                break;
            case '--one-c-index-scope-profile':
                options.oneCIndexScopeProfile = next();
                break;
            case '--expected-chunks':
                options.expectedChunks = parsePositiveInteger(next(), current);
                break;
            case '--accept-chunk-count':
                options.acceptChunkCount = true;
                break;
            case '--bounded':
                options.bounded = true;
                break;
            case '--bounded-reason':
                options.boundedReason = next();
                break;
            case '--bge-m3-endpoint':
                options.bgeM3Endpoint = next();
                break;
            case '--bge-m3-worker-endpoints':
                options.bgeM3WorkerEndpoints = parseCsv(next());
                break;
            case '--timeout-ms':
                options.timeoutMs = parseNonNegativeInteger(next(), current);
                break;
            case '--synthetic-fixture':
                options.syntheticFixture = true;
                break;
            case '--backends':
                options.backends = parseCsv(next());
                break;
            case '--skip-backend':
                options.skipBackends.add(next());
                break;
            case '--batch-size':
                options.batchSize = parsePositiveInteger(next(), current);
                break;
            case '--artifact-dir':
                options.artifactDir = path.resolve(next());
                break;
            case '--collection-prefix':
                options.collectionPrefix = sanitizeName(next(), 'bge_m3_bench');
                break;
            case '--cleanup':
                options.cleanup = true;
                break;
            case '--milvus-address':
                options.milvusAddress = next();
                break;
            case '--milvus-token-env':
                options.milvusTokenEnv = next();
                break;
            case '--milvus-username-env':
                options.milvusUsernameEnv = next();
                break;
            case '--milvus-password-env':
                options.milvusPasswordEnv = next();
                break;
            case '--qdrant-url':
                options.qdrantUrl = next();
                break;
            case '--qdrant-api-key-env':
                options.qdrantApiKeyEnv = next();
                break;
            case '--lancedb-uri':
                options.lancedbUri = path.resolve(next());
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

    if (!options.mode) {
        throw new Error('Select one of --generate-fixture, --run, or --self-test.');
    }
    if (!['full', 'developer', 'minimal'].includes(options.oneCIndexScopeProfile)) {
        throw new Error('--one-c-index-scope-profile must be full, developer, or minimal.');
    }
    if (options.backends.length === 0) {
        throw new Error('--backends must include at least one backend.');
    }
    if (!options.lancedbUri) {
        options.lancedbUri = path.join(options.artifactDir, 'lancedb');
    }
    if (options.bounded && !options.boundedReason) {
        options.boundedReason = 'bounded flag supplied';
    }

    return options;
}

function setMode(currentMode, nextMode) {
    if (currentMode && currentMode !== nextMode) {
        throw new Error('Use only one mode flag.');
    }
    return nextMode;
}

function parseCsv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parsePositiveInteger(value, name) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return parsed;
}

function parseNonNegativeInteger(value, name) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer.`);
    }
    return parsed;
}

function sanitizeName(value, fallback) {
    const sanitized = String(value || '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96);
    return sanitized || fallback;
}

function stableStringify(value) {
    return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value) {
    if (Array.isArray(value)) {
        return value.map(sortForStableStringify);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = sortForStableStringify(value[key]);
                return result;
            }, {});
    }
    return value;
}

function sha256Json(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function byteLength(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function summarizeNumbers(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return { min: 0, max: 0, mean: 0, p50: 0, p95: 0 };
    }
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: sum / sorted.length,
        p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
        p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
    };
}

function computeFixtureStats(documents) {
    const denseDimensions = [...new Set(documents.map((document) => document.vector?.length || 0))].sort((a, b) => a - b);
    const sparseNnz = documents.map((document) => document.sparseVector?.indices?.length || 0);
    const colbertVectorCounts = documents.map((document) => document.colbertVectors?.length || 0);
    const colbertDimensions = [
        ...new Set(documents.flatMap((document) => (document.colbertVectors || []).map((vector) => vector.length))),
    ].sort((a, b) => a - b);

    return {
        chunkCount: documents.length,
        denseDimensions,
        sparseNnz: summarizeNumbers(sparseNnz),
        colbertVectorCounts: summarizeNumbers(colbertVectorCounts),
        colbertDimensions,
        contentBytes: documents.reduce((sum, document) => sum + Buffer.byteLength(document.content || '', 'utf8'), 0),
        metadataBytes: documents.reduce((sum, document) => sum + byteLength(document.metadata || {}), 0),
    };
}

function buildFixture({ dataset, sourcePath, scopeProfile, bounded, boundedReason, documents, generation }) {
    const stats = computeFixtureStats(documents);
    const fixture = {
        schemaVersion,
        generatedAt: new Date().toISOString(),
        dataset: {
            name: dataset,
            sourcePath,
            oneCIndexScopeProfile: scopeProfile,
            bounded,
            boundedReason: bounded ? boundedReason : undefined,
        },
        generation,
        stats,
        documents,
    };
    return refreshFixtureChecksum(fixture);
}

function refreshFixtureChecksum(fixture) {
    fixture.checksum = sha256Json({
        schemaVersion: fixture.schemaVersion,
        dataset: fixture.dataset,
        generation: fixture.generation,
        documents: fixture.documents,
    });
    return fixture;
}

function validateFixtureChunkCount(fixture, options) {
    if (!options.expectedChunks) {
        return;
    }
    const actual = fixture.documents.length;
    if (actual === options.expectedChunks) {
        fixture.generation.expectedChunks = options.expectedChunks;
        fixture.generation.chunkCountAccepted = true;
        return;
    }
    fixture.generation.expectedChunks = options.expectedChunks;
    fixture.generation.chunkCountAccepted = options.acceptChunkCount;
    fixture.generation.chunkCountDrift = {
        expected: options.expectedChunks,
        actual,
    };
    if (!options.acceptChunkCount) {
        throw new Error(
            `Fixture chunk count drift: expected ${options.expectedChunks}, got ${actual}. ` +
            'Use --accept-chunk-count to record accepted drift.',
        );
    }
}

async function writeJson(filePath, data) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, records) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const content = records.map((record) => JSON.stringify(record)).join('\n');
    await fsp.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
}

async function loadFixture(filePath) {
    const fixture = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    if (!Array.isArray(fixture.documents)) {
        throw new Error(`Fixture ${filePath} is missing documents array.`);
    }
    const storedChecksum = fixture.checksum;
    const checksum = sha256Json({
        schemaVersion: fixture.schemaVersion,
        dataset: fixture.dataset,
        generation: fixture.generation,
        documents: fixture.documents,
    });
    return {
        ...fixture,
        storedChecksum,
        checksum,
        checksumMatchesStored: storedChecksum === checksum,
    };
}

function makeSyntheticDocuments() {
    return [
        {
            id: 'synthetic-001',
            vector: [0.1, 0.2, 0.3, 0.4],
            sparseVector: { indices: [1, 7], values: [0.8, 0.2] },
            colbertVectors: [[0.1, 0.2], [0.3, 0.4]],
            content: 'Procedure SyntheticOne() Export\n    Message("hello");\nEndProcedure',
            relativePath: 'CommonModules/Synthetic/Module.bsl',
            startLine: 1,
            endLine: 3,
            fileExtension: '.bsl',
            metadata: { language: 'bsl', chunkIndex: 0, retrievalMode: 'bge_m3_full', retrievalSchemaVersion: 1 },
        },
        {
            id: 'synthetic-002',
            vector: [0.4, 0.3, 0.2, 0.1],
            sparseVector: { indices: [2, 9, 11], values: [0.5, 0.25, 0.125] },
            colbertVectors: [[0.4, 0.3], [0.2, 0.1], [0.6, 0.6]],
            content: 'Function SyntheticTwo(Value) Export\n    Return Value;\nEndFunction',
            relativePath: 'CommonModules/SyntheticTwo/Module.bsl',
            startLine: 1,
            endLine: 3,
            fileExtension: '.bsl',
            metadata: { language: 'bsl', chunkIndex: 1, retrievalMode: 'bge_m3_full', retrievalSchemaVersion: 1 },
        },
        {
            id: 'synthetic-003',
            vector: [0.9, 0.1, 0.1, 0.2],
            sparseVector: { indices: [5], values: [1] },
            colbertVectors: [[0.9, 0.1]],
            content: 'Catalog synthetic metadata fixture',
            relativePath: 'Catalogs/Synthetic/Object.xml',
            startLine: 1,
            endLine: 1,
            fileExtension: '.xml',
            metadata: { language: 'xml', chunkIndex: 2, retrievalMode: 'bge_m3_full', retrievalSchemaVersion: 1 },
        },
    ];
}

function createSyntheticFixture(options = {}) {
    return buildFixture({
        dataset: options.dataset || 'synthetic',
        sourcePath: options.codebasePath || '<synthetic>',
        scopeProfile: options.oneCIndexScopeProfile || 'developer',
        bounded: Boolean(options.bounded),
        boundedReason: options.boundedReason,
        documents: makeSyntheticDocuments(),
        generation: {
            kind: 'synthetic',
            callPath: 'scripts/benchmark-bge-m3-vector-backends.js:createSyntheticFixture',
        },
    });
}

class CapturingVectorDatabase {
    constructor() {
        this.documents = [];
        this.collectionName = undefined;
        this.dimension = undefined;
        this.description = undefined;
    }

    async hasCollection() {
        return false;
    }

    async dropCollection() {}

    async createCollection() {
        throw new Error('Fixture capture requires BGE-M3 full mode, not dense collection creation.');
    }

    async createHybridCollection() {
        throw new Error('Fixture capture requires BGE-M3 full mode, not hybrid BM25 collection creation.');
    }

    async createBgeM3Collection(collectionName, dimension, description) {
        this.collectionName = collectionName;
        this.dimension = dimension;
        this.description = description;
    }

    async insert() {
        throw new Error('Fixture capture requires BGE-M3 insertBgeM3 path.');
    }

    async insertHybrid() {
        throw new Error('Fixture capture requires BGE-M3 insertBgeM3 path.');
    }

    async insertBgeM3(_collectionName, documents) {
        this.documents.push(...documents.map((document) => JSON.parse(JSON.stringify(document))));
    }

    async listCollections() {
        return [];
    }

    async search() {
        return [];
    }

    async hybridSearch() {
        return [];
    }

    async bgeM3HybridSearch() {
        return [];
    }

    async query() {
        return [];
    }

    async delete() {}

    async getCollectionDescription() {
        return this.description || '';
    }
}

async function requireCoreDist() {
    const corePath = path.join(repoRoot, 'packages', 'core', 'dist', 'index.js');
    if (!fs.existsSync(corePath)) {
        throw new Error('packages/core/dist/index.js does not exist. Run pnpm build:core first.');
    }
    return require(corePath);
}

async function captureFixtureFromCodebase(options) {
    if (!options.bgeM3Endpoint) {
        throw new Error('--bge-m3-endpoint or BGE_M3_ENDPOINT is required for real fixture capture.');
    }
    const core = await requireCoreDist();
    const embedding = new core.BgeM3Embedding({
        endpoint: options.bgeM3Endpoint,
        workerEndpoints: options.bgeM3WorkerEndpoints,
        mode: 'full',
    });
    const vectorDatabase = new CapturingVectorDatabase();
    const context = new core.Context({
        embedding,
        vectorDatabase,
    });
    context.configureCodebaseSession(options.codebasePath, {
        oneCIndexScopeProfile: options.oneCIndexScopeProfile,
    });

    const controller = new AbortController();
    let timeout;
    if (options.timeoutMs > 0) {
        timeout = setTimeout(() => controller.abort(`fixture generation timeout ${options.timeoutMs}ms`), options.timeoutMs);
    }
    try {
        const result = await context.indexCodebase(
            options.codebasePath,
            (progress) => {
                if (progress.percentage === 100 || progress.percentage % 25 === 0) {
                    console.log(`[fixture] ${progress.phase} ${progress.percentage}%`);
                }
            },
            true,
            controller.signal,
        );
        return buildFixture({
            dataset: options.dataset || path.basename(options.codebasePath),
            sourcePath: options.codebasePath,
            scopeProfile: options.oneCIndexScopeProfile,
            bounded: Boolean(options.bounded || result.status === 'limit_reached'),
            boundedReason: options.boundedReason || (result.status === 'limit_reached' ? `CODE_CHUNK_LIMIT=${result.codeChunkLimit}` : undefined),
            documents: vectorDatabase.documents,
            generation: {
                kind: 'context-capture',
                callPath: [
                    'Context.indexCodebase',
                    'Context.processFileList',
                    'Context.buildPreparedChunkBatchInsert',
                    'VectorDatabase.insertBgeM3(CapturingVectorDatabase)',
                ],
                collectionName: vectorDatabase.collectionName,
                detectedDimension: vectorDatabase.dimension,
                contextResult: result,
            },
        });
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

async function generateFixture(options) {
    if (!options.fixturePath) {
        throw new Error('--fixture is required for --generate-fixture.');
    }
    if (!options.syntheticFixture && !options.codebasePath) {
        throw new Error('--codebase is required unless --synthetic-fixture is supplied.');
    }

    const fixture = options.syntheticFixture
        ? createSyntheticFixture(options)
        : await captureFixtureFromCodebase(options);
    validateFixtureChunkCount(fixture, options);
    refreshFixtureChecksum(fixture);
    await writeJson(options.fixturePath, fixture);
    console.log(JSON.stringify({
        fixturePath: options.fixturePath,
        dataset: fixture.dataset.name,
        chunkCount: fixture.documents.length,
        checksum: fixture.checksum,
        bounded: fixture.dataset.bounded,
    }, null, 2));
}

function sparsePayload(document) {
    if (!document.sparseVector) {
        return undefined;
    }
    return document.sparseVector.indices.reduce((payload, index, itemIndex) => {
        payload[index] = document.sparseVector.values[itemIndex];
        return payload;
    }, {});
}

function milvusCurrentEntities(documents) {
    return documents.map((document) => ({
        id: document.id,
        content: document.content,
        dense_vector: document.vector,
        sparse_vector: sparsePayload(document),
        colbert_vectors: JSON.stringify(document.colbertVectors || []),
        relativePath: document.relativePath,
        startLine: document.startLine,
        endLine: document.endLine,
        fileExtension: document.fileExtension,
        metadata: JSON.stringify(document.metadata || {}),
    }));
}

function qdrantPoints(documents, offset) {
    return documents.map((document, index) => ({
        id: offset + index + 1,
        vector: {
            dense: document.vector,
            sparse: document.sparseVector || { indices: [], values: [] },
            colbert: document.colbertVectors || [],
        },
        payload: {
            id: document.id,
            content: document.content,
            relativePath: document.relativePath,
            startLine: document.startLine,
            endLine: document.endLine,
            fileExtension: document.fileExtension,
            metadata: document.metadata || {},
        },
    }));
}

function lanceRows(documents) {
    return documents.map((document) => ({
        id: document.id,
        content: document.content,
        dense_vector: document.vector,
        sparse_indices: document.sparseVector?.indices || [],
        sparse_values: document.sparseVector?.values || [],
        colbert_vectors: document.colbertVectors || [],
        relativePath: document.relativePath,
        startLine: document.startLine,
        endLine: document.endLine,
        fileExtension: document.fileExtension,
        metadata_json: JSON.stringify(document.metadata || {}),
    }));
}

function splitBatches(documents, batchSize) {
    const batches = [];
    for (let index = 0; index < documents.length; index += batchSize) {
        batches.push({
            offset: index,
            documents: documents.slice(index, index + batchSize),
        });
    }
    return batches;
}

function makeCollectionName(options, fixture, backend) {
    const dataset = sanitizeName(fixture.dataset?.name || 'dataset', 'dataset');
    const suffix = crypto.randomBytes(4).toString('hex');
    return sanitizeName(`${options.collectionPrefix}_${dataset}_${backend}_${suffix}`, 'bge_m3_bench');
}

function readSecretFromEnv(name) {
    return name ? process.env[name] : undefined;
}

function redactedEnvRef(name) {
    return name && process.env[name] ? { env: name, set: true } : name ? { env: name, set: false } : undefined;
}

function startRssSampler(intervalMs = 50) {
    let peak = process.memoryUsage().rss;
    const samples = [{ atMs: 0, rss: peak }];
    const started = process.hrtime.bigint();
    const timer = setInterval(() => {
        const rss = process.memoryUsage().rss;
        const atMs = Number(process.hrtime.bigint() - started) / 1e6;
        peak = Math.max(peak, rss);
        samples.push({ atMs, rss });
    }, intervalMs);
    return {
        startedRss: peak,
        stop() {
            clearInterval(timer);
            const rss = process.memoryUsage().rss;
            peak = Math.max(peak, rss);
            samples.push({ atMs: Number(process.hrtime.bigint() - started) / 1e6, rss });
            return {
                startedRss: samples[0].rss,
                endingRss: rss,
                peakRss: peak,
                rssDelta: rss - samples[0].rss,
                sampleCount: samples.length,
            };
        },
    };
}

function tryResolveModule(name, extraBase) {
    const paths = [
        repoRoot,
        path.join(repoRoot, 'packages', 'core'),
        path.join(repoRoot, 'packages', 'mcp'),
        ...(extraBase ? [extraBase] : []),
    ];
    try {
        return require.resolve(name, { paths });
    } catch {
        return undefined;
    }
}

function readPackageVersion(packagePath) {
    try {
        return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
    } catch {
        return undefined;
    }
}

async function fetchJson(url, init = {}) {
    if (!globalThis.fetch) {
        throw new Error('global fetch is unavailable in this Node runtime.');
    }
    const response = await globalThis.fetch(url, init);
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : undefined;
    } catch {
        body = text;
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}: ${text.slice(0, 500)}`);
    }
    return body;
}

function getVectorShape(fixture) {
    const first = fixture.documents[0];
    const denseDimension = first?.vector?.length || 0;
    const firstColbert = fixture.documents.find((document) => document.colbertVectors?.[0]);
    const colbertDimension = firstColbert?.colbertVectors?.[0]?.length || 0;
    return { denseDimension, colbertDimension };
}

function selectParityBaselineBackend(backends) {
    if (backends.includes('milvus-current')) {
        return 'milvus-current';
    }
    if (backends.includes('dry-run')) {
        return 'dry-run';
    }
    return 'milvus-current';
}

function orderBackendsForParity(backends, baselineBackend) {
    if (!backends.includes(baselineBackend)) {
        return backends;
    }
    return [
        baselineBackend,
        ...backends.filter((backend) => backend !== baselineBackend),
    ];
}

function buildParityQueries(fixture, queryCount = defaultParityQueryCount) {
    const eligibleDocuments = fixture.documents
        .filter((document) => (
            document.id &&
            Array.isArray(document.vector) &&
            document.vector.length > 0 &&
            document.sparseVector &&
            Array.isArray(document.sparseVector.indices) &&
            Array.isArray(document.sparseVector.values) &&
            Array.isArray(document.colbertVectors) &&
            document.colbertVectors.length > 0
        ))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    if (eligibleDocuments.length === 0) {
        return [];
    }

    const selectedIndexes = new Set();
    const slots = Math.min(queryCount, eligibleDocuments.length);
    if (slots === 1) {
        selectedIndexes.add(0);
    } else {
        for (let index = 0; index < slots; index += 1) {
            selectedIndexes.add(Math.round((index * (eligibleDocuments.length - 1)) / (slots - 1)));
        }
    }

    return [...selectedIndexes]
        .sort((left, right) => left - right)
        .map((documentIndex, index) => {
            const document = eligibleDocuments[documentIndex];
            return {
                queryId: `fixture-doc-${index + 1}`,
                source: 'fixture-document',
                sourceDocumentId: document.id,
                expectedIds: [document.id],
                relativePath: document.relativePath,
                startLine: document.startLine,
                denseVector: document.vector,
                sparseVector: document.sparseVector,
                colbertVectors: document.colbertVectors,
                vectorShape: {
                    denseDimension: document.vector.length,
                    sparseNnz: document.sparseVector.indices.length,
                    colbertVectorCount: document.colbertVectors.length,
                    colbertDimension: document.colbertVectors[0]?.length || 0,
                },
            };
        });
}

function buildParityOptions(fixture, backends) {
    const topK = Math.min(defaultParityTopK, Math.max(1, fixture.documents.length));
    return {
        baselineBackend: selectParityBaselineBackend(backends),
        topK,
        candidateLimit: Math.max(topK, defaultParityCandidateLimit),
        minOverlap: defaultParityMinOverlap,
        queries: buildParityQueries(fixture, defaultParityQueryCount),
    };
}

function dotProduct(left, right) {
    const length = Math.min(left.length, right.length);
    let score = 0;
    for (let index = 0; index < length; index += 1) {
        score += left[index] * right[index];
    }
    return score;
}

function scoreColbertMaxSim(queryVectors, documentVectors) {
    if (!Array.isArray(queryVectors) || !Array.isArray(documentVectors) || queryVectors.length === 0 || documentVectors.length === 0) {
        return 0;
    }

    let totalScore = 0;
    for (const queryVector of queryVectors) {
        let maxScore = Number.NEGATIVE_INFINITY;
        for (const documentVector of documentVectors) {
            maxScore = Math.max(maxScore, dotProduct(queryVector, documentVector));
        }
        totalScore += maxScore;
    }
    return totalScore / queryVectors.length;
}

function rerankByColbert(queryColbertVectors, candidates, limit) {
    return candidates
        .filter((candidate) => Array.isArray(candidate.colbertVectors) && candidate.colbertVectors.length > 0)
        .map((candidate) => ({
            ...candidate,
            firstStageScore: candidate.score,
            score: scoreColbertMaxSim(queryColbertVectors, candidate.colbertVectors),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
}

function compactResult(result, rank) {
    return {
        rank,
        id: result.id,
        score: Number.isFinite(result.score) ? result.score : undefined,
        firstStageScore: Number.isFinite(result.firstStageScore) ? result.firstStageScore : undefined,
        relativePath: result.relativePath,
        startLine: result.startLine,
    };
}

function makeSearchResultFromDocument(document, score) {
    return {
        id: document.id,
        score,
        relativePath: document.relativePath,
        startLine: document.startLine,
        colbertVectors: document.colbertVectors,
    };
}

async function runParitySearch(adapter, queries, parityOptions) {
    const results = [];
    for (const query of queries) {
        const started = process.hrtime.bigint();
        try {
            const backendResults = await adapter.search(query, parityOptions);
            results.push({
                queryId: query.queryId,
                elapsedMs: elapsedMs(started),
                results: backendResults.slice(0, parityOptions.topK),
                error: null,
            });
        } catch (error) {
            results.push({
                queryId: query.queryId,
                elapsedMs: elapsedMs(started),
                results: [],
                error: serializeError(error),
            });
        }
    }
    return results;
}

function buildSearchParityReport(backendName, parityOptions, searchResults, baselineReport) {
    const isBaseline = backendName === parityOptions.baselineBackend;
    const baselineByQuery = new Map((baselineReport?.queries || []).map((query) => [query.queryId, query]));
    const queryById = new Map(parityOptions.queries.map((query) => [query.queryId, query]));

    const queries = searchResults.map((searchResult) => {
        const query = queryById.get(searchResult.queryId);
        const returnedResults = searchResult.results.map((result, index) => compactResult(result, index + 1));
        const returnedIds = returnedResults.map((result) => result.id);
        const expectedIds = query?.expectedIds || [];
        const expectedMissingIds = expectedIds.filter((id) => !returnedIds.includes(id));
        const baselineQuery = isBaseline ? undefined : baselineByQuery.get(searchResult.queryId);
        const baselineIds = baselineQuery?.returnedIds || [];
        const overlapIds = isBaseline ? returnedIds : baselineIds.filter((id) => returnedIds.includes(id));
        const missingIds = isBaseline
            ? expectedMissingIds
            : baselineIds.filter((id) => !returnedIds.includes(id));
        const overlapRatio = isBaseline
            ? 1
            : (baselineIds.length > 0 ? overlapIds.length / baselineIds.length : 0);
        const rankDeltas = isBaseline ? [] : overlapIds.map((id) => {
            const baselineRank = baselineIds.indexOf(id) + 1;
            const candidateRank = returnedIds.indexOf(id) + 1;
            return {
                id,
                baselineRank,
                candidateRank,
                delta: candidateRank - baselineRank,
                absoluteDelta: Math.abs(candidateRank - baselineRank),
            };
        });
        const rankDrift = summarizeNumbers(rankDeltas.map((delta) => delta.absoluteDelta));
        const passed = !searchResult.error &&
            expectedMissingIds.length === 0 &&
            (isBaseline || (baselineIds.length > 0 && overlapRatio >= parityOptions.minOverlap));

        return {
            queryId: searchResult.queryId,
            sourceDocumentId: query?.sourceDocumentId,
            relativePath: query?.relativePath,
            startLine: query?.startLine,
            expectedIds,
            returnedIds,
            returnedResults,
            baselineReturnedIds: isBaseline ? undefined : baselineIds,
            overlapIds,
            overlapRatio,
            minOverlap: isBaseline ? undefined : parityOptions.minOverlap,
            missingIds,
            expectedMissingIds,
            rankDeltas,
            rankDrift,
            elapsedMs: searchResult.elapsedMs,
            passed,
            error: searchResult.error,
        };
    });

    const failedQueries = queries.filter((query) => !query.passed);
    return {
        status: failedQueries.length === 0 ? parityStatusPassed : parityStatusFailed,
        mode: 'fixture-vector-search',
        backend: backendName,
        role: isBaseline ? 'baseline' : 'candidate',
        baselineBackend: parityOptions.baselineBackend,
        topK: parityOptions.topK,
        candidateLimit: parityOptions.candidateLimit,
        minOverlap: parityOptions.minOverlap,
        querySource: 'fixture vectors',
        queryCount: parityOptions.queries.length,
        summary: {
            passedQueries: queries.length - failedQueries.length,
            failedQueries: failedQueries.length,
            minOverlapObserved: queries.length > 0 ? Math.min(...queries.map((query) => query.overlapRatio)) : 0,
        },
        queries,
    };
}

function buildSkippedSearchParityReport(backendName, parityOptions, reason, details = {}) {
    return {
        status: parityStatusSkipped,
        backend: backendName,
        baselineBackend: parityOptions.baselineBackend,
        reason,
        details,
        topK: parityOptions.topK,
        candidateLimit: parityOptions.candidateLimit,
        minOverlap: parityOptions.minOverlap,
        queryCount: parityOptions.queries.length,
        queries: [],
    };
}

async function evaluateSearchParity(adapter, backendName, parityOptions, baselineReport) {
    if (!adapter.search) {
        return {
            status: parityStatusNotRun,
            backend: backendName,
            baselineBackend: parityOptions.baselineBackend,
            reason: 'Backend adapter does not implement search parity.',
        };
    }
    if (parityOptions.queries.length === 0) {
        return buildSkippedSearchParityReport(
            backendName,
            parityOptions,
            'No fixture documents have dense, sparse, and ColBERT vectors for parity queries.',
        );
    }
    if (backendName !== parityOptions.baselineBackend && baselineReport?.status !== parityStatusPassed) {
        return buildSkippedSearchParityReport(
            backendName,
            parityOptions,
            'Milvus baseline search parity is unavailable or failed.',
            { baselineStatus: baselineReport?.status },
        );
    }

    const searchResults = await runParitySearch(adapter, parityOptions.queries, parityOptions);
    return buildSearchParityReport(backendName, parityOptions, searchResults, baselineReport);
}

function buildAdapter(name, options, fixture, collectionName) {
    if (name === 'dry-run') {
        return buildInProcessAdapter('dry-run', collectionName);
    }
    if (name === 'parity-miss') {
        return buildInProcessAdapter('parity-miss', collectionName, { omitExpectedIds: true });
    }
    if (name === 'forced-skip') {
        return {
            name,
            async setup() {
                throw new SkipRunError('Forced skip requested by backend selection.', { backend: name });
            },
            buildRequestPayload(batch) {
                return { skipped: true, documents: batch.documents.length };
            },
        };
    }
    if (name === 'milvus-current') {
        return buildMilvusAdapter(options, fixture, collectionName);
    }
    if (name === 'qdrant-native') {
        return buildQdrantAdapter(options, fixture, collectionName);
    }
    if (name === 'lancedb-native') {
        return buildLanceDbAdapter(options, collectionName);
    }
    throw new Error(`Unknown backend '${name}'.`);
}

function buildInProcessAdapter(name, collectionName, behavior = {}) {
    const writtenIds = [];
    const writtenDocuments = new Map();
    return {
        name,
        async setup() {
            return {
                kind: 'in-process',
                collectionName,
                schema: 'VectorDocument JSON replay',
                behavior,
            };
        },
        buildRequestPayload(batch) {
            return { collectionName, data: batch.documents };
        },
        async writeBatch(_payload, batch) {
            writtenIds.push(...batch.documents.map((document) => document.id));
            for (const document of batch.documents) {
                writtenDocuments.set(document.id, document);
            }
        },
        async finalize() {},
        async search(query, parityOptions) {
            const expected = query.expectedIds[0];
            const candidateIds = [
                expected,
                ...writtenIds.filter((id) => id !== expected),
            ].filter((id) => writtenDocuments.has(id));
            const returnedIds = behavior.omitExpectedIds
                ? candidateIds.filter((id) => !query.expectedIds.includes(id))
                : candidateIds;
            return returnedIds
                .slice(0, parityOptions.candidateLimit)
                .map((id, index) => makeSearchResultFromDocument(writtenDocuments.get(id), 1 / (index + 1)));
        },
    };
}

function buildMilvusAdapter(options, fixture, collectionName) {
    let database;
    return {
        name: 'milvus-current',
        async setup() {
            const modulePath = path.join(repoRoot, 'packages', 'core', 'dist', 'vectordb', 'milvus-vectordb.js');
            if (!fs.existsSync(modulePath)) {
                throw new SkipRunError('Milvus adapter requires packages/core/dist/vectordb/milvus-vectordb.js. Run pnpm build:core first.');
            }
            let milvusModule;
            try {
                milvusModule = require(modulePath);
            } catch (error) {
                throw new SkipRunError(`Milvus SDK path is unavailable: ${error.message}`, {
                    modulePath,
                    sdkResolved: Boolean(tryResolveModule('@zilliz/milvus2-sdk-node')),
                });
            }
            const { denseDimension } = getVectorShape(fixture);
            database = new milvusModule.MilvusVectorDatabase({
                address: options.milvusAddress,
                token: readSecretFromEnv(options.milvusTokenEnv),
                username: readSecretFromEnv(options.milvusUsernameEnv),
                password: readSecretFromEnv(options.milvusPasswordEnv),
            });
            if (await database.hasCollection(collectionName)) {
                await database.dropCollection(collectionName);
            }
            await database.createBgeM3Collection(
                collectionName,
                denseDimension,
                `BGE-M3 backend benchmark fixture=${fixture.checksum}`,
            );
            return {
                kind: 'milvus-sdk-current',
                address: options.milvusAddress,
                collectionName,
                packageVersion: readPackageVersion(path.join(repoRoot, 'packages', 'core', 'package.json')),
                sdkModuleResolved: Boolean(tryResolveModule('@zilliz/milvus2-sdk-node')),
                token: redactedEnvRef(options.milvusTokenEnv),
                username: redactedEnvRef(options.milvusUsernameEnv),
                password: redactedEnvRef(options.milvusPasswordEnv),
                schema: {
                    denseField: 'dense_vector',
                    sparseField: 'sparse_vector',
                    colbertField: 'colbert_vectors',
                    colbertStorage: 'JSON string VarChar payload',
                    flush: 'insertBgeM3 calls flushSync after each insert call',
                },
            };
        },
        buildRequestPayload(batch) {
            return {
                collection_name: collectionName,
                data: milvusCurrentEntities(batch.documents),
            };
        },
        async writeBatch(_payload, batch) {
            await database.insertBgeM3(collectionName, batch.documents);
        },
        async search(query, parityOptions) {
            const searchResults = await database.bgeM3HybridSearch(
                collectionName,
                [
                    {
                        data: query.denseVector,
                        anns_field: 'dense_vector',
                        param: { nprobe: 10 },
                        limit: parityOptions.candidateLimit,
                    },
                    {
                        data: query.sparseVector,
                        anns_field: 'sparse_vector',
                        param: { drop_ratio_search: 0.2 },
                        limit: parityOptions.candidateLimit,
                    },
                ],
                {
                    rerank: {
                        strategy: 'rrf',
                        params: { k: 100 },
                    },
                    limit: parityOptions.candidateLimit,
                },
            );
            return rerankByColbert(
                query.colbertVectors,
                searchResults.map((result) => ({
                    id: result.document.id,
                    score: result.score,
                    relativePath: result.document.relativePath,
                    startLine: result.document.startLine,
                    colbertVectors: result.document.colbertVectors,
                })),
                parityOptions.topK,
            );
        },
        async cleanup() {
            if (options.cleanup && database) {
                await database.dropCollection(collectionName);
            }
        },
    };
}

function buildQdrantAdapter(options, fixture, collectionName) {
    const { denseDimension, colbertDimension } = getVectorShape(fixture);
    const baseUrl = options.qdrantUrl.replace(/\/+$/, '');
    const headers = { 'content-type': 'application/json' };
    const apiKey = readSecretFromEnv(options.qdrantApiKeyEnv);
    if (apiKey) {
        headers['api-key'] = apiKey;
    }
    const collectionUrl = `${baseUrl}/collections/${encodeURIComponent(collectionName)}`;
    return {
        name: 'qdrant-native',
        async setup() {
            if (!globalThis.fetch) {
                throw new SkipRunError('Qdrant REST adapter requires global fetch.');
            }
            let version;
            try {
                version = await fetchJson(baseUrl, { headers: withoutContentType(headers) });
            } catch (error) {
                throw new SkipRunError(`Qdrant service is unavailable at ${baseUrl}: ${error.message}`, {
                    url: baseUrl,
                });
            }
            await fetchJson(collectionUrl, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    vectors: {
                        dense: {
                            size: denseDimension,
                            distance: 'Cosine',
                        },
                        colbert: {
                            size: colbertDimension,
                            distance: 'Cosine',
                            multivector_config: {
                                comparator: 'max_sim',
                            },
                        },
                    },
                    sparse_vectors: {
                        sparse: {
                            index: {
                                on_disk: false,
                            },
                        },
                    },
                }),
            });
            return {
                kind: 'qdrant-rest-native',
                url: baseUrl,
                collectionName,
                version,
                apiKey: redactedEnvRef(options.qdrantApiKeyEnv),
                schema: {
                    dense: { name: 'dense', size: denseDimension, distance: 'Cosine' },
                    sparse: { name: 'sparse', onDisk: false },
                    colbert: { name: 'colbert', size: colbertDimension, comparator: 'max_sim' },
                    pointId: 'numeric ordinal; stable document id preserved in payload.id',
                },
            };
        },
        buildRequestPayload(batch) {
            return { points: qdrantPoints(batch.documents, batch.offset) };
        },
        async writeBatch(payload) {
            await fetchJson(`${collectionUrl}/points?wait=true`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload),
            });
        },
        async search(query, parityOptions) {
            const response = await fetchJson(`${collectionUrl}/points/query`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prefetch: [
                        {
                            query: query.denseVector,
                            using: 'dense',
                            limit: parityOptions.candidateLimit,
                        },
                        {
                            query: query.sparseVector,
                            using: 'sparse',
                            limit: parityOptions.candidateLimit,
                        },
                        {
                            query: query.colbertVectors,
                            using: 'colbert',
                            limit: parityOptions.candidateLimit,
                        },
                    ],
                    query: { fusion: 'rrf' },
                    limit: parityOptions.topK,
                    with_payload: true,
                    with_vector: false,
                }),
            });
            return qdrantResponsePoints(response).map((point) => ({
                id: point.payload?.id || String(point.id),
                score: point.score,
                relativePath: point.payload?.relativePath,
                startLine: point.payload?.startLine,
            }));
        },
        async cleanup() {
            if (options.cleanup) {
                await fetchJson(collectionUrl, { method: 'DELETE', headers: withoutContentType(headers) });
            }
        },
    };
}

function qdrantResponsePoints(response) {
    if (Array.isArray(response?.result)) {
        return response.result;
    }
    if (Array.isArray(response?.result?.points)) {
        return response.result.points;
    }
    return [];
}

function withoutContentType(headers) {
    const copy = { ...headers };
    delete copy['content-type'];
    return copy;
}

function buildLanceDbAdapter(options, collectionName) {
    let lancedb;
    let table;
    let arrow;
    let schema;
    return {
        name: 'lancedb-native',
        async setup() {
            const modulePath = tryResolveModule('@lancedb/lancedb');
            if (!modulePath) {
                throw new SkipRunError('LanceDB adapter requires optional package @lancedb/lancedb.');
            }
            try {
                lancedb = require(modulePath);
                arrow = require(require.resolve('apache-arrow', { paths: [modulePath] }));
            } catch (error) {
                throw new SkipRunError(`LanceDB package could not be loaded: ${error.message}`, { modulePath });
            }
            schema = buildLanceDbSchema(arrow, options.currentFixture);
            await fsp.mkdir(options.lancedbUri, { recursive: true });
            return {
                kind: 'lancedb-local',
                uri: options.lancedbUri,
                tableName: collectionName,
                modulePath,
                schema: {
                    dense: 'dense_vector',
                    sparse: ['sparse_indices', 'sparse_values'],
                    colbert: 'colbert_vectors List<FixedSizeList<Float32>>',
                    metadata: 'metadata_json',
                },
            };
        },
        buildRequestPayload(batch) {
            return {
                tableName: collectionName,
                rows: lanceRows(batch.documents),
            };
        },
        async writeBatch(payload) {
            const arrowTable = lancedb.makeArrowTable(payload.rows, { schema });
            if (!table) {
                const db = await lancedb.connect(options.lancedbUri);
                table = await db.createTable(collectionName, arrowTable, { mode: 'overwrite' });
                return;
            }
            await table.add(arrowTable);
        },
        async search(query, parityOptions) {
            if (!table) {
                const db = await lancedb.connect(options.lancedbUri);
                table = await db.openTable(collectionName);
            }
            const rows = await table
                .vectorSearch(query.colbertVectors)
                .column('colbert_vectors')
                .limit(parityOptions.topK)
                .toArray();
            return rows.map((row) => ({
                id: row.id,
                score: Number.isFinite(row._distance) ? -row._distance : undefined,
                relativePath: row.relativePath,
                startLine: row.startLine,
            }));
        },
        async cleanup() {
            if (!options.cleanup) {
                return;
            }
            try {
                const db = await lancedb.connect(options.lancedbUri);
                if (typeof db.dropTable === 'function') {
                    await db.dropTable(collectionName);
                }
            } catch {
                // Cleanup is best-effort for optional local backend.
            }
        },
    };
}

function buildLanceDbSchema(arrow, fixture) {
    const { denseDimension, colbertDimension } = getVectorShape(fixture);
    const denseVectorType = new arrow.FixedSizeList(
        denseDimension,
        new arrow.Field('item', new arrow.Float32(), true),
    );
    const colbertTokenType = new arrow.FixedSizeList(
        colbertDimension,
        new arrow.Field('item', new arrow.Float32(), true),
    );
    const colbertMultiVectorType = new arrow.List(
        new arrow.Field('item', colbertTokenType, true),
    );
    return new arrow.Schema([
        new arrow.Field('id', new arrow.Utf8(), false),
        new arrow.Field('content', new arrow.Utf8(), false),
        new arrow.Field('dense_vector', denseVectorType, false),
        new arrow.Field('sparse_indices', new arrow.List(new arrow.Field('item', new arrow.Int32(), true)), true),
        new arrow.Field('sparse_values', new arrow.List(new arrow.Field('item', new arrow.Float32(), true)), true),
        new arrow.Field('colbert_vectors', colbertMultiVectorType, false),
        new arrow.Field('relativePath', new arrow.Utf8(), false),
        new arrow.Field('startLine', new arrow.Int32(), false),
        new arrow.Field('endLine', new arrow.Int32(), false),
        new arrow.Field('fileExtension', new arrow.Utf8(), false),
        new arrow.Field('metadata_json', new arrow.Utf8(), false),
    ]);
}

async function runBackend(name, fixture, options, matrixDir, parityContext) {
    const collectionName = makeCollectionName(options, fixture, name);
    const runDir = path.join(matrixDir, `${sanitizeName(fixture.dataset?.name || 'dataset', 'dataset')}-${name}`);
    const requestRecords = [];
    const sampler = startRssSampler();
    const startedAt = new Date();
    const backend = buildAdapter(name, { ...options, currentFixture: fixture }, fixture, collectionName);
    const batches = splitBatches(fixture.documents, options.batchSize);
    const summary = {
        schemaVersion,
        backend: name,
        dataset: fixture.dataset,
        fixture: {
            checksum: fixture.checksum,
            checksumMatchesStored: fixture.checksumMatchesStored,
            chunkCount: fixture.documents.length,
            stats: fixture.stats || computeFixtureStats(fixture.documents),
        },
        batchPlan: {
            batchSize: options.batchSize,
            requestCount: batches.length,
            documentOrder: 'fixture order',
        },
        startedAt: startedAt.toISOString(),
        collectionName,
        complete: false,
        skipped: false,
        comparable: false,
        failures: 0,
    };
    const timings = {};

    try {
        if (options.skipBackends.has(name)) {
            throw new SkipRunError('Skipped by --skip-backend.', { backend: name });
        }

        const setupStarted = process.hrtime.bigint();
        summary.backendSettings = await backend.setup();
        timings.setupMs = elapsedMs(setupStarted);

        const writeStarted = process.hrtime.bigint();
        for (let index = 0; index < batches.length; index += 1) {
            const batch = batches[index];
            const payload = backend.buildRequestPayload(batch);
            const bytes = byteLength(payload);
            const requestStarted = process.hrtime.bigint();
            try {
                await backend.writeBatch(payload, batch);
                requestRecords.push({
                    backend: name,
                    dataset: fixture.dataset?.name,
                    batchId: index + 1,
                    offset: batch.offset,
                    documents: batch.documents.length,
                    bytes,
                    elapsedMs: elapsedMs(requestStarted),
                    error: null,
                });
            } catch (error) {
                summary.failures += 1;
                requestRecords.push({
                    backend: name,
                    dataset: fixture.dataset?.name,
                    batchId: index + 1,
                    offset: batch.offset,
                    documents: batch.documents.length,
                    bytes,
                    elapsedMs: elapsedMs(requestStarted),
                    error: serializeError(error),
                });
                throw error;
            }
        }
        timings.writeWallClockMs = elapsedMs(writeStarted);

        const finalizeStarted = process.hrtime.bigint();
        if (backend.finalize) {
            await backend.finalize();
        }
        timings.finalizeMs = elapsedMs(finalizeStarted);

        summary.complete = true;
        const searchParityStarted = process.hrtime.bigint();
        summary.searchParity = await evaluateSearchParity(
            backend,
            name,
            parityContext.options,
            parityContext.baselineReport,
        );
        timings.searchParityMs = elapsedMs(searchParityStarted);
    } catch (error) {
        if (error instanceof SkipRunError) {
            summary.skipped = true;
            summary.skipReason = error.message;
            summary.skipDetails = error.details;
            summary.searchParity = {
                status: parityStatusSkipped,
                reason: 'backend skipped',
            };
        } else {
            summary.failures += 1;
            summary.error = serializeError(error);
            summary.searchParity = {
                status: parityStatusNotRun,
                reason: 'backend write failed',
            };
        }
    } finally {
        const rss = sampler.stop();
        summary.finishedAt = new Date().toISOString();
        summary.timings = timings;
        const requestBytes = requestRecords.map((record) => record.bytes);
        summary.metrics = {
            writeWallClockMs: timings.writeWallClockMs,
            setupMs: timings.setupMs,
            finalizeMs: timings.finalizeMs,
            requestCount: requestRecords.length,
            totalBytes: requestBytes.reduce((sum, value) => sum + value, 0),
            bytesPerRequest: summarizeNumbers(requestBytes),
            failures: summary.failures,
            runnerRss: rss,
            backendProcessRss: {
                available: false,
                reason: 'No safe backend process RSS probe configured.',
            },
        };
        const isRealBackend = !['dry-run', 'forced-skip', 'parity-miss'].includes(name);
        summary.comparable = Boolean(
            summary.complete &&
            !summary.skipped &&
            !fixture.dataset?.bounded &&
            summary.searchParity?.status === parityStatusPassed &&
            summary.failures === 0 &&
            (!isRealBackend || parityContext.options.baselineBackend === 'milvus-current'),
        );
        if (backend.cleanup) {
            try {
                await backend.cleanup();
            } catch (cleanupError) {
                summary.cleanupError = serializeError(cleanupError);
            }
        }
        await writeJson(path.join(runDir, 'summary.json'), summary);
        await appendJsonl(path.join(runDir, 'requests.jsonl'), requestRecords);
        await writeJson(path.join(runDir, 'env.json'), buildEnvSummary(options));
        await writeJson(path.join(runDir, 'search-parity.json'), summary.searchParity);
    }

    return {
        backend: name,
        runDir,
        summaryPath: path.join(runDir, 'summary.json'),
        requestPath: path.join(runDir, 'requests.jsonl'),
        searchParityPath: path.join(runDir, 'search-parity.json'),
        searchParityDetails: summary.searchParity,
        complete: summary.complete,
        skipped: summary.skipped,
        comparable: summary.comparable,
        failures: summary.failures,
        writeWallClockMs: summary.metrics.writeWallClockMs,
        bytesPerRequest: summary.metrics.bytesPerRequest,
        searchParity: summary.searchParity?.status,
    };
}

function elapsedMs(started) {
    return Number(process.hrtime.bigint() - started) / 1e6;
}

function serializeError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack,
    };
}

function buildEnvSummary(options) {
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    return {
        generatedAt: new Date().toISOString(),
        repoRoot,
        gitHead: git.status === 0 ? git.stdout.trim() : undefined,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        os: {
            type: os.type(),
            release: os.release(),
            totalmem: os.totalmem(),
            cpus: os.cpus().length,
        },
        options: {
            batchSize: options.batchSize,
            backends: options.backends,
            artifactDir: options.artifactDir,
            collectionPrefix: options.collectionPrefix,
            oneCIndexScopeProfile: options.oneCIndexScopeProfile,
            qdrantUrl: options.qdrantUrl,
            lancedbUri: options.lancedbUri,
            milvusAddress: options.milvusAddress,
            milvusToken: redactedEnvRef(options.milvusTokenEnv),
            qdrantApiKey: redactedEnvRef(options.qdrantApiKeyEnv),
        },
    };
}

function buildMatrixSummary(fixture, options, matrixDir, runs, parityOptions) {
    const comparableRuns = runs.filter((run) => run.comparable);
    const realBackendRuns = runs.filter((run) => !['dry-run', 'forced-skip', 'parity-miss'].includes(run.backend));
    const matrixComparable = Boolean(
        realBackendRuns.length > 0 &&
        parityOptions.baselineBackend === 'milvus-current' &&
        !fixture.dataset?.bounded &&
        fixture.checksumMatchesStored &&
        realBackendRuns.every((run) => (
            run.complete &&
            !run.skipped &&
            run.failures === 0 &&
            run.searchParity === parityStatusPassed
        )),
    );
    const rankedByWriteWallClock = (matrixComparable ? [...comparableRuns] : [])
        .sort((left, right) => (left.writeWallClockMs || Infinity) - (right.writeWallClockMs || Infinity))
        .map((run) => ({
            backend: run.backend,
            writeWallClockMs: run.writeWallClockMs,
            bytesPerRequestMean: run.bytesPerRequest?.mean,
        }));
    return {
        schemaVersion,
        generatedAt: new Date().toISOString(),
        matrixDir,
        dataset: fixture.dataset,
        fixture: {
            checksum: fixture.checksum,
            checksumMatchesStored: fixture.checksumMatchesStored,
            chunkCount: fixture.documents.length,
            stats: fixture.stats || computeFixtureStats(fixture.documents),
        },
        batchPlan: {
            batchSize: options.batchSize,
            backendCount: options.backends.length,
        },
        searchParity: {
            baselineBackend: parityOptions.baselineBackend,
            topK: parityOptions.topK,
            candidateLimit: parityOptions.candidateLimit,
            minOverlap: parityOptions.minOverlap,
            queryCount: parityOptions.queries.length,
            queries: parityOptions.queries.map((query) => ({
                queryId: query.queryId,
                sourceDocumentId: query.sourceDocumentId,
                relativePath: query.relativePath,
                startLine: query.startLine,
                expectedIds: query.expectedIds,
                vectorShape: query.vectorShape,
            })),
            statuses: runs.reduce((result, run) => {
                result[run.backend] = run.searchParity;
                return result;
            }, {}),
        },
        comparable: matrixComparable,
        runs,
        comparableRuns: comparableRuns.map((run) => run.backend),
        rankedByWriteWallClock,
        interpretation: {
            rankingAvailable: matrixComparable && rankedByWriteWallClock.length > 1,
            boundedResultsExcluded: Boolean(fixture.dataset?.bounded),
            rule: 'Only complete, non-bounded, zero-failure real backend matrices with searchParity=passed are comparable.',
        },
    };
}

async function runMatrix(options) {
    if (!options.fixturePath) {
        throw new Error('--fixture is required for --run.');
    }
    const fixture = await loadFixture(options.fixturePath);
    validateFixtureChunkCount(fixture, options);
    if (options.bounded) {
        fixture.dataset.bounded = true;
        fixture.dataset.boundedReason = options.boundedReason;
    }
    refreshFixtureChecksum(fixture);
    fixture.checksumMatchesStored = fixture.storedChecksum === fixture.checksum;
    const datasetName = sanitizeName(options.dataset || fixture.dataset?.name || path.basename(options.fixturePath, '.json'), 'dataset');
    const matrixId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${datasetName}`;
    const matrixDir = path.join(options.artifactDir, matrixId);
    await fsp.mkdir(matrixDir, { recursive: true });
    const parityOptions = buildParityOptions(fixture, options.backends);
    const executionBackends = orderBackendsForParity(options.backends, parityOptions.baselineBackend);

    const runs = [];
    let baselineReport;
    for (const backend of executionBackends) {
        console.log(`[benchmark] backend=${backend} dataset=${datasetName}`);
        const run = await runBackend(backend, fixture, options, matrixDir, {
            options: parityOptions,
            baselineReport,
        });
        runs.push(run);
        if (backend === parityOptions.baselineBackend) {
            baselineReport = run.searchParityDetails;
        }
    }

    const matrixSummary = buildMatrixSummary(fixture, options, matrixDir, runs, parityOptions);
    await writeJson(path.join(matrixDir, 'summary.json'), matrixSummary);
    console.log(JSON.stringify({
        matrixDir,
        summaryPath: path.join(matrixDir, 'summary.json'),
        comparable: matrixSummary.comparable,
        runs: runs.map((run) => ({
            backend: run.backend,
            complete: run.complete,
            skipped: run.skipped,
            comparable: run.comparable,
            failures: run.failures,
            searchParity: run.searchParity,
        })),
    }, null, 2));
}

async function runSelfTest(options) {
    const selfTestDir = path.join(options.artifactDir, 'self-test');
    const fixturePath = path.join(selfTestDir, 'synthetic-fixture.json');
    const fixture = createSyntheticFixture({ ...options, dataset: 'synthetic-self-test' });
    validateFixtureChunkCount(fixture, { ...options, expectedChunks: 3 });
    refreshFixtureChecksum(fixture);
    await writeJson(fixturePath, fixture);
    await runMatrix({
        ...options,
        fixturePath,
        dataset: 'synthetic-self-test',
        backends: ['dry-run', 'parity-miss', 'forced-skip'],
        batchSize: 2,
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === 'self-test') {
        await runSelfTest(options);
        return;
    }
    if (options.mode === 'generate-fixture') {
        await generateFixture(options);
        return;
    }
    await runMatrix(options);
}

main().then(() => {
    // Some benchmark paths load native splitter/vector dependencies that can crash
    // during process teardown after artifacts are already written.
    process.exit(0);
}).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
});
