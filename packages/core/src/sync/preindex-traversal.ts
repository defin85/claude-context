import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { envManager } from '../utils/env-manager';
import {
    OneCIndexScopeProfile,
    OneCIndexScopeSummary,
    createOneCIndexScopeSummary,
    evaluateOneCIndexScopePath,
    isReducedOneCIndexScopeProfile,
    recordOneCIndexScopeDecision,
    resolveOneCIndexScopeProfile,
} from './one-c-scope';

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

export interface PreIndexTraversalDiagnostics {
    engine: 'ts';
    requestedEngine: PreIndexTraversalEngine;
    engineFallbackReason?: string;
    directoriesVisited: number;
    directoryEntriesVisited: number;
    directoryReadErrors: number;
    filesSeen: number;
    unsupportedFilesByExtension: Record<string, number>;
    ignoredDirectories: number;
    ignoredFiles: number;
    selectedFiles: number;
    hashedFiles: number;
    hashBytes: number;
    matcherCalls: number;
    matcherMs: number;
    matcherCacheHits: number;
    matcherCacheMisses: number;
    matcherPatternEvaluations: number;
    enqueuedDirectories: number;
    enqueuedFiles: number;
    enqueuedTasks: number;
    completedTasks: number;
    maxQueueLength: number;
    maxActiveTasks: number;
    selectedPathFingerprint: string;
    selectedPathHashFingerprint: string;
    oneCIndexScope?: OneCIndexScopeSummary;
    timings: PreIndexTraversalTimings & {
        matcherMs: number;
    };
}

export type PreIndexTraversalEngine = 'ts' | 'native' | 'auto';

export interface PreIndexTraversalResult {
    rootDir: string;
    files: PreIndexTraversalFile[];
    selectedFileCount: number;
    hashedFileCount: number;
    concurrency: number;
    timings: PreIndexTraversalTimings;
    oneCIndexScope: OneCIndexScopeSummary;
    diagnostics?: PreIndexTraversalDiagnostics;
}

export interface PreIndexTraversalOptions {
    supportedExtensions: string[];
    ignorePatterns?: string[];
    includeHashes?: boolean;
    concurrency?: number;
    engine?: PreIndexTraversalEngine;
    diagnostics?: boolean;
    oneCIndexScopeProfile?: OneCIndexScopeProfile;
    abortSignal?: AbortSignal;
    readFile?: (filePath: string) => Promise<string>;
    progress?: (progress: {
        phase: 'traversal' | 'hashing';
        directoriesVisited: number;
        filesSeen: number;
        selectedFiles: number;
        hashedFiles: number;
        activeTasks: number;
        queuedTasks: number;
    }) => void;
}

interface CompiledIgnorePattern {
    raw: string;
    cleanPattern: string;
    cleanPartCount: number;
    isRootAnchored: boolean;
    isDirectoryPattern: boolean;
    hasPathSeparator: boolean;
    matchesBasename: boolean;
    regex: RegExp;
}

export interface PreIndexIgnoreMatcherStats {
    cacheHits: number;
    cacheMisses: number;
    patternEvaluations: number;
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
                cleanPartCount: cleanPattern.split('/').length,
                isRootAnchored: normalizedPattern.startsWith('/'),
                isDirectoryPattern: normalizedPattern.endsWith('/'),
                hasPathSeparator: cleanPattern.includes('/'),
                matchesBasename: !normalizedPattern.includes('/'),
                regex: globToRegex(cleanPattern),
            };
        })
        .filter((pattern) => pattern.cleanPattern.length > 0);
}

function getLastPathPart(filePath: string): string {
    const separatorIndex = filePath.lastIndexOf('/');
    return separatorIndex === -1 ? filePath : filePath.slice(separatorIndex + 1);
}

export class PreIndexIgnoreMatcher {
    private readonly patterns: CompiledIgnorePattern[];
    private readonly nonDirectoryPatterns: CompiledIgnorePattern[];
    private readonly directoryPatterns: CompiledIgnorePattern[];
    private readonly directoryDecisionCache = new Map<string, boolean>();
    private stats: PreIndexIgnoreMatcherStats = {
        cacheHits: 0,
        cacheMisses: 0,
        patternEvaluations: 0,
    };

    constructor(ignorePatterns: string[] = []) {
        this.patterns = compileIgnorePatterns(ignorePatterns);
        this.nonDirectoryPatterns = this.patterns.filter((pattern) => !pattern.isDirectoryPattern);
        this.directoryPatterns = this.patterns.filter((pattern) => pattern.isDirectoryPattern);
    }

    shouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
        const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!normalizedPath) {
            return false;
        }

        const pathParts = normalizedPath.split('/');
        for (const part of pathParts) {
            if (part.startsWith('.')) {
                return true;
            }
        }

        if (this.matchesAnyPattern(normalizedPath, isDirectory)) {
            return true;
        }

        let partialPath = '';
        const directoryPrefixLimit = isDirectory
            ? pathParts.length - 1
            : pathParts.length - 1;
        for (let i = 0; i < directoryPrefixLimit; i++) {
            partialPath = partialPath ? `${partialPath}/${pathParts[i]}` : pathParts[i];
            if (this.matchesDirectoryPrefix(partialPath)) {
                return true;
            }
        }

        return !isDirectory && this.matchesPatterns(normalizedPath, this.directoryPatterns, true);
    }

    getStats(): PreIndexIgnoreMatcherStats {
        return { ...this.stats };
    }

    private matchesAnyPattern(filePath: string, isDirectory: boolean): boolean {
        return this.matchesPatterns(
            filePath,
            isDirectory ? this.patterns : this.nonDirectoryPatterns,
            isDirectory,
        );
    }

    private matchesPatterns(
        filePath: string,
        patterns: CompiledIgnorePattern[],
        isDirectory: boolean,
    ): boolean {
        for (const pattern of patterns) {
            this.stats.patternEvaluations++;
            if (this.matchesPattern(filePath, pattern, isDirectory)) {
                return true;
            }
        }

        return false;
    }

    private matchesDirectoryPrefix(partialPath: string): boolean {
        const cached = this.directoryDecisionCache.get(partialPath);
        if (cached !== undefined) {
            this.stats.cacheHits++;
            return cached;
        }

        this.stats.cacheMisses++;
        const result = this.matchesPatterns(partialPath, this.patterns, true);
        this.directoryDecisionCache.set(partialPath, result);
        return result;
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

        return pattern.regex.test(getLastPathPart(filePath));
    }

    private matchesDirectoryPattern(filePath: string, pattern: CompiledIgnorePattern): boolean {
        const pathParts = filePath.split('/');
        const dirPartCount = pattern.cleanPartCount;

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

function isTruthy(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'json';
}

export function isPreIndexTraversalDiagnosticsEnabled(): boolean {
    return isTruthy(envManager.get('PREINDEX_TRAVERSAL_DIAGNOSTICS'));
}

function getPreIndexTraversalEngine(explicitEngine?: PreIndexTraversalEngine): {
    requestedEngine: PreIndexTraversalEngine;
    engine: 'ts';
    fallbackReason?: string;
} {
    const rawEngine = explicitEngine || envManager.get('PREINDEX_TRAVERSAL_ENGINE') || 'ts';
    if (rawEngine === 'ts') {
        return { requestedEngine: 'ts', engine: 'ts' };
    }
    if (rawEngine === 'auto' || rawEngine === 'native') {
        return {
            requestedEngine: rawEngine,
            engine: 'ts',
            fallbackReason: 'Native pre-index traversal is not available; using TypeScript traversal.',
        };
    }

    console.warn(
        `[PreIndexTraversal] Ignoring invalid PREINDEX_TRAVERSAL_ENGINE='${rawEngine}'. ` +
            'Using TypeScript traversal.',
    );
    return { requestedEngine: 'ts', engine: 'ts' };
}

function createPreIndexFingerprint(files: PreIndexTraversalFile[], includeHashes: boolean): {
    selectedPathFingerprint: string;
    selectedPathHashFingerprint: string;
} {
    const pathHash = crypto.createHash('sha256');
    const pathAndContentHash = crypto.createHash('sha256');

    for (const file of files) {
        pathHash.update(file.relativePath);
        pathHash.update('\0');
        pathAndContentHash.update(file.relativePath);
        pathAndContentHash.update('\0');
        if (includeHashes && file.hash) {
            pathAndContentHash.update(file.hash);
        }
        pathAndContentHash.update('\0');
    }

    return {
        selectedPathFingerprint: pathHash.digest('hex'),
        selectedPathHashFingerprint: pathAndContentHash.digest('hex'),
    };
}

function createUnsupportedExtensionKey(extension: string): string {
    return extension.toLowerCase() || '<none>';
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
    const engineSelection = getPreIndexTraversalEngine(options.engine);
    const oneCIndexScopeProfile = resolveOneCIndexScopeProfile(options.oneCIndexScopeProfile);
    const oneCIndexScope = createOneCIndexScopeSummary(oneCIndexScopeProfile);
    const includeHashes = options.includeHashes === true;
    const collectDiagnostics = options.diagnostics === true || isPreIndexTraversalDiagnosticsEnabled();
    const directories = [normalizedRoot];
    const files: PreIndexTraversalFile[] = [];
    const startedAt = Date.now();
    let scanMs = 0;
    let hashMs = 0;
    let directoriesVisited = 0;
    let filesSeen = 0;
    let selectedFiles = 0;
    let hashedFiles = 0;
    let activeTasks = 0;
    let queuedTaskCount = 0;
    let lastProgressAt = 0;
    const diagnostics: Omit<PreIndexTraversalDiagnostics, 'selectedFiles' | 'hashedFiles' | 'selectedPathFingerprint' | 'selectedPathHashFingerprint' | 'timings'> = {
        engine: engineSelection.engine,
        requestedEngine: engineSelection.requestedEngine,
        engineFallbackReason: engineSelection.fallbackReason,
        directoriesVisited: 0,
        directoryEntriesVisited: 0,
        directoryReadErrors: 0,
        filesSeen: 0,
        unsupportedFilesByExtension: {},
        ignoredDirectories: 0,
        ignoredFiles: 0,
        hashBytes: 0,
        matcherCalls: 0,
        matcherMs: 0,
        matcherCacheHits: 0,
        matcherCacheMisses: 0,
        matcherPatternEvaluations: 0,
        enqueuedDirectories: 0,
        enqueuedFiles: 0,
        enqueuedTasks: 0,
        completedTasks: 0,
        maxQueueLength: 0,
        maxActiveTasks: 0,
    };

    const hashFile = async (filePath: string): Promise<string> => {
        const hashStartedAt = Date.now();
        try {
            const content = options.readFile
                ? await options.readFile(filePath)
                : await fs.readFile(filePath, 'utf-8');
            if (collectDiagnostics) {
                diagnostics.hashBytes += Buffer.byteLength(content, 'utf-8');
            }
            return crypto.createHash('sha256').update(content).digest('hex');
        } finally {
            hashedFiles++;
            hashMs += Date.now() - hashStartedAt;
            emitProgress('hashing');
        }
    };

    const emitProgress = (phase: 'traversal' | 'hashing', force: boolean = false) => {
        if (!options.progress) {
            return;
        }

        const now = Date.now();
        if (!force && now - lastProgressAt < 1000) {
            return;
        }
        lastProgressAt = now;
        options.progress({
            phase,
            directoriesVisited,
            filesSeen,
            selectedFiles,
            hashedFiles,
            activeTasks,
            queuedTasks: queuedTaskCount,
        });
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
            if (collectDiagnostics) {
                diagnostics.directoryReadErrors++;
            }
            scanMs += Date.now() - scanStartedAt;
            return;
        }
        scanMs += Date.now() - scanStartedAt;
        directoriesVisited++;
        if (collectDiagnostics) {
            diagnostics.directoriesVisited++;
            diagnostics.directoryEntriesVisited += entries.length;
        }

        for (const entry of entries) {
            throwIfAborted(options.abortSignal);
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = path.relative(normalizedRoot, absolutePath).replace(/\\/g, '/');
            const isDirectory = entry.isDirectory();
            const isFile = entry.isFile();

            if (collectDiagnostics && isFile) {
                diagnostics.filesSeen++;
            }
            if (isFile) {
                filesSeen++;
            }

            const matcherStartedAt = collectDiagnostics ? Date.now() : 0;
            const ignored = matcher.shouldIgnore(relativePath, isDirectory);
            if (collectDiagnostics) {
                diagnostics.matcherCalls++;
                diagnostics.matcherMs += Date.now() - matcherStartedAt;
            }
            if (ignored) {
                if (collectDiagnostics) {
                    if (isDirectory) {
                        diagnostics.ignoredDirectories++;
                    } else if (isFile) {
                        diagnostics.ignoredFiles++;
                    }
                }
                continue;
            }

            if (isDirectory) {
                enqueueDirectory(absolutePath);
                continue;
            }

            if (!isFile) {
                continue;
            }

            const extension = path.extname(entry.name);
            if (supportedExtensionSet.size > 0 && !supportedExtensionSet.has(extension)) {
                if (collectDiagnostics) {
                    const extensionKey = createUnsupportedExtensionKey(extension);
                    diagnostics.unsupportedFilesByExtension[extensionKey] =
                        (diagnostics.unsupportedFilesByExtension[extensionKey] || 0) + 1;
                }
                continue;
            }

            const oneCScopeDecision = evaluateOneCIndexScopePath(relativePath, oneCIndexScopeProfile);
            recordOneCIndexScopeDecision(oneCIndexScope, oneCScopeDecision);
            if (!oneCScopeDecision.include) {
                continue;
            }

            enqueueFile({
                relativePath,
                absolutePath,
                extension,
            });
            selectedFiles++;
        }
        emitProgress('traversal');
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
            queuedTaskCount = queuedTasks.length;
            if (collectDiagnostics) {
                diagnostics.enqueuedDirectories++;
                diagnostics.enqueuedTasks++;
                diagnostics.maxQueueLength = Math.max(diagnostics.maxQueueLength, queuedTasks.length);
            }
            pump();
        };

        const enqueueFile = (file: Omit<PreIndexTraversalFile, 'hash' | 'order'>) => {
            queuedTasks.push(() => processFile(file));
            queuedTaskCount = queuedTasks.length;
            if (collectDiagnostics) {
                diagnostics.enqueuedFiles++;
                diagnostics.enqueuedTasks++;
                diagnostics.maxQueueLength = Math.max(diagnostics.maxQueueLength, queuedTasks.length);
            }
            pump();
        };

        const pump = () => {
            if (settled) {
                return;
            }
            while (active < concurrency && queuedTasks.length > 0) {
                const task = queuedTasks.shift()!;
                active++;
                activeTasks = active;
                queuedTaskCount = queuedTasks.length;
                if (collectDiagnostics) {
                    diagnostics.maxActiveTasks = Math.max(diagnostics.maxActiveTasks, active);
                }
                task()
                    .then(() => {
                        active--;
                        activeTasks = active;
                        queuedTaskCount = queuedTasks.length;
                        if (collectDiagnostics) {
                            diagnostics.completedTasks++;
                        }
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
            queuedTaskCount = queuedTasks.length;
            if (collectDiagnostics) {
                diagnostics.enqueuedDirectories++;
                diagnostics.enqueuedTasks++;
                diagnostics.maxQueueLength = Math.max(diagnostics.maxQueueLength, queuedTasks.length);
            }
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
    const totalMs = Date.now() - startedAt;
    const hashedFileCount = includeHashes ? files.filter((file) => typeof file.hash === 'string').length : 0;
    oneCIndexScope.active = oneCIndexScope.recognized || isReducedOneCIndexScopeProfile(oneCIndexScope.profile);
    if (isReducedOneCIndexScopeProfile(oneCIndexScope.profile) && !oneCIndexScope.recognized) {
        throw new Error(
            `1C_INDEX_SCOPE_PROFILE=${oneCIndexScope.profile} requires a recognized exported 1C configuration tree. ` +
                'Use full scope or index a 1C configuration export with stable 1C path conventions.',
        );
    }
    if (isReducedOneCIndexScopeProfile(oneCIndexScope.profile)) {
        oneCIndexScope.warning = `Index is intentionally scoped to 1C profile '${oneCIndexScope.profile}' and may not contain all files.`;
    }
    emitProgress(includeHashes ? 'hashing' : 'traversal', true);
    const fingerprints = collectDiagnostics
        ? createPreIndexFingerprint(files, includeHashes)
        : undefined;

    const result: PreIndexTraversalResult = {
        rootDir: normalizedRoot,
        files,
        selectedFileCount: files.length,
        hashedFileCount,
        concurrency,
        oneCIndexScope,
        timings: {
            scanMs,
            hashMs,
            fileListMs,
            totalMs,
        },
    };

    if (collectDiagnostics && fingerprints) {
        const matcherStats = matcher.getStats();
        result.diagnostics = {
            ...diagnostics,
            matcherCacheHits: matcherStats.cacheHits,
            matcherCacheMisses: matcherStats.cacheMisses,
            matcherPatternEvaluations: matcherStats.patternEvaluations,
            selectedFiles: files.length,
            hashedFiles: hashedFileCount,
            oneCIndexScope,
            selectedPathFingerprint: fingerprints.selectedPathFingerprint,
            selectedPathHashFingerprint: fingerprints.selectedPathHashFingerprint,
            timings: {
                ...result.timings,
                matcherMs: diagnostics.matcherMs,
            },
        };
    }

    return result;
}
