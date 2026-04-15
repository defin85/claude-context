#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_REPO_COUNT = 3;
const DEFAULT_WARMUP_MS = 7000;
const DEFAULT_SAMPLE_COUNT = 3;
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const READY_TIMEOUT_MS = 10000;
const EXIT_TIMEOUT_MS = 5000;

function parseArgs(argv) {
    const options = {
        repoCount: DEFAULT_REPO_COUNT,
        warmupMs: DEFAULT_WARMUP_MS,
        sampleCount: DEFAULT_SAMPLE_COUNT,
        sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
        outputPath: undefined
    };

    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        const nextValue = () => {
            const value = argv[index + 1];
            if (!value) {
                throw new Error(`Missing value for ${current}`);
            }
            index += 1;
            return value;
        };

        switch (current) {
            case '--repos':
                options.repoCount = parsePositiveInteger(nextValue(), '--repos');
                break;
            case '--warmup-ms':
                options.warmupMs = parsePositiveInteger(nextValue(), '--warmup-ms');
                break;
            case '--samples':
                options.sampleCount = parsePositiveInteger(nextValue(), '--samples');
                break;
            case '--sample-interval-ms':
                options.sampleIntervalMs = parsePositiveInteger(nextValue(), '--sample-interval-ms');
                break;
            case '--output':
                options.outputPath = path.resolve(nextValue());
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown option: ${current}`);
        }
    }

    return options;
}

function parsePositiveInteger(rawValue, label) {
    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        throw new Error(`Invalid ${label} '${rawValue}'. Expected a positive integer.`);
    }
    return parsedValue;
}

function printHelp() {
    console.log(`daemon-idle-benchmark

Usage:
  node scripts/daemon-idle-benchmark.js [options]

Options:
  --repos <count>                Number of repository slots to simulate (default: ${DEFAULT_REPO_COUNT})
  --warmup-ms <ms>               Wait after startup before sampling (default: ${DEFAULT_WARMUP_MS})
  --samples <count>              Number of RSS samples to average (default: ${DEFAULT_SAMPLE_COUNT})
  --sample-interval-ms <ms>      Delay between RSS samples (default: ${DEFAULT_SAMPLE_INTERVAL_MS})
  --output <path>                Optional JSON output path
  --help, -h                     Show this help
`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createBenchmarkWorkspace(repoCount) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-context-daemon-idle-'));
    const homeDir = path.join(rootDir, 'home');
    const reposDir = path.join(rootDir, 'repos');

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(reposDir, { recursive: true });

    const repoPaths = [];
    for (let index = 0; index < repoCount; index += 1) {
        const repoPath = path.join(reposDir, `repo-${index + 1}`);
        fs.mkdirSync(repoPath, { recursive: true });
        fs.writeFileSync(path.join(repoPath, 'index.ts'), `export const repo${index + 1} = ${index + 1};\n`);
        repoPaths.push(repoPath);
    }

    return { rootDir, homeDir, repoPaths };
}

function getMcpEntryPath() {
    const entryPath = path.resolve(__dirname, '..', 'packages', 'mcp', 'dist', 'index.js');
    if (!fs.existsSync(entryPath)) {
        throw new Error(
            `Missing built MCP entrypoint at ${entryPath}. Run 'pnpm build:core && pnpm build:mcp' first.`
        );
    }
    return entryPath;
}

function createChildEnv(homeDir, repoPaths) {
    return {
        ...process.env,
        HOME: homeDir,
        MCP_BENCHMARK_IDLE_STUBS: '1',
        EMBEDDING_PROVIDER: 'Ollama',
        EMBEDDING_MODEL: 'nomic-embed-text',
        MILVUS_ADDRESS: '127.0.0.1:19530',
        MCP_DAEMON_TOKEN: 'benchmark-token',
        MCP_DAEMON_ALLOW_ROOTS: repoPaths.join(path.delimiter)
    };
}

function spawnMcpProcess({ mode, cwd, homeDir, repoPaths }) {
    const entryPath = getMcpEntryPath();
    const args = [entryPath];
    if (mode === 'daemon') {
        args.push('--mode', 'daemon', '--daemon-token', 'benchmark-token');
        for (const repoPath of repoPaths) {
            args.push('--allow-root', repoPath);
        }
    } else {
        args.push('--mode', 'stdio');
    }

    const child = spawn(process.execPath, args, {
        cwd,
        env: createChildEnv(homeDir, repoPaths),
        stdio: ['pipe', 'ignore', 'pipe']
    });

    let stderrBuffer = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk;
    });

    return {
        child,
        getStderr: () => stderrBuffer
    };
}

function waitForReady(handle, readyPattern, label) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        const timer = setInterval(() => {
            if (readyPattern.test(handle.getStderr())) {
                cleanup();
                resolve();
                return;
            }

            if (handle.child.exitCode !== null) {
                cleanup();
                reject(new Error(`${label} exited before readiness.\n${handle.getStderr()}`));
                return;
            }

            if ((Date.now() - start) > READY_TIMEOUT_MS) {
                cleanup();
                reject(new Error(`${label} did not become ready within ${READY_TIMEOUT_MS}ms.\n${handle.getStderr()}`));
            }
        }, 50);

        const onExit = () => {
            cleanup();
            reject(new Error(`${label} exited before readiness.\n${handle.getStderr()}`));
        };

        handle.child.once('exit', onExit);

        function cleanup() {
            clearInterval(timer);
            handle.child.off('exit', onExit);
        }
    });
}

function readRssKiB(pid) {
    const statusPath = path.join('/proc', String(pid), 'status');
    const payload = fs.readFileSync(statusPath, 'utf8');
    const match = payload.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (!match) {
        throw new Error(`Could not read VmRSS from ${statusPath}`);
    }
    return Number(match[1]);
}

async function sampleScenario(handles, options) {
    await sleep(options.warmupMs);

    const samples = [];
    for (let index = 0; index < options.sampleCount; index += 1) {
        const processes = handles.map((handle) => ({
            pid: handle.child.pid,
            rssKiB: readRssKiB(handle.child.pid)
        }));
        const totalRssKiB = processes.reduce((sum, processInfo) => sum + processInfo.rssKiB, 0);
        samples.push({
            index: index + 1,
            totalRssKiB,
            processes
        });

        if (index < (options.sampleCount - 1)) {
            await sleep(options.sampleIntervalMs);
        }
    }

    const averageTotalRssKiB = Math.round(
        samples.reduce((sum, sample) => sum + sample.totalRssKiB, 0) / samples.length
    );

    return {
        processCount: handles.length,
        pids: handles.map((handle) => handle.child.pid),
        samples,
        averageTotalRssKiB,
        averagePerProcessRssKiB: Math.round(averageTotalRssKiB / handles.length)
    };
}

function stopChild(handle, label) {
    return new Promise((resolve, reject) => {
        if (handle.child.exitCode !== null) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            handle.child.kill('SIGKILL');
            reject(new Error(`${label} did not exit within ${EXIT_TIMEOUT_MS}ms.\n${handle.getStderr()}`));
        }, EXIT_TIMEOUT_MS);

        handle.child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });

        handle.child.kill('SIGINT');
    });
}

async function stopScenario(handles, label) {
    await Promise.all(handles.map((handle, index) => stopChild(handle, `${label}[${index}]`)));
}

async function measureScenario(name, handles, readyPattern, options) {
    try {
        await Promise.all(handles.map((handle, index) => waitForReady(handle, readyPattern, `${name}[${index}]`)));
        return await sampleScenario(handles, options);
    } finally {
        await stopScenario(handles, name);
    }
}

function formatMiB(kib) {
    return (kib / 1024).toFixed(1);
}

function printSummary(results) {
    const daemon = results.daemon;
    const stdio = results.stdio;
    const deltaKiB = stdio.averageTotalRssKiB - daemon.averageTotalRssKiB;
    const improvementPercent = stdio.averageTotalRssKiB > 0
        ? ((deltaKiB / stdio.averageTotalRssKiB) * 100)
        : 0;

    console.log('Daemon idle resource benchmark');
    console.log(`Date: ${results.timestamp}`);
    console.log(`Repositories simulated: ${results.repoCount}`);
    console.log(`Warmup: ${results.options.warmupMs}ms, samples: ${results.options.sampleCount}, interval: ${results.options.sampleIntervalMs}ms`);
    console.log('');
    console.log(`Daemon: ${daemon.processCount} process, average total RSS ${daemon.averageTotalRssKiB} KiB (${formatMiB(daemon.averageTotalRssKiB)} MiB)`);
    console.log(`STDIO:  ${stdio.processCount} processes, average total RSS ${stdio.averageTotalRssKiB} KiB (${formatMiB(stdio.averageTotalRssKiB)} MiB)`);
    console.log(`Delta:  ${deltaKiB} KiB (${formatMiB(deltaKiB)} MiB), daemon lower by ${improvementPercent.toFixed(1)}%`);
    console.log('');
    console.log(`Conclusion: ${deltaKiB > 0 ? 'daemon idle usage is lower' : 'daemon idle usage is not lower in this environment'}`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const workspace = createBenchmarkWorkspace(options.repoCount);
    const timestamp = new Date().toISOString();

    const daemonHandles = [
        spawnMcpProcess({
            mode: 'daemon',
            cwd: workspace.repoPaths[0],
            homeDir: workspace.homeDir,
            repoPaths: workspace.repoPaths
        })
    ];

    const stdioHandles = workspace.repoPaths.map((repoPath) => spawnMcpProcess({
        mode: 'stdio',
        cwd: repoPath,
        homeDir: workspace.homeDir,
        repoPaths: workspace.repoPaths
    }));

    try {
        const daemon = await measureScenario(
            'daemon',
            daemonHandles,
            /MCP daemon started and listening on http:\/\//,
            options
        );
        const stdio = await measureScenario(
            'stdio',
            stdioHandles,
            /MCP server started and listening on stdio\./,
            options
        );

        const results = {
            timestamp,
            repoCount: options.repoCount,
            options: {
                warmupMs: options.warmupMs,
                sampleCount: options.sampleCount,
                sampleIntervalMs: options.sampleIntervalMs
            },
            daemon,
            stdio
        };

        if (options.outputPath) {
            fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
            fs.writeFileSync(options.outputPath, JSON.stringify(results, null, 2));
        }

        printSummary(results);
    } finally {
        fs.rmSync(workspace.rootDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
});
