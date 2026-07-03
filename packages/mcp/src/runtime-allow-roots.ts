import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getErrorCode, getErrorMessage, normalizeCodebasePath } from './utils.js';

export interface RuntimeAllowRootsResult {
    roots: string[];
    error?: string;
}

export interface AddRuntimeAllowRootInput {
    filePath: string;
    auditPath?: string;
    path: string;
    actor?: string;
    reason?: string;
    timestamp?: string;
}

export interface AddRuntimeAllowRootResult {
    path: string;
    added: boolean;
    roots: string[];
    filePath: string;
    auditPath: string;
}

export function getDefaultRuntimeAllowRootsPath(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'daemon', 'allow-roots.json');
}

function isAcceptedAbsolutePath(value: string): boolean {
    return path.isAbsolute(value) || /^\\\\wsl(?:\.localhost)?\\/i.test(value);
}

function assertLocalAbsolutePosixPath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Allowed root path is required.');
    }
    if (/^\\\\wsl(?:\.localhost)?\\/i.test(trimmed)) {
        throw new Error(`Allowed root '${value}' must be a local POSIX path.`);
    }
    if (!path.isAbsolute(trimmed)) {
        throw new Error(`Allowed root '${value}' must be absolute.`);
    }
    return normalizeCodebasePath(trimmed);
}

export async function readRuntimeAllowRoots(filePath: string): Promise<RuntimeAllowRootsResult> {
    let raw: string;
    try {
        raw = await fs.promises.readFile(filePath, 'utf8');
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return { roots: [] };
        }
        return { roots: [], error: getErrorMessage(error) };
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        const values = Array.isArray(parsed)
            ? parsed
            : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { allowedRoots?: unknown }).allowedRoots)
                ? (parsed as { allowedRoots: unknown[] }).allowedRoots
                : undefined;

        if (!values) {
            return { roots: [], error: 'Runtime allow roots file must be a JSON array or an object with allowedRoots array.' };
        }

        const roots = values.map((value) => {
            if (typeof value !== 'string' || !value.trim()) {
                throw new Error('Runtime allow roots entries must be non-empty strings.');
            }
            if (!isAcceptedAbsolutePath(value.trim())) {
                throw new Error(`Runtime allow root '${value}' must be absolute.`);
            }
            return normalizeCodebasePath(value);
        });

        return { roots: [...new Set(roots)] };
    } catch (error) {
        return { roots: [], error: getErrorMessage(error) };
    }
}

export async function addRuntimeAllowRoot(input: AddRuntimeAllowRootInput): Promise<AddRuntimeAllowRootResult> {
    const normalizedPath = assertLocalAbsolutePosixPath(input.path);
    const filePath = path.resolve(input.filePath);
    const auditPath = path.resolve(input.auditPath || `${filePath}.audit.jsonl`);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.mkdir(path.dirname(auditPath), { recursive: true });

    const current = await readRuntimeAllowRoots(filePath);
    if (current.error) {
        throw new Error(`Cannot read runtime allow roots from '${filePath}': ${current.error}`);
    }

    const roots = current.roots.includes(normalizedPath)
        ? current.roots
        : [...current.roots, normalizedPath];
    const added = roots.length !== current.roots.length;

    await fs.promises.writeFile(filePath, `${JSON.stringify({ allowedRoots: roots }, null, 2)}\n`);
    await fs.promises.appendFile(auditPath, `${JSON.stringify({
        timestamp: input.timestamp || new Date().toISOString(),
        action: 'add_allowed_root',
        actor: input.actor || 'mcp:add_allowed_root',
        path: normalizedPath,
        added,
        reason: input.reason || '',
    })}\n`);

    return {
        path: normalizedPath,
        added,
        roots,
        filePath,
        auditPath,
    };
}
