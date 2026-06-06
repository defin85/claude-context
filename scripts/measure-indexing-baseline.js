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
  --prepare-only          Recreate daemon with baseline env, do not start indexing
  --start                 Start force indexing and poll until indexed/indexfailed
  --no-restart            Reuse the current daemon instead of recreating the unit
  --no-force              Do not pass force=true to index_codebase
  --help                  Show this help

Baseline env overrides:
  INDEX_ACCELERATOR_MODE=off
  INDEX_EMBEDDING_CONCURRENCY=1
  INDEX_INSERT_CONCURRENCY=1
  BGE_M3_ACCELERATOR_MANAGED_WORKERS=false
  BGE_M3_ACCELERATOR_MAX_WORKERS=1
`);
}

function parseArgs(argv) {
    const options = {
        codebasePath: defaultCodebasePath,
        artifactDir: path.join(repoRoot, '.artifacts', 'indexing-baselines'),
        intervalMs: 30_000,
        timeoutMs: 0,
        unitName: defaultUnitName,
        prepareOnly: false,
        start: false,
        restart: true,
        force: true,
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
            case '--prepare-only':
                options.prepareOnly = true;
                break;
            case '--start':
                options.start = true;
                break;
            case '--no-restart':
                options.restart = false;
                break;
            case '--no-force':
                options.force = false;
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
    if (options.prepareOnly && options.start) {
        throw new Error('Use either --prepare-only or --start, not both');
    }
    if (!options.prepareOnly && !options.start) {
        options.prepareOnly = true;
    }

    return options;
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

function buildBaselineEnvironment(currentEnv) {
    return {
        ...currentEnv,
        MCP_RUNTIME_MODE: 'daemon',
        INDEX_ACCELERATOR_MODE: 'off',
        INDEX_EMBEDDING_CONCURRENCY: '1',
        INDEX_INSERT_CONCURRENCY: '1',
        BGE_M3_ACCELERATOR_MANAGED_WORKERS: 'false',
        BGE_M3_ACCELERATOR_MAX_WORKERS: '1',
    };
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

    const baselineEnv = buildBaselineEnvironment(serviceEnv);

    if (options.restart) {
        stopUnit(options.unitName);
        startUnit(options.unitName, baselineEnv);
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
        baselineEnv: redactEnv({
            INDEX_ACCELERATOR_MODE: baselineEnv.INDEX_ACCELERATOR_MODE,
            INDEX_EMBEDDING_CONCURRENCY: baselineEnv.INDEX_EMBEDDING_CONCURRENCY,
            INDEX_INSERT_CONCURRENCY: baselineEnv.INDEX_INSERT_CONCURRENCY,
            BGE_M3_ACCELERATOR_MANAGED_WORKERS: baselineEnv.BGE_M3_ACCELERATOR_MANAGED_WORKERS,
            BGE_M3_ACCELERATOR_MAX_WORKERS: baselineEnv.BGE_M3_ACCELERATOR_MAX_WORKERS,
            EMBEDDING_PROVIDER: baselineEnv.EMBEDDING_PROVIDER,
            BGE_M3_MODE: baselineEnv.BGE_M3_MODE,
            BGE_M3_STORE_COLBERT: baselineEnv.BGE_M3_STORE_COLBERT,
            MILVUS_ADDRESS: baselineEnv.MILVUS_ADDRESS,
        }),
        runtimeWorkload: runtimeStatus.workload,
        runtimeSync: runtimeStatus.sync,
    });

    return clientConfig;
}

async function measure(options, clientConfig, runDir) {
    const samplesPath = path.join(runDir, 'samples.jsonl');
    const startedAt = new Date();

    const indexResult = await callTool(clientConfig, 'index_codebase', {
        path: options.codebasePath,
        force: options.force,
    });

    writeJson(path.join(runDir, 'index-start-response.json'), {
        capturedAt: new Date().toISOString(),
        text: textFromResult(indexResult),
        structuredContent: indexResult.structuredContent,
    });

    const deadline = options.timeoutMs > 0 ? Date.now() + options.timeoutMs : Number.POSITIVE_INFINITY;
    let finalResult = null;

    while (Date.now() <= deadline) {
        const statusResult = await callTool(clientConfig, 'get_indexing_status', {
            path: options.codebasePath,
        });
        const sample = {
            capturedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedAt.getTime(),
            text: textFromResult(statusResult),
            structuredContent: statusResult.structuredContent,
        };
        appendJsonl(samplesPath, sample);
        finalResult = sample;

        const status = statusResult.structuredContent?.status;
        if (terminalStatuses.has(status)) {
            break;
        }

        await sleep(options.intervalMs);
    }

    const endedAt = new Date();
    writeJson(path.join(runDir, 'summary.json'), {
        codebasePath: options.codebasePath,
        mode: 'off',
        force: options.force,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        wallClockMs: endedAt.getTime() - startedAt.getTime(),
        finalStatus: finalResult?.structuredContent?.status,
        finalStructuredContent: finalResult?.structuredContent,
        samplesPath,
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const runDir = createRunDir(options.artifactDir, 'off');
    const clientConfig = await prepareDaemon(options, runDir);

    if (options.prepareOnly) {
        console.log(`Prepared INDEX_ACCELERATOR_MODE=off daemon measurement.`);
        console.log(`Run dir: ${runDir}`);
        console.log(`Runtime: ${clientConfig.runtimeId} pid=${clientConfig.pid}`);
        console.log(`Start measurement with: node scripts/measure-indexing-baseline.js --start --no-restart --codebase ${options.codebasePath}`);
        return;
    }

    await measure(options, clientConfig, runDir);
    console.log(`Measurement complete. Run dir: ${runDir}`);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
