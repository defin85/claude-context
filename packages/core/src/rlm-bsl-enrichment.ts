import * as path from 'path';
import { spawn } from 'child_process';
import { CodeChunk } from './splitter';

export type RlmBslProviderStatus = 'available' | 'missing_index' | 'stale' | 'busy' | 'error';
export type RlmBslEnrichmentStatus = 'available' | 'missing' | 'stale' | 'busy' | 'error';
export type RlmBslEnrichmentMode = 'disabled' | 'optional' | 'required';

export interface RlmBslEnrichmentLimits {
    maxFiles: number;
    maxSymbolsPerFile: number;
    maxSynonymsPerFile: number;
    maxStringLength: number;
    maxDiagnosticsBytes: number;
}

export const DEFAULT_RLM_BSL_ENRICHMENT_LIMITS: RlmBslEnrichmentLimits = {
    maxFiles: 100000,
    maxSymbolsPerFile: 500,
    maxSynonymsPerFile: 50,
    maxStringLength: 1024,
    maxDiagnosticsBytes: 16384,
};

export interface RlmBslRawSnapshotSymbol {
    name: string;
    declarationKind: string;
    startLine?: number;
    endLine?: number;
    isExport?: boolean;
    params?: string | null;
}

export interface RlmBslRawSnapshotFile {
    relativePath: string;
    objectName?: string;
    objectKind?: string;
    moduleKind?: string;
    formName?: string;
    synonyms?: string[];
    symbols?: RlmBslRawSnapshotSymbol[];
}

export interface RlmBslRawSnapshot {
    schemaVersion: number;
    provider: string;
    status: RlmBslProviderStatus;
    sourceRoot: string;
    sourceFingerprint: string;
    capabilities: Record<string, boolean>;
    files: RlmBslRawSnapshotFile[];
    diagnostics?: Record<string, unknown>;
}

export interface RlmBslEnrichmentSymbol {
    name: string;
    declarationKind: string;
    startLine?: number;
    endLine?: number;
    isExport?: boolean;
    params?: string | null;
}

export interface RlmBslEnrichmentFile {
    relativePath: string;
    objectName?: string;
    objectKind?: string;
    moduleKind?: string;
    formName?: string;
    synonyms: string[];
    symbols: RlmBslEnrichmentSymbol[];
}

export interface RlmBslEnrichmentSnapshot {
    schemaVersion: 1;
    provider: 'rlm-tools-bsl';
    providerSchemaVersion: number;
    status: RlmBslEnrichmentStatus;
    rawStatus: RlmBslProviderStatus;
    sourceRoot: string;
    sourceFingerprint: string;
    capabilities: Record<string, boolean>;
    files: RlmBslEnrichmentFile[];
    diagnostics: Record<string, unknown>;
}

export interface RlmBslCompatibilityProof {
    provider: 'rlm-tools-bsl';
    providerSchemaVersion: number;
    status: RlmBslEnrichmentStatus;
    rawStatus: RlmBslProviderStatus;
    sourceRoot: string;
    sourceFingerprint: string;
}

export interface CodebaseIndexEnrichmentSession {
    readonly status: RlmBslEnrichmentStatus | 'disabled' | 'unavailable';
    readonly diagnostics: Record<string, unknown>;
    getCompatibilityProof?(): RlmBslCompatibilityProof | undefined;
    enrichChunk(chunk: CodeChunk, codebasePath: string): Record<string, unknown> | undefined;
}

export interface CodebaseIndexEnricher {
    prepare(codebasePath: string): Promise<CodebaseIndexEnrichmentSession>;
}

export interface RlmBslIndexEnricherOptions {
    mode: RlmBslEnrichmentMode;
    snapshotLoader?: (codebasePath: string) => Promise<unknown> | unknown;
    limits?: Partial<RlmBslEnrichmentLimits>;
}

export interface RlmBslEnrichmentConfig {
    mode: RlmBslEnrichmentMode;
    command?: string;
    args?: string[];
    timeoutMs?: number;
    limits?: Partial<RlmBslEnrichmentLimits>;
}

export interface RlmBslSnapshotNormalizeOptions {
    codebasePath: string;
    limits?: Partial<RlmBslEnrichmentLimits>;
}

