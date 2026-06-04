import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { envManager } from '../utils/env-manager';

const DEFAULT_PREINDEX_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length || 2));
const MAX_PREINDEX_CONCURRENCY = 64;

export interface PreIndexTraversalFile {
    relativePath: string;
    absolutePath: string;
    extension: string;
    hash?: string;
    order: number;
}

export interface PreIndexTraversalTimings {
    scanMs: number;
    hashMs: number;
    fileListMs: number;
    totalMs: number;
}

export interface PreIndexTraversalResult {
    rootDir: string;
    files: PreIndexTraversalFile[];
    selectedFileCount: number;
    hashedFileCount: number;
    concurrency: number;
    timings: PreIndexTraversalTimings;
}

export interface PreIndexTraversalOptions {
    supportedExtensions: string[];
    ignorePatterns?: string[];
    includeHashes?: boolean;
    concurrency?: number;
    abortSignal?: AbortSignal;
    readFile?: (filePath: string) => Promise<string>;
}

interface CompiledIgnorePattern {
    raw: string;
    cleanPattern: string;
    isRootAnchored: boolean;
    isDirectoryPattern: boolean;
    hasPathSeparator: boolean;
    matchesBasename: boolean;
    regex: RegExp;
}

function throwIfAborted(abortSignal?: AbortSignal): void {
    if (!abortSignal?.aborted) {
        return;
    }

    const reason = abortSignal.reason;
    if (reason instanceof Error) {
        throw reason;
    }
    throw new Error(typeof reason === 'string' ? reason : 'Pre-index traversal cancelled.');
}

function normalizeExtensions(extensions: string[]): string[] {
    return [
        ...new Set(
            extensions
                .map((ext) => ext.trim())
                .filter((ext) => ext.length > 0)
                .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)),
        ),
    ];
}

