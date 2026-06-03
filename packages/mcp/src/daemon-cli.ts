import { connectToDiscoveredDaemon } from './daemon-client.js';
import {
    cleanupStaleDaemonState,
    restartDaemonProcess,
    waitForDaemonShutdown
} from './daemon-ops.js';
import {
    DAEMON_CLIENT_COMPATIBILITY_VERSION,
    readDaemonClientConfig,
    readDaemonOperatorStatus
} from './daemon-discovery.js';

interface DaemonCliCommand {
    type: 'discover' | 'status' | 'stop' | 'cancel' | 'cleanup-stale' | 'restart';
    path?: string;
}

interface TextToolResult {
    content?: Array<{ type?: string; text?: string }>;
}

function textFromToolResult(result: unknown): string {
    if (!result || typeof result !== 'object' || !('content' in result)) {
        return '';
    }

    const content = (result as TextToolResult).content;
    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .filter((item): item is { type: 'text'; text: string } => item?.type === 'text' && typeof item?.text === 'string')
        .map((item) => item.text)
        .join('\n');
}

function parseDaemonCliCommand(args: string[]): DaemonCliCommand | null {
    const commands: DaemonCliCommand[] = [];

    if (args.includes('--daemon-discover')) {
        commands.push({ type: 'discover' });
    }

    if (args.includes('--daemon-status')) {
        commands.push({ type: 'status' });
    }

    if (args.includes('--daemon-stop')) {
        commands.push({ type: 'stop' });
    }

    if (args.includes('--daemon-cleanup-stale')) {
        commands.push({ type: 'cleanup-stale' });
    }

    if (args.includes('--daemon-restart')) {
        commands.push({ type: 'restart' });
    }

    const cancelIndex = args.indexOf('--daemon-cancel');
    if (cancelIndex >= 0) {
        const targetPath = args[cancelIndex + 1];
        if (!targetPath) {
            throw new Error(`Missing value for '--daemon-cancel'. Expected an absolute codebase path.`);
        }
        commands.push({
            type: 'cancel',
            path: targetPath
        });
    }

    if (commands.length > 1) {
        throw new Error(
            `Multiple daemon admin commands were provided: ${commands.map((command) => command.type).join(', ')}. ` +
            `Run one daemon control command at a time.`
        );
    }

    return commands[0] || null;
}

export async function handleDaemonCliCommand(args: string[]): Promise<boolean> {
    const command = parseDaemonCliCommand(args);
    if (!command) {
        return false;
    }

    if (command.type === 'discover') {
        const discovery = await readDaemonClientConfig({
            expectedCompatibilityVersion: DAEMON_CLIENT_COMPATIBILITY_VERSION
        });
        if (!discovery) {
            throw new Error('No active daemon discovery file was found.');
        }

        process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`);
        return true;
    }

    if (command.type === 'status') {
        const status = await readDaemonOperatorStatus();
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return true;
    }

    if (command.type === 'cleanup-stale') {
        const cleanup = await cleanupStaleDaemonState();
        process.stdout.write(`${JSON.stringify(cleanup, null, 2)}\n`);
        return true;
    }

    if (command.type === 'restart') {
        const liveDiscovery = await readDaemonClientConfig({
            expectedCompatibilityVersion: DAEMON_CLIENT_COMPATIBILITY_VERSION
        }).catch(() => null);

        if (liveDiscovery) {
            const clientHandle = await connectToDiscoveredDaemon({
                clientName: 'claude-context-mcp-admin',
                clientVersion: '1.0.0',
                expectedCompatibilityVersion: DAEMON_CLIENT_COMPATIBILITY_VERSION
            });

            try {
                await clientHandle.client.callTool({
                    name: 'shutdown_daemon',
                    arguments: {
                        reason: 'restart requested by daemon operator'
                    }
                });
            } finally {
                await clientHandle.close();
            }

            await waitForDaemonShutdown(liveDiscovery.runtimeId);
        }

        const cleanup = await cleanupStaleDaemonState();
        const restarted = await restartDaemonProcess(args, liveDiscovery);

        process.stdout.write(`${JSON.stringify({
            runtimeId: restarted.discovery.runtimeId,
            pid: restarted.discovery.pid,
            endpointUrl: restarted.discovery.endpointUrl,
            allowedRoots: restarted.discovery.allowedRoots,
            spawnedPid: restarted.spawnedPid,
            cleanup
        }, null, 2)}\n`);
        return true;
    }

    const clientHandle = await connectToDiscoveredDaemon({
        clientName: 'claude-context-mcp-admin',
        clientVersion: '1.0.0',
        expectedCompatibilityVersion: DAEMON_CLIENT_COMPATIBILITY_VERSION
    });

    try {
        if (command.type === 'stop') {
            const result = await clientHandle.client.callTool({
                name: 'shutdown_daemon',
                arguments: {}
            });
            process.stdout.write(`${textFromToolResult(result)}\n`);
            return true;
        }

        if (command.type === 'cancel' && command.path) {
            const result = await clientHandle.client.callTool({
                name: 'cancel_codebase_workload',
                arguments: {
                    path: command.path
                }
            });
            process.stdout.write(`${textFromToolResult(result)}\n`);
            return true;
        }
    } finally {
        await clientHandle.close();
    }

    return true;
}
