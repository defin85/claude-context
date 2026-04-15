import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    DAEMON_CLIENT_COMPATIBILITY_VERSION,
    DaemonClientConfigFile,
    readDaemonClientConfig
} from './daemon-discovery.js';

interface ConnectToDiscoveredDaemonOptions {
    clientName: string;
    clientVersion: string;
    expectedCompatibilityVersion?: number;
}

export interface ConnectedDaemonClient {
    client: Client;
    transport: StreamableHTTPClientTransport;
    discovery: DaemonClientConfigFile;
    close: () => Promise<void>;
}

export async function connectToDiscoveredDaemon(
    options: ConnectToDiscoveredDaemonOptions
): Promise<ConnectedDaemonClient> {
    const discovery = await readDaemonClientConfig({
        expectedCompatibilityVersion: options.expectedCompatibilityVersion ?? DAEMON_CLIENT_COMPATIBILITY_VERSION
    });

    if (!discovery) {
        throw new Error(
            'No active daemon client config was found. Start the daemon first with ' +
            '`--mode daemon` or configure updated clients explicitly.'
        );
    }

    const transport = new StreamableHTTPClientTransport(new URL(discovery.endpointUrl), {
        requestInit: {
            headers: {
                Authorization: `Bearer ${discovery.bearerToken}`
            }
        }
    });
    const client = new Client({
        name: options.clientName,
        version: options.clientVersion
    });

    await client.connect(transport);

    return {
        client,
        transport,
        discovery,
        close: async () => {
            try {
                await client.close();
            } finally {
                await transport.close();
            }
        }
    };
}