export interface RlmBslSnapshotPathInput {
    relativePath: string;
    sourceRoot: string;
    codebasePath: string;
}

export function parseRlmBslSnapshotJson(json: string, options: RlmBslSnapshotNormalizeOptions): RlmBslEnrichmentSnapshot {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new Error(`Invalid RLM BSL provider JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return normalizeRlmBslSnapshot(parsed, options);
}

export function normalizeRlmBslSnapshot(input: unknown, options: RlmBslSnapshotNormalizeOptions): RlmBslEnrichmentSnapshot {
    const limits = { ...DEFAULT_RLM_BSL_ENRICHMENT_LIMITS, ...(options.limits || {}) };
    const raw = requireRecord(input, 'snapshot');
    const schemaVersion = requireNumber(raw, 'schemaVersion');
    if (schemaVersion !== 1) {
        throw new Error(`Unsupported RLM BSL provider schemaVersion: ${schemaVersion}`);
    }

    const provider = requireString(raw, 'provider', limits);
    if (provider !== 'rlm-tools-bsl') {
        throw new Error(`Unsupported RLM BSL provider: ${provider}`);
    }

    const rawStatus = requireString(raw, 'status', limits);
    const status = normalizeRlmBslProviderStatus(rawStatus);
    const sourceRoot = normalizeAbsolutePath(requireString(raw, 'sourceRoot', limits));
    const sourceFingerprint = requireString(raw, 'sourceFingerprint', limits);
    const capabilities = requireBooleanRecord(raw.capabilities, 'capabilities');
    const rawFiles = requireArray(raw.files, 'files');
    assertArrayBound(rawFiles, limits.maxFiles, 'files');

    const files = rawFiles.map((file, index) => normalizeFile(file, index, sourceRoot, options.codebasePath, limits));
    const diagnostics = normalizeDiagnostics(raw.diagnostics, sourceFingerprint, limits);

    return {
        schemaVersion: 1,
        provider: 'rlm-tools-bsl',
        providerSchemaVersion: schemaVersion,
        status,
        rawStatus: rawStatus as RlmBslProviderStatus,
        sourceRoot,
        sourceFingerprint,
        capabilities,
        files,
        diagnostics,
    };
}

export function normalizeRlmBslProviderStatus(status: unknown): RlmBslEnrichmentStatus {
    switch (status) {
        case 'available':
            return 'available';
        case 'missing_index':
            return 'missing';
        case 'stale':
            return 'stale';
        case 'busy':
            return 'busy';
        case 'error':
            return 'error';
        default:
            throw new Error(`Unsupported RLM BSL provider status: ${String(status)}`);
    }
}

export function translateRlmBslSnapshotPath(input: RlmBslSnapshotPathInput): string {
    const relativePath = normalizeRelativePath(input.relativePath);
    const sourceRoot = normalizeAbsolutePath(input.sourceRoot);
    const codebasePath = normalizeAbsolutePath(input.codebasePath);
    const sourceRootWithinCodebase = path.relative(codebasePath, sourceRoot);

    if (!sourceRootWithinCodebase || sourceRootWithinCodebase === '.') {
        return relativePath;
    }
    if (!sourceRootWithinCodebase.startsWith('..') && !path.isAbsolute(sourceRootWithinCodebase)) {
        return normalizeRelativePath(path.join(sourceRootWithinCodebase, relativePath));
    }
    return relativePath;
}

export function getRlmBslCompatibilityProof(snapshot: RlmBslEnrichmentSnapshot): RlmBslCompatibilityProof {
    return {
        provider: snapshot.provider,
        providerSchemaVersion: snapshot.providerSchemaVersion,
        status: snapshot.status,
        rawStatus: snapshot.rawStatus,
        sourceRoot: snapshot.sourceRoot,
        sourceFingerprint: snapshot.sourceFingerprint,
    };
}

export class DisabledCodebaseIndexEnricher implements CodebaseIndexEnricher, CodebaseIndexEnrichmentSession {
    readonly status = 'disabled' as const;
    readonly diagnostics: Record<string, unknown>;

    constructor(reason = 'disabled') {
        this.diagnostics = { reason };
    }

    async prepare(): Promise<CodebaseIndexEnrichmentSession> {
        return this;
    }

    enrichChunk(): undefined {
        return undefined;
    }

    getCompatibilityProof(): undefined {
        return undefined;
    }
}

export class RlmBslIndexEnricher implements CodebaseIndexEnricher {
    private readonly mode: RlmBslEnrichmentMode;
    private readonly snapshotLoader?: (codebasePath: string) => Promise<unknown> | unknown;
    private readonly limits?: Partial<RlmBslEnrichmentLimits>;

    constructor(options: RlmBslIndexEnricherOptions) {
        this.mode = options.mode;
        this.snapshotLoader = options.snapshotLoader;
        this.limits = options.limits;
    }

    async prepare(codebasePath: string): Promise<CodebaseIndexEnrichmentSession> {
        if (this.mode === 'disabled') {
            return new DisabledCodebaseIndexEnricher('rlm-bsl enrichment disabled');
        }
        if (!this.snapshotLoader) {
            if (this.mode === 'required') {
                throw new Error('RLM BSL enrichment is required but no snapshot loader is configured.');
            }
            return new DisabledCodebaseIndexEnricher('rlm-bsl snapshot loader is not configured');
        }

        let snapshot: RlmBslEnrichmentSnapshot;
        try {
            const raw = await this.snapshotLoader(codebasePath);
            snapshot = typeof raw === 'string'
                ? parseRlmBslSnapshotJson(raw, { codebasePath, limits: this.limits })
                : normalizeRlmBslSnapshot(raw, { codebasePath, limits: this.limits });
        } catch (error) {
            if (this.mode === 'required') {
                throw new Error(`RLM BSL enrichment is required but snapshot loading failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            return new UnavailableCodebaseIndexEnrichmentSession({
                reason: 'snapshot loading failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (snapshot.status !== 'available') {
            if (this.mode === 'required') {
                throw new Error(`RLM BSL enrichment is required but provider status is ${snapshot.status}.`);
            }
            return new UnavailableCodebaseIndexEnrichmentSession({
                reason: 'provider unavailable',
                status: snapshot.status,
                rawStatus: snapshot.rawStatus,
                ...snapshot.diagnostics,
            });
        }

        return new RlmBslIndexEnrichmentSession(snapshot);
    }
}

export function createRlmBslIndexEnricher(config: RlmBslEnrichmentConfig): CodebaseIndexEnricher {
    const args = config.args || ['provider', 'export', '{codebasePath}', '--json'];
    const snapshotLoader = config.command
        ? (codebasePath: string) => runRlmBslExportCommand(
            config.command!,
            args.map((arg) => arg.split('{codebasePath}').join(codebasePath)),
            config.timeoutMs || 5000,
        )
        : undefined;

    return new RlmBslIndexEnricher({
        mode: config.mode,
        snapshotLoader,
        limits: config.limits,
    });
}

export function normalizeRlmBslEnrichmentConfig(config: RlmBslEnrichmentConfig | undefined): RlmBslEnrichmentConfig | undefined {
    if (!config || config.mode === 'disabled') {
        return config?.mode === 'disabled' ? { mode: 'disabled' } : undefined;
    }

    return removeUndefined({
        mode: config.mode,
        command: config.command,
        args: config.args ? [...config.args] : undefined,
        timeoutMs: config.timeoutMs,
        limits: config.limits ? { ...config.limits } : undefined,
    });
}

function runRlmBslExportCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            child.kill('SIGTERM');
            reject(new Error(`RLM BSL provider export timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(new Error(`RLM BSL provider export exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        });
    });
}

