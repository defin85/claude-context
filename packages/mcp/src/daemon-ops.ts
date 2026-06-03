import { spawn as spawnProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createMcpRuntimeConfig } from './config.js';
import {
    DAEMON_CLIENT_COMPATIBILITY_VERSION,
    DaemonClientConfigFile,
    getDaemonClientConfigPath,
    readDaemonClientConfig
} from './daemon-discovery.js';
import { SnapshotManager } from './snapshot.js';
import { getErrorCode } from './utils.js';

const RESTART_WAIT_TIMEOUT_MS = 30_000;
const SHUTDOWN_WAIT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

const DAEMON_ADMIN_FLAGS_WITH_VALUES = new Map<string, number>([
    ['--daemon-discover', 0],
    ['--daemon-status', 0],
    ['--daemon-stop', 0],
    ['--daemon-restart', 0],
    ['--daemon-cleanup-stale', 0],
    ['--daemon-cancel', 1]
]);

type DaemonRegistryPayload = {
    runtimeId?: string;
    pid?: number;
    host?: string;
    port?: number;
    endpointPath?: string;
    endpointUrl?: string;
    allowedRoots?: string[];
    runtimeStatusFilePath?: string;
    snapshotFilePath?: string;
};

function getDaemonRegistryDir(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'daemon', 'registry');
}

function getDaemonRuntimeStatusDir(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'runtime');
}

function getDaemonStateWorkspace(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'daemon');
}

export interface DaemonStaleCleanupResult {
    removedRegistryFiles: string[];
    removedRuntimeStatusFiles: string[];
    removedClientConfig: boolean;
    recoveredSnapshotCodebases: string[];
    removedUnreadableRegistryFiles: string[];
    removedUnreadableClientConfig: boolean;
    hadCorruptedSnapshot: boolean;
}

export interface RestartedDaemonResult {
    discovery: DaemonClientConfigFile;
    cleanup: DaemonStaleCleanupResult;
    spawnedPid: number;
}