function globToRegex(pattern: string): RegExp {
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`);
}

function compileIgnorePatterns(ignorePatterns: string[] = []): CompiledIgnorePattern[] {
    return ignorePatterns
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0)
        .map((pattern) => {
            const normalizedPattern = pattern.replace(/\\/g, '/');
            const cleanPattern = normalizedPattern.replace(/^\/+|\/+$/g, '');
            return {
                raw: normalizedPattern,
                cleanPattern,
                isRootAnchored: normalizedPattern.startsWith('/'),
                isDirectoryPattern: normalizedPattern.endsWith('/'),
                hasPathSeparator: cleanPattern.includes('/'),
                matchesBasename: !normalizedPattern.includes('/'),
                regex: globToRegex(cleanPattern),
            };
        })
        .filter((pattern) => pattern.cleanPattern.length > 0);
}

export class PreIndexIgnoreMatcher {
    private readonly patterns: CompiledIgnorePattern[];

    constructor(ignorePatterns: string[] = []) {
        this.patterns = compileIgnorePatterns(ignorePatterns);
    }

    shouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
        const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!normalizedPath) {
            return false;
        }

        const pathParts = normalizedPath.split('/');
        if (pathParts.some((part) => part.startsWith('.'))) {
            return true;
        }

        for (const pattern of this.patterns) {
            if (this.matchesPattern(normalizedPath, pattern, isDirectory)) {
                return true;
            }
        }

        for (let i = 0; i < pathParts.length; i++) {
            const partialPath = pathParts.slice(0, i + 1).join('/');
            for (const pattern of this.patterns) {
                if (this.matchesPattern(partialPath, pattern, true)) {
                    return true;
                }
                if (pattern.matchesBasename && pattern.regex.test(pathParts[i])) {
                    return true;
                }
            }
        }

        return false;
    }

    private matchesPattern(filePath: string, pattern: CompiledIgnorePattern, isDirectory: boolean): boolean {
        if (pattern.isDirectoryPattern) {
            if (!isDirectory) {
                return false;
            }
            if (pattern.isRootAnchored) {
                return pattern.regex.test(filePath);
            }
            return this.matchesDirectoryPattern(filePath, pattern);
        }

        if (pattern.isRootAnchored) {
            return pattern.regex.test(filePath);
        }

        if (pattern.hasPathSeparator) {
            return pattern.regex.test(filePath);
        }

        return pattern.regex.test(path.basename(filePath));
    }

    private matchesDirectoryPattern(filePath: string, pattern: CompiledIgnorePattern): boolean {
        const pathParts = filePath.split('/');
        const dirPartCount = pattern.cleanPattern.split('/').length;

        for (let i = 0; i <= pathParts.length - dirPartCount; i++) {
            const candidate = pathParts.slice(i, i + dirPartCount).join('/');
            if (pattern.regex.test(candidate)) {
                return true;
            }
        }

        return false;
    }
}

export function getPreIndexTraversalConcurrency(explicitConcurrency?: number): number {
    const rawValue =
        explicitConcurrency?.toString() ||
        envManager.get('PREINDEX_TRAVERSAL_CONCURRENCY') ||
        envManager.get('INDEX_PREINDEX_CONCURRENCY');
    if (!rawValue || rawValue.toLowerCase() === 'auto') {
        return DEFAULT_PREINDEX_CONCURRENCY;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
        return Math.max(1, Math.min(MAX_PREINDEX_CONCURRENCY, parsed));
    }

    console.warn(
        `[PreIndexTraversal] Ignoring invalid PREINDEX_TRAVERSAL_CONCURRENCY='${rawValue}'. ` +
            `Using default ${DEFAULT_PREINDEX_CONCURRENCY}.`,
    );
    return DEFAULT_PREINDEX_CONCURRENCY;
}

export async function traversePreIndex(
    rootDir: string,
    options: PreIndexTraversalOptions,
): Promise<PreIndexTraversalResult> {
    const normalizedRoot = path.resolve(rootDir);
    const supportedExtensions = normalizeExtensions(options.supportedExtensions);
    const supportedExtensionSet = new Set(supportedExtensions);
    const matcher = new PreIndexIgnoreMatcher(options.ignorePatterns || []);
    const concurrency = getPreIndexTraversalConcurrency(options.concurrency);
    const includeHashes = options.includeHashes === true;
    const directories = [normalizedRoot];
    const files: PreIndexTraversalFile[] = [];
    const startedAt = Date.now();
    let scanMs = 0;
    let hashMs = 0;

    const hashFile = async (filePath: string): Promise<string> => {
        const hashStartedAt = Date.now();
        try {
            const content = options.readFile
                ? await options.readFile(filePath)
                : await fs.readFile(filePath, 'utf-8');
            return crypto.createHash('sha256').update(content).digest('hex');
        } finally {
            hashMs += Date.now() - hashStartedAt;
        }
    };

    const processDirectory = async (
        currentPath: string,
        enqueueDirectory: (dir: string) => void,
        enqueueFile: (file: Omit<PreIndexTraversalFile, 'hash' | 'order'>) => void,
    ): Promise<void> => {
        throwIfAborted(options.abortSignal);
        let entries;
        const scanStartedAt = Date.now();
        try {
            entries = await fs.readdir(currentPath, { withFileTypes: true });
        } catch (error: any) {
            console.warn(`[PreIndexTraversal] Cannot read directory ${currentPath}: ${error.message}`);
            scanMs += Date.now() - scanStartedAt;
            return;
        }
        scanMs += Date.now() - scanStartedAt;

        for (const entry of entries) {
            throwIfAborted(options.abortSignal);
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = path.relative(normalizedRoot, absolutePath).replace(/\\/g, '/');

            if (matcher.shouldIgnore(relativePath, entry.isDirectory())) {
                continue;
            }

            if (entry.isDirectory()) {
                enqueueDirectory(absolutePath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const extension = path.extname(entry.name);
            if (supportedExtensionSet.size > 0 && !supportedExtensionSet.has(extension)) {
                continue;
            }

            enqueueFile({
                relativePath,
                absolutePath,
                extension,
            });
        }
    };

    const processFile = async (file: Omit<PreIndexTraversalFile, 'hash' | 'order'>): Promise<void> => {
        try {
            files.push({
                ...file,
                hash: includeHashes ? await hashFile(file.absolutePath) : undefined,
                order: 0,
            });
        } catch (error: any) {
            console.warn(`[PreIndexTraversal] Cannot hash file ${file.absolutePath}: ${error.message}`);
        }
    };

    await new Promise<void>((resolve, reject) => {
        let active = 0;
        let settled = false;
        const queuedTasks: Array<() => Promise<void>> = [];

        const finishIfIdle = () => {
            if (!settled && active === 0 && queuedTasks.length === 0) {
                settled = true;
                resolve();
            }
        };

        const enqueueDirectory = (dir: string) => {
            queuedTasks.push(() => processDirectory(dir, enqueueDirectory, enqueueFile));
            pump();
        };

        const enqueueFile = (file: Omit<PreIndexTraversalFile, 'hash' | 'order'>) => {
            queuedTasks.push(() => processFile(file));
            pump();
        };

        const pump = () => {
            if (settled) {
                return;
            }
            while (active < concurrency && queuedTasks.length > 0) {
                const task = queuedTasks.shift()!;
                active++;
                task()
                    .then(() => {
                        active--;
                        pump();
                        finishIfIdle();
                    })
                    .catch((error) => {
                        if (!settled) {
                            settled = true;
                            reject(error);
                        }
                    });
            }
            finishIfIdle();
        };

        for (const dir of directories) {
            queuedTasks.push(() => processDirectory(dir, enqueueDirectory, enqueueFile));
        }
        directories.length = 0;
        pump();
    });

    const fileListStartedAt = Date.now();
    files.sort((left, right) => {
        if (left.relativePath < right.relativePath) {
            return -1;
        }
        if (left.relativePath > right.relativePath) {
            return 1;
        }
        return 0;
    });
    files.forEach((file, index) => {
        file.order = index;
    });
    const fileListMs = Date.now() - fileListStartedAt;

    return {
        rootDir: normalizedRoot,
        files,
        selectedFileCount: files.length,
        hashedFileCount: includeHashes ? files.filter((file) => typeof file.hash === 'string').length : 0,
        concurrency,
        timings: {
            scanMs,
            hashMs,
            fileListMs,
            totalMs: Date.now() - startedAt,
        },
    };
}