class UnavailableCodebaseIndexEnrichmentSession implements CodebaseIndexEnrichmentSession {
    readonly status = 'unavailable' as const;

    constructor(readonly diagnostics: Record<string, unknown>) {}

    enrichChunk(): undefined {
        return undefined;
    }

    getCompatibilityProof(): undefined {
        return undefined;
    }
}

class RlmBslIndexEnrichmentSession implements CodebaseIndexEnrichmentSession {
    readonly status = 'available' as const;
    readonly diagnostics: Record<string, unknown>;
    private readonly files = new Map<string, RlmBslEnrichmentFile>();
    private readonly compatibility: RlmBslCompatibilityProof;

    constructor(private readonly snapshot: RlmBslEnrichmentSnapshot) {
        this.compatibility = getRlmBslCompatibilityProof(snapshot);
        this.diagnostics = {
            provider: snapshot.provider,
            status: snapshot.status,
            rawStatus: snapshot.rawStatus,
            sourceRoot: snapshot.sourceRoot,
            sourceFingerprint: snapshot.sourceFingerprint,
        };
        for (const file of snapshot.files) {
            this.files.set(normalizeRelativePath(file.relativePath), file);
        }
    }

    enrichChunk(chunk: CodeChunk, codebasePath: string): Record<string, unknown> | undefined {
        const chunkFilePath = chunk.metadata.filePath;
        if (!chunkFilePath) {
            return undefined;
        }
        const relativePath = normalizeRelativePath(path.relative(codebasePath, chunkFilePath));
        const file = this.files.get(relativePath);
        if (!file) {
            return undefined;
        }
        const startLine = chunk.metadata.startLine || 0;
        const endLine = chunk.metadata.endLine || startLine;
        const symbols = file.symbols.filter((symbol) => symbolOverlapsChunk(symbol, startLine, endLine));
        return removeUndefined({
            provider: this.compatibility.provider,
            providerSchemaVersion: this.compatibility.providerSchemaVersion,
            status: this.compatibility.status,
            rawStatus: this.compatibility.rawStatus,
            sourceRoot: this.compatibility.sourceRoot,
            sourceFingerprint: this.compatibility.sourceFingerprint,
            relativePath,
            objectName: file.objectName,
            objectKind: file.objectKind,
            moduleKind: file.moduleKind,
            formName: file.formName,
            synonyms: file.synonyms,
            symbols,
        });
    }

