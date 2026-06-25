import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getErrorCode, getErrorMessage, normalizeCodebasePath } from './utils.js';

export interface RuntimeAllowRootsResult {
    roots: string[];
    error?: string;
}

export function getDefaultRuntimeAllowRootsPath(): string {
    return path.join(os.homedir(), '.context', 'mcp', 'daemon', 'allow-roots.json');
}

function isAcceptedAbsolutePath(value: string): boolean {
    return path.isAbsolute(value) || /^\\\\wsl(?:\.localhost)?\\/i.test(value);
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