function isPidAlive(pid: number | undefined): boolean {
    if (!Number.isInteger(pid) || pid === undefined || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (getErrorCode(error) === 'EPERM') {
            return true;
        }
        return false;
    }
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath);
        return true;
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function unlinkIfExists(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.unlink(targetPath);
        return true;
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function readJsonFile<T>(targetPath: string): Promise<T> {
    const raw = await fs.promises.readFile(targetPath, 'utf8');
    return JSON.parse(raw) as T;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDaemonShutdown(
    previousRuntimeId?: string,
    timeoutMs: number = SHUTDOWN_WAIT_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const discovery = await readDaemonClientConfig({ requireLivePid: false }).catch(() => null);

        if (!discovery) {
            return;
        }

        if (previousRuntimeId && discovery.runtimeId !== previousRuntimeId) {
            return;
        }

        if (!isPidAlive(discovery.pid)) {
            await unlinkIfExists(getDaemonClientConfigPath());
            return;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error('Timed out waiting for the active daemon to stop.');
}

async function waitForDaemonStartup(previousRuntimeId?: string, timeoutMs: number = RESTART_WAIT_TIMEOUT_MS): Promise<DaemonClientConfigFile> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const discovery = await readDaemonClientConfig({
            expectedCompatibilityVersion: DAEMON_CLIENT_COMPATIBILITY_VERSION,
            requireLivePid: true
        }).catch(() => null);

        if (discovery && (!previousRuntimeId || discovery.runtimeId !== previousRuntimeId)) {
            return discovery;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error('Timed out waiting for the restarted daemon to publish discovery metadata.');
}

function buildRuntimeStatusPathForPid(pid: number): string {
    return path.join(getDaemonRuntimeStatusDir(), `${pid}.json`);
}

async function cleanupRuntimeStatusArtifact(runtimeStatusFilePath: string | undefined, pid: number): Promise<string | null> {
    const fallbackPath = buildRuntimeStatusPathForPid(pid);
    const targetPath = runtimeStatusFilePath || fallbackPath;

    if (!(await pathExists(targetPath))) {
        return null;
    }

    if (path.basename(targetPath) === `${pid}.json`) {
        await unlinkIfExists(targetPath);
        return targetPath;
    }

    try {
        const payload = await readJsonFile<{ pid?: number }>(targetPath);
        if (payload.pid === pid) {
            await unlinkIfExists(targetPath);
            return targetPath;
        }
    } catch {
        await unlinkIfExists(targetPath);
        return targetPath;
    }

    return null;
}

async function cleanupOrphanDaemonRuntimeStatusArtifacts(
    removedRuntimeStatusFiles: string[]
): Promise<string[]> {
    const removedPaths = new Set(removedRuntimeStatusFiles);
    const orphanRemovals: string[] = [];

    let runtimeEntries: string[] = [];
    try {
        runtimeEntries = await fs.promises.readdir(getDaemonRuntimeStatusDir());
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            throw error;
        }
        return orphanRemovals;
    }

    for (const entry of runtimeEntries.sort()) {
        if (!entry.endsWith('.json')) {
            continue;
        }

        const runtimeStatusPath = path.join(getDaemonRuntimeStatusDir(), entry);
        if (removedPaths.has(runtimeStatusPath)) {
            continue;
        }

        let runtimeStatus: { pid?: number; mode?: string };
        try {
            runtimeStatus = await readJsonFile<{ pid?: number; mode?: string }>(runtimeStatusPath);
        } catch {
            continue;
        }

        if (runtimeStatus.mode !== 'daemon' || isPidAlive(runtimeStatus.pid)) {
            continue;
        }

        if (await unlinkIfExists(runtimeStatusPath)) {
            orphanRemovals.push(runtimeStatusPath);
            removedPaths.add(runtimeStatusPath);
        }
    }

    return orphanRemovals;
}

function diffRecoveredSnapshotCodebases(
    before: Record<string, { status?: string }> | null,
    after: Record<string, { status?: string }>
): string[] {
    if (!before) {
        return [];
    }

    return Object.entries(before)
        .filter(([codebasePath, info]) => info?.status === 'indexing' && after[codebasePath]?.status === 'indexfailed')
        .map(([codebasePath]) => codebasePath)
        .sort((left, right) => left.localeCompare(right));
}

export async function cleanupStaleDaemonState(): Promise<DaemonStaleCleanupResult> {
    const result: DaemonStaleCleanupResult = {
        removedRegistryFiles: [],
        removedRuntimeStatusFiles: [],
        removedClientConfig: false,
        recoveredSnapshotCodebases: [],
        removedUnreadableRegistryFiles: [],
        removedUnreadableClientConfig: false,
        hadCorruptedSnapshot: false
    };

    let registryEntries: string[] = [];
    try {
        registryEntries = await fs.promises.readdir(getDaemonRegistryDir());
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            throw error;
        }
    }

    for (const entry of registryEntries.sort()) {
        if (!entry.endsWith('.json')) {
            continue;
        }

        const registryPath = path.join(getDaemonRegistryDir(), entry);
        let registry: DaemonRegistryPayload;

        try {
            registry = await readJsonFile<DaemonRegistryPayload>(registryPath);
        } catch {
            if (await unlinkIfExists(registryPath)) {
                result.removedUnreadableRegistryFiles.push(registryPath);
            }
            continue;
        }

        if (isPidAlive(registry.pid)) {
            continue;
        }

        if (await unlinkIfExists(registryPath)) {
            result.removedRegistryFiles.push(registryPath);
        }

        if (typeof registry.pid === 'number') {
            const removedRuntimeStatus = await cleanupRuntimeStatusArtifact(registry.runtimeStatusFilePath, registry.pid);
            if (removedRuntimeStatus) {
                result.removedRuntimeStatusFiles.push(removedRuntimeStatus);
            }
        }
    }

    const clientConfigPath = getDaemonClientConfigPath();
    if (await pathExists(clientConfigPath)) {
        try {
            const discovery = await readJsonFile<DaemonClientConfigFile>(clientConfigPath);
            if (!isPidAlive(discovery.pid)) {
                result.removedClientConfig = await unlinkIfExists(clientConfigPath);
            }
        } catch {
            result.removedUnreadableClientConfig = await unlinkIfExists(clientConfigPath);
        }
    }

    const orphanRuntimeStatusFiles = await cleanupOrphanDaemonRuntimeStatusArtifacts(result.removedRuntimeStatusFiles);
    result.removedRuntimeStatusFiles.push(...orphanRuntimeStatusFiles);

    const snapshotManager = new SnapshotManager({
        workspacePath: getDaemonStateWorkspace(),
        scope: 'daemon',
        saveDebounceMs: 0,
        runtimeId: 'daemon-ops-cleanup'
    });
    const snapshotPath = snapshotManager.getSnapshotFilePath();

    let beforeSnapshotCodebases: Record<string, { status?: string }> | null = null;
    if (await pathExists(snapshotPath)) {
        try {
            const rawSnapshot = await readJsonFile<{ codebases?: Record<string, { status?: string }> }>(snapshotPath);
            beforeSnapshotCodebases = rawSnapshot.codebases || {};
        } catch {
            result.hadCorruptedSnapshot = true;
        }
    }

    snapshotManager.loadCodebaseSnapshot();
    result.recoveredSnapshotCodebases = diffRecoveredSnapshotCodebases(
        beforeSnapshotCodebases,
        snapshotManager.getAllCodebaseInfo()
    );
    if (result.recoveredSnapshotCodebases.length > 0 || result.hadCorruptedSnapshot) {
        await snapshotManager.saveCodebaseSnapshot('daemon-ops-cleanup-recovery');
    }

    return result;
}

export function buildDaemonRestartArgs(
    args: string[],
    discovery: DaemonClientConfigFile | null
): string[] {
    const filteredArgs: string[] = [];
    let modeSpecified = false;
    let hostSpecified = false;
    let portSpecified = false;
    let pathSpecified = false;
    let tokenSpecified = false;
    let allowRootSpecified = false;

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];
        const adminValueArity = DAEMON_ADMIN_FLAGS_WITH_VALUES.get(current);
        if (typeof adminValueArity === 'number') {
            index += adminValueArity;
            continue;
        }

        if (current === '--mode') {
            modeSpecified = true;
            filteredArgs.push('--mode', 'daemon');
            index += 1;
            continue;
        }

        if (current === '--daemon-host') {
            hostSpecified = true;
            filteredArgs.push(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === '--daemon-port') {
            portSpecified = true;
            filteredArgs.push(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === '--daemon-path') {
            pathSpecified = true;
            filteredArgs.push(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === '--daemon-token') {
            tokenSpecified = true;
            filteredArgs.push(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === '--allow-root') {
            allowRootSpecified = true;
            filteredArgs.push(current, args[index + 1]);
            index += 1;
            continue;
        }

        filteredArgs.push(current);
    }

    if (!modeSpecified) {
        filteredArgs.push('--mode', 'daemon');
    }

    if (discovery) {
        if (!hostSpecified) {
            filteredArgs.push('--daemon-host', discovery.host);
        }
        if (!portSpecified) {
            filteredArgs.push('--daemon-port', String(discovery.port));
        }
        if (!pathSpecified) {
            filteredArgs.push('--daemon-path', discovery.endpointPath);
        }
        if (!tokenSpecified) {
            filteredArgs.push('--daemon-token', discovery.bearerToken);
        }
        if (!allowRootSpecified) {
            for (const allowRoot of discovery.allowedRoots) {
                filteredArgs.push('--allow-root', allowRoot);
            }
        }
    }

    return filteredArgs;
}

export async function restartDaemonProcess(
    args: string[],
    fallbackDiscovery: DaemonClientConfigFile | null = null
): Promise<RestartedDaemonResult> {
    const existingDiscovery = fallbackDiscovery
        || await readDaemonClientConfig({ requireLivePid: false }).catch(() => null);
    const restartArgs = buildDaemonRestartArgs(args, existingDiscovery);

    createMcpRuntimeConfig(restartArgs);

    const childEntrypoint = process.argv[1];
    if (!childEntrypoint) {
        throw new Error('Unable to determine the MCP entrypoint required to relaunch daemon mode.');
    }

    const child = spawnProcess(
        process.execPath,
        [...process.execArgv, childEntrypoint, ...restartArgs],
        {
            cwd: process.cwd(),
            detached: true,
            env: process.env,
            stdio: 'ignore'
        }
    );
    child.unref();

    const discovery = await waitForDaemonStartup(existingDiscovery?.runtimeId);
    return {
        discovery,
        cleanup: {
            removedRegistryFiles: [],
            removedRuntimeStatusFiles: [],
            removedClientConfig: false,
            recoveredSnapshotCodebases: [],
            removedUnreadableRegistryFiles: [],
            removedUnreadableClientConfig: false,
            hadCorruptedSnapshot: false
        },
        spawnedPid: child.pid ?? -1
    };
}