    getCompatibilityProof(): RlmBslCompatibilityProof {
        return this.compatibility;
    }
}

function normalizeFile(
    value: unknown,
    index: number,
    sourceRoot: string,
    codebasePath: string,
    limits: RlmBslEnrichmentLimits,
): RlmBslEnrichmentFile {
    const raw = requireRecord(value, `files[${index}]`);
    const relativePath = translateRlmBslSnapshotPath({
        relativePath: requiredStringValue(raw.relativePath, `files[${index}].relativePath`, limits),
        sourceRoot,
        codebasePath,
    });
    const rawSynonyms = raw.synonyms === undefined ? [] : requireArray(raw.synonyms, `files[${index}].synonyms`);
    const rawSymbols = raw.symbols === undefined ? [] : requireArray(raw.symbols, `files[${index}].symbols`);
    assertArrayBound(rawSynonyms, limits.maxSynonymsPerFile, `files[${index}].synonyms`);
    assertArrayBound(rawSymbols, limits.maxSymbolsPerFile, `files[${index}].symbols`);

    return removeUndefined({
        relativePath,
        objectName: optionalString(raw.objectName, `files[${index}].objectName`, limits),
        objectKind: optionalString(raw.objectKind, `files[${index}].objectKind`, limits),
        moduleKind: optionalString(raw.moduleKind, `files[${index}].moduleKind`, limits),
        formName: optionalString(raw.formName, `files[${index}].formName`, limits),
        synonyms: rawSynonyms.map((synonym, synonymIndex) =>
            stringValue(synonym, `files[${index}].synonyms[${synonymIndex}]`, limits)),
        symbols: rawSymbols.map((symbol, symbolIndex) => normalizeSymbol(symbol, `files[${index}].symbols[${symbolIndex}]`, limits)),
    });
}

function symbolOverlapsChunk(symbol: RlmBslEnrichmentSymbol, chunkStartLine: number, chunkEndLine: number): boolean {
    const symbolStartLine = symbol.startLine ?? 0;
    const symbolEndLine = symbol.endLine ?? symbolStartLine;
    if (symbolStartLine <= 0 || symbolEndLine <= 0 || chunkStartLine <= 0 || chunkEndLine <= 0) {
        return false;
    }
    return symbolStartLine <= chunkEndLine && symbolEndLine >= chunkStartLine;
}

