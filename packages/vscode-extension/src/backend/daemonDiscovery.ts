import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const EXTENSION_DAEMON_DISCOVERY_FORMAT_VERSION = 'v1';
export const EXTENSION_DAEMON_COMPATIBILITY_VERSION = 1;

export interface ExtensionDaemonDiscoveryConfig {
    formatVersion: string;
    compatibilityVersion: number;
    runtimeId: string;
    pid: number;
    endpointUrl: string;
    bearerToken: string;
}

function getDiscoveryConfigPath(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'daemon', 'client-config.json');
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        return error?.code === 'EPERM';
    }
}

export async function readExtensionDaemonDiscoveryConfig(
    requireLivePid: boolean = true
): Promise<ExtensionDaemonDiscoveryConfig | null> {
    let payload: ExtensionDaemonDiscoveryConfig;

    try {
        payload = JSON.parse(await fs.readFile(getDiscoveryConfigPath(), 'utf8')) as ExtensionDaemonDiscoveryConfig;
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }

    if (payload.formatVersion !== EXTENSION_DAEMON_DISCOVERY_FORMAT_VERSION) {
        throw new Error(
            `Unsupported daemon discovery format '${payload.formatVersion}'. Expected '${EXTENSION_DAEMON_DISCOVERY_FORMAT_VERSION}'.`
        );
    }

    if (payload.compatibilityVersion !== EXTENSION_DAEMON_COMPATIBILITY_VERSION) {
        throw new Error(
            `Incompatible daemon compatibility version ${payload.compatibilityVersion}. ` +
            `Expected ${EXTENSION_DAEMON_COMPATIBILITY_VERSION}.`
        );
    }

    if (requireLivePid && !isPidAlive(payload.pid)) {
        return null;
    }

    return payload;
}
