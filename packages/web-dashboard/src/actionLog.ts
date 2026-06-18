export type DashboardAction = 'refresh' | 'index' | 'cancel' | 'clear' | 'search' | 'copy-diagnostics';
export type ActionLogStatus = 'started' | 'success' | 'failure';

export interface ActionLogEntry {
    id: string;
    timestamp: string;
    action: DashboardAction;
    status: ActionLogStatus;
    targetPath?: string;
    durationMs?: number;
    error?: string;
}

export interface ActionRecorder {
    record<T>(action: DashboardAction, run: () => Promise<T>, options?: { targetPath?: string }): Promise<T>;
}

export interface DiagnosticsPayload {
    generatedAt: string;
    daemon: unknown;
    selected: {
        codebasePath: string;
        status: unknown;
    };
    actionLog: ActionLogEntry[];
}

export const maxActionLogEntries = 30;

const secretKeyPattern = /((?:authorization|cookie|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|bearer[_-]?token|milvus[_-]?token|token|secret|password|passwd|pwd)\s*[:=]\s*)([^,\s"'}\]]+)/gi;
const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const quotedSecretPattern = /("(?:authorization|cookie|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|bearer[_-]?token|milvus[_-]?token|token|secret|password|passwd|pwd)"\s*:\s*")([^"]*)(")/gi;

export function createActionRecorder(options: {
    entries: ActionLogEntry[];
    maxEntries?: number;
    now?: () => number;
}): ActionRecorder {
    const maxEntries = options.maxEntries ?? maxActionLogEntries;
    const now = options.now ?? Date.now;

    return {
        async record<T>(action: DashboardAction, run: () => Promise<T>, recordOptions: { targetPath?: string } = {}): Promise<T> {
            const start = now();
            try {
                const result = await run();
                appendEntry(options.entries, {
                    id: createEntryId(action, start),
                    timestamp: new Date(start).toISOString(),
                    action,
                    status: 'success',
                    targetPath: recordOptions.targetPath,
                    durationMs: Math.max(0, now() - start),
                }, maxEntries);
                return result;
            } catch (error) {
                appendEntry(options.entries, {
                    id: createEntryId(action, start),
                    timestamp: new Date(start).toISOString(),
                    action,
                    status: 'failure',
                    targetPath: recordOptions.targetPath,
                    durationMs: Math.max(0, now() - start),
                    error: sanitizeError(error),
                }, maxEntries);
                throw error;
            }
        },
    };
}

export function redactSecrets(value: string): string {
    return value
        .replace(quotedSecretPattern, '$1[redacted]$3')
        .replace(bearerPattern, '$1[redacted]')
        .replace(secretKeyPattern, '$1[redacted]');
}

export function sanitizeError(error: unknown): string {
    return redactSecrets(error instanceof Error ? error.message : String(error));
}

export function createDiagnosticsPayload(input: {
    daemonSummary: unknown;
    selectedPath: string;
    selectedStatus: unknown;
    actionLog: ActionLogEntry[];
    now?: () => number;
}): DiagnosticsPayload {
    return sanitizeObject({
        generatedAt: new Date((input.now ?? Date.now)()).toISOString(),
        daemon: input.daemonSummary,
        selected: {
            codebasePath: input.selectedPath,
            status: input.selectedStatus,
        },
        actionLog: input.actionLog,
    }) as DiagnosticsPayload;
}

function appendEntry(entries: ActionLogEntry[], entry: ActionLogEntry, maxEntries: number): void {
    entries.push(entry);
    if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
    }
}

function createEntryId(action: DashboardAction, timestamp: number): string {
    return `${timestamp}-${action}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeObject(value: unknown): unknown {
    if (typeof value === 'string') {
        return redactSecrets(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeObject(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        output[key] = isSecretKey(key) ? '[redacted]' : sanitizeObject(nestedValue);
    }
    return output;
}

function isSecretKey(key: string): boolean {
    if (/sha256|hash|fingerprint/i.test(key)) {
        return false;
    }
    return /authorization|cookie|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|bearer[_-]?token|milvus[_-]?token|token|secret|password|passwd|pwd/i.test(key);
}