function normalizeSymbol(value: unknown, fieldName: string, limits: RlmBslEnrichmentLimits): RlmBslEnrichmentSymbol {
    const raw = requireRecord(value, fieldName);
    return removeUndefined({
        name: requiredStringValue(raw.name, `${fieldName}.name`, limits),
        declarationKind: requiredStringValue(raw.declarationKind, `${fieldName}.declarationKind`, limits),
        startLine: optionalNumber(raw.startLine, `${fieldName}.startLine`),
        endLine: optionalNumber(raw.endLine, `${fieldName}.endLine`),
        isExport: optionalBoolean(raw.isExport, `${fieldName}.isExport`),
        params: raw.params === null ? null : optionalString(raw.params, `${fieldName}.params`, limits),
    });
}

function normalizeDiagnostics(value: unknown, sourceFingerprint: string, limits: RlmBslEnrichmentLimits): Record<string, unknown> {
    const diagnostics = value === undefined ? {} : requireRecord(value, 'diagnostics');
    const result: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(diagnostics)) {
        if (typeof rawValue === 'string') {
            result[key] = rawValue.length > limits.maxStringLength
                ? rawValue.slice(0, limits.maxStringLength)
                : rawValue;
        } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || rawValue === null) {
            result[key] = rawValue;
        } else if (isJsonSafeObject(rawValue)) {
            result[key] = rawValue;
        }
    }
    result.sourceFingerprint = sourceFingerprint;
    const serialized = JSON.stringify(result);
    if (serialized.length > limits.maxDiagnosticsBytes) {
        return {
            truncated: true,
            sourceFingerprint,
        };
    }
    return result;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`RLM BSL provider ${fieldName} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`RLM BSL provider ${fieldName} must be an array.`);
    }
    return value;
}

function requireString(record: Record<string, unknown>, fieldName: string, limits: RlmBslEnrichmentLimits): string {
    if (!(fieldName in record)) {
        throw new Error(`RLM BSL provider missing required field: ${fieldName}`);
    }
    return stringValue(record[fieldName], fieldName, limits);
}

function requiredStringValue(value: unknown, fieldName: string, limits: RlmBslEnrichmentLimits): string {
    if (value === undefined) {
        throw new Error(`RLM BSL provider missing required field: ${fieldName}`);
    }
    return stringValue(value, fieldName, limits);
}

function optionalString(value: unknown, fieldName: string, limits: RlmBslEnrichmentLimits): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return stringValue(value, fieldName, limits);
}

function stringValue(value: unknown, fieldName: string, limits: RlmBslEnrichmentLimits): string {
    if (typeof value !== 'string') {
        throw new Error(`RLM BSL provider ${fieldName} must be a string.`);
    }
    if (value.length > limits.maxStringLength) {
        throw new Error(`RLM BSL provider ${fieldName} exceeds max string length ${limits.maxStringLength}.`);
    }
    return value;
}

function requireNumber(record: Record<string, unknown>, fieldName: string): number {
    if (!(fieldName in record)) {
        throw new Error(`RLM BSL provider missing required field: ${fieldName}`);
    }
    const value = record[fieldName];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`RLM BSL provider ${fieldName} must be a finite number.`);
    }
    return value;
}

function optionalNumber(value: unknown, fieldName: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`RLM BSL provider ${fieldName} must be a finite number.`);
    }
    return value;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`RLM BSL provider ${fieldName} must be a boolean.`);
    }
    return value;
}

function requireBooleanRecord(value: unknown, fieldName: string): Record<string, boolean> {
    const record = requireRecord(value, fieldName);
    const result: Record<string, boolean> = {};
    for (const [key, rawValue] of Object.entries(record)) {
        if (typeof rawValue !== 'boolean') {
            throw new Error(`RLM BSL provider ${fieldName}.${key} must be a boolean.`);
        }
        result[key] = rawValue;
    }
    return result;
}

function assertArrayBound(value: unknown[], maxLength: number, fieldName: string): void {
    if (value.length > maxLength) {
        throw new Error(`RLM BSL provider ${fieldName} exceeds max length ${maxLength}.`);
    }
}

function normalizeAbsolutePath(value: string): string {
    return path.normalize(value).replace(/\\/g, '/');
}

function normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function isJsonSafeObject(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    try {
        JSON.stringify(value);
        return true;
    } catch {
        return false;
    }
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
    for (const key of Object.keys(value)) {
        if (value[key] === undefined) {
            delete value[key];
        }
    }
    return value;
}
