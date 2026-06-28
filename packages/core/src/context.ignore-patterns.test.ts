import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
    Context,
    Embedding,
    EmbeddingVector,
    FileSynchronizer,
    traversePreIndex,
    Splitter,
    CodeChunk,
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult,
    getCodeChunkLimit,
    parseCodeChunkLimit,
} from './index';

class TestEmbedding extends Embedding {
    protected maxTokens = 8192;

    async detectDimension(): Promise<number> {
        return 3;
    }

    async embed(): Promise<EmbeddingVector> {
        return { vector: [1, 0, 0], dimension: 3 };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map(() => ({ vector: [1, 0, 0], dimension: 3 }));
    }

    getDimension(): number {
        return 3;
    }

    getProvider(): string {
        return 'test';
    }
}

class TestSplitter implements Splitter {
    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return [
            {
                content: code,
                metadata: {
                    startLine: 1,
                    endLine: Math.max(1, code.split('\n').length),
                    language,
                    filePath,
                },
            },
        ];
    }

    setChunkSize(): void {}
    setChunkOverlap(): void {}
}

class TestVectorDatabase implements VectorDatabase {
    collections = new Set<string>();
    documents = new Map<string, VectorDocument[]>();
    searchResults: VectorSearchResult[] = [];

    async createCollection(collectionName: string): Promise<void> {
        this.collections.add(collectionName);
        this.documents.set(collectionName, []);
    }

    async createHybridCollection(collectionName: string): Promise<void> {
        await this.createCollection(collectionName);
    }

    async createBgeM3Collection(collectionName: string): Promise<void> {
        await this.createCollection(collectionName);
    }

    async dropCollection(collectionName: string): Promise<void> {
        this.collections.delete(collectionName);
        this.documents.delete(collectionName);
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        return this.collections.has(collectionName);
    }

    async listCollections(): Promise<string[]> {
        return [...this.collections];
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        this.documents.set(collectionName, [
            ...(this.documents.get(collectionName) || []),
            ...documents,
        ]);
    }

    async insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.insert(collectionName, documents);
    }

    async insertBgeM3(collectionName: string, documents: VectorDocument[]): Promise<void> {
        await this.insert(collectionName, documents);
    }

    async search(): Promise<VectorSearchResult[]> {
        return this.searchResults;
    }

    async hybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        return this.searchResults;
    }

    async bgeM3HybridSearch(
        _collectionName: string,
        _searchRequests: HybridSearchRequest[],
        _options?: HybridSearchOptions,
    ): Promise<HybridSearchResult[]> {
        return this.searchResults;
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        const current = this.documents.get(collectionName) || [];
        this.documents.set(
            collectionName,
            current.filter((document) => !ids.includes(document.id)),
        );
    }

    async query(collectionName: string): Promise<Record<string, any>[]> {
        return (this.documents.get(collectionName) || []).slice(0, 1);
    }

    async getCollectionDescription(): Promise<string> {
        return '';
    }

    async checkCollectionLimit(): Promise<boolean> {
        return true;
    }

    async getCollectionRowCount(collectionName: string): Promise<number> {
        return this.documents.get(collectionName)?.length ?? -1;
    }
}

class FailingInsertVectorDatabase extends TestVectorDatabase {
    async insert(): Promise<void> {
        throw new Error('simulated insert failure');
    }
}

class FailOnNthInsertVectorDatabase extends TestVectorDatabase {
    insertCalls = 0;

    constructor(public failOnNthInsert: number) {
        super();
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        this.insertCalls++;
        if (this.insertCalls === this.failOnNthInsert) {
            throw new Error(`simulated insert failure ${this.insertCalls}`);
        }
        await super.insert(collectionName, documents);
    }
}

function createContext(vectorDatabase = new TestVectorDatabase()): Context {
    return new Context({
        embedding: new TestEmbedding(),
        vectorDatabase,
        codeSplitter: new TestSplitter(),
        initialIndexingManifestRoot: path.join(os.tmpdir(), `claude-context-core-manifests-${process.pid}`),
    });
}

async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'claude-context-core-'));
}

async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
}

interface BaselineIgnorePattern {
    cleanPattern: string;
    isRootAnchored: boolean;
    isDirectoryPattern: boolean;
    hasPathSeparator: boolean;
    matchesBasename: boolean;
    regex: RegExp;
}

function baselineGlobToRegex(pattern: string): RegExp {
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`);
}

function compileBaselineIgnorePatterns(ignorePatterns: string[]): BaselineIgnorePattern[] {
    return ignorePatterns
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0)
        .map((pattern) => {
            const normalizedPattern = pattern.replace(/\\/g, '/');
            const cleanPattern = normalizedPattern.replace(/^\/+|\/+$/g, '');
            return {
                cleanPattern,
                isRootAnchored: normalizedPattern.startsWith('/'),
                isDirectoryPattern: normalizedPattern.endsWith('/'),
                hasPathSeparator: cleanPattern.includes('/'),
                matchesBasename: !normalizedPattern.includes('/'),
                regex: baselineGlobToRegex(cleanPattern),
            };
        })
        .filter((pattern) => pattern.cleanPattern.length > 0);
}

function baselineMatchesDirectoryPattern(filePath: string, pattern: BaselineIgnorePattern): boolean {
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

function baselineMatchesPattern(filePath: string, pattern: BaselineIgnorePattern, isDirectory: boolean): boolean {
    if (pattern.isDirectoryPattern) {
        if (!isDirectory) {
            return false;
        }
        if (pattern.isRootAnchored) {
            return pattern.regex.test(filePath);
        }
        return baselineMatchesDirectoryPattern(filePath, pattern);
    }

    if (pattern.isRootAnchored) {
        return pattern.regex.test(filePath);
    }

    if (pattern.hasPathSeparator) {
        return pattern.regex.test(filePath);
    }

    return pattern.regex.test(path.basename(filePath));
}

function baselineShouldIgnore(
    relativePath: string,
    isDirectory: boolean,
    patterns: BaselineIgnorePattern[],
): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalizedPath) {
        return false;
    }

    const pathParts = normalizedPath.split('/');
    if (pathParts.some((part) => part.startsWith('.'))) {
        return true;
    }

    for (const pattern of patterns) {
        if (baselineMatchesPattern(normalizedPath, pattern, isDirectory)) {
            return true;
        }
    }

    for (let i = 0; i < pathParts.length; i++) {
        const partialPath = pathParts.slice(0, i + 1).join('/');
        for (const pattern of patterns) {
            if (baselineMatchesPattern(partialPath, pattern, true)) {
                return true;
            }
            if (pattern.matchesBasename && pattern.regex.test(pathParts[i])) {
                return true;
            }
        }
    }

    return false;
}

async function baselineTraverseFiles(
    root: string,
    ignorePatterns: string[],
    supportedExtensions: string[],
): Promise<Map<string, string>> {
    const compiledPatterns = compileBaselineIgnorePatterns(ignorePatterns);
    const supportedExtensionSet = new Set(supportedExtensions);
    const selected = new Map<string, string>();
    const directories = [root];

    while (directories.length > 0) {
        const currentPath = directories.shift()!;
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
            if (baselineShouldIgnore(relativePath, entry.isDirectory(), compiledPatterns)) {
                continue;
            }
            if (entry.isDirectory()) {
                directories.push(absolutePath);
                continue;
            }
            if (!entry.isFile() || !supportedExtensionSet.has(path.extname(entry.name))) {
                continue;
            }
            const content = await fs.readFile(absolutePath, 'utf-8');
            selected.set(
                relativePath,
                crypto.createHash('sha256').update(content).digest('hex'),
            );
        }
    }

    return new Map([...selected.entries()].sort(([left], [right]) => {
        if (left < right) {
            return -1;
        }
        if (left > right) {
            return 1;
        }
        return 0;
    }));
}

describe('Context per-codebase options and ignore handling', () => {
    const originalHybridMode = process.env.HYBRID_MODE;
    const originalCodeChunkLimit = process.env.CODE_CHUNK_LIMIT;
    const originalIndexAcceleratorMode = process.env.INDEX_ACCELERATOR_MODE;
    const originalIndexEmbeddingBatchSize = process.env.INDEX_EMBEDDING_BATCH_SIZE;

    beforeEach(() => {
        process.env.HYBRID_MODE = 'false';
        delete process.env.CODE_CHUNK_LIMIT;
        process.env.INDEX_ACCELERATOR_MODE = 'off';
        delete process.env.INDEX_EMBEDDING_BATCH_SIZE;
    });

    afterEach(() => {
        if (originalHybridMode === undefined) {
            delete process.env.HYBRID_MODE;
        } else {
            process.env.HYBRID_MODE = originalHybridMode;
        }

        if (originalCodeChunkLimit === undefined) {
            delete process.env.CODE_CHUNK_LIMIT;
        } else {
            process.env.CODE_CHUNK_LIMIT = originalCodeChunkLimit;
        }

        if (originalIndexAcceleratorMode === undefined) {
            delete process.env.INDEX_ACCELERATOR_MODE;
        } else {
            process.env.INDEX_ACCELERATOR_MODE = originalIndexAcceleratorMode;
        }

        if (originalIndexEmbeddingBatchSize === undefined) {
            delete process.env.INDEX_EMBEDDING_BATCH_SIZE;
        } else {
            process.env.INDEX_EMBEDDING_BATCH_SIZE = originalIndexEmbeddingBatchSize;
        }
    });

    test('custom extensions and ignore patterns stay scoped to one codebase', async () => {
        const context = createContext();
        const projectA = await makeTempDir();
        const projectB = await makeTempDir();

        context.configureCodebaseSession(projectA, {
            customExtensions: ['foo'],
            customIgnorePatterns: ['*.txt'],
        });

        expect(context.getSupportedExtensions(projectA)).toContain('.foo');
        expect(context.getIgnorePatterns(projectA)).toContain('*.txt');
        expect(context.getSupportedExtensions(projectB)).not.toContain('.foo');
        expect(context.getIgnorePatterns(projectB)).not.toContain('*.txt');
    });

    test('custom extension indexing does not leak into other codebases', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const projectA = await makeTempDir();
        const projectB = await makeTempDir();

        await fs.writeFile(path.join(projectA, 'custom.foo'), 'custom code');
        await fs.writeFile(path.join(projectB, 'custom.foo'), 'custom code');

        context.configureCodebaseSession(projectA, { customExtensions: ['foo'] });
        await context.indexCodebase(projectA, undefined, true);
        await context.indexCodebase(projectB, undefined, true);

        expect(
            vectorDatabase.documents.get(context.getCollectionName(projectA)) || [],
        ).toHaveLength(1);
        expect(
            vectorDatabase.documents.get(context.getCollectionName(projectB)) || [],
        ).toHaveLength(0);
    });

    test('1C reduced scope remains applied during incremental sync', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();

        await writeFixtureFile(project, 'Configuration.xml', '<MetaDataObject />');
        await writeFixtureFile(project, 'CommonModules/Exchange/Ext/Module.bsl', 'Procedure Run()\nEndProcedure');
        await writeFixtureFile(project, 'Catalogs/Products/Ext/Help/en.html', '<p>generated help</p>');

        context.configureCodebaseSession(project, {
            customExtensions: ['.xml', '.html'],
            oneCIndexScopeProfile: 'developer',
        });
        const initialStats = await context.indexCodebase(project, undefined, true);
        const collectionName = context.getCollectionName(project);
        const initialDocuments = vectorDatabase.documents.get(collectionName) || [];

        expect(initialStats.oneCIndexScopeProfile).toBe('developer');
        expect(initialStats.oneCIndexScope?.excludedByReason['one-c-generated-or-low-value']).toBe(1);
        expect(initialDocuments.map((document) => document.relativePath).sort()).toEqual([
            'CommonModules/Exchange/Ext/Module.bsl',
            'Configuration.xml',
        ]);

        const syncStats = await context.reindexByChange(project);

        expect(syncStats).toEqual({ added: 0, removed: 0, modified: 0 });
        expect((vectorDatabase.documents.get(collectionName) || []).map((document) => document.relativePath).sort()).toEqual([
            'CommonModules/Exchange/Ext/Module.bsl',
            'Configuration.xml',
        ]);
    });

    test('CODE_CHUNK_LIMIT stops indexing at the configured chunk count', async () => {
        process.env.CODE_CHUNK_LIMIT = '2';

        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();

        await fs.writeFile(path.join(project, 'first.ts'), 'first');
        await fs.writeFile(path.join(project, 'second.ts'), 'second');
        await fs.writeFile(path.join(project, 'third.ts'), 'third');

        const stats = await context.indexCodebase(project, undefined, true);

        expect(stats.status).toBe('limit_reached');
        expect(stats.totalChunks).toBe(2);
        expect(stats.codeChunkLimit).toBe(2);
        expect(context.getLastAcceleratorSnapshot()).toEqual(expect.objectContaining({
            codeChunkLimit: 2,
            limitReached: true,
            limitReachedChunks: 2,
            limitReachedProcessedFiles: 2,
        }));
        expect(
            vectorDatabase.documents.get(context.getCollectionName(project)) || [],
        ).toHaveLength(2);
        expect(context.getLastInitialIndexingManifest()).toEqual(expect.objectContaining({
            runState: 'limit_reached',
            confirmedDocumentIds: expect.any(Array),
        }));
        expect(context.getLastInitialIndexingManifest()?.confirmedDocumentIds).toHaveLength(2);
    });

    test('initial indexing does not persist synchronizer snapshot before vector inserts are confirmed', async () => {
        const vectorDatabase = new FailingInsertVectorDatabase();
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();
        await fs.writeFile(path.join(project, 'index.ts'), 'const value = 1;');
        await FileSynchronizer.deleteSnapshot(project);

        await expect(context.indexCodebase(project, undefined, true))
            .rejects.toThrow('simulated insert failure');

        await expect(fs.access(FileSynchronizer.getSnapshotPathForCodebase(project)))
            .rejects.toMatchObject({ code: 'ENOENT' });
        expect(context.getLastInitialIndexingManifest()).toEqual(expect.objectContaining({
            runState: 'failed',
            confirmedDocumentIds: [],
            batches: [
                expect.objectContaining({
                    state: 'failed',
                    documentIds: expect.any(Array),
                }),
            ],
        }));
    });

    test('resume skips confirmed documents and reprocesses only unconfirmed batches', async () => {
        process.env.INDEX_EMBEDDING_BATCH_SIZE = '1';
        const vectorDatabase = new FailOnNthInsertVectorDatabase(2);
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();
        await fs.writeFile(path.join(project, 'first.ts'), 'first');
        await fs.writeFile(path.join(project, 'second.ts'), 'second');
        await FileSynchronizer.deleteSnapshot(project);

        await expect(context.indexCodebase(project, undefined, true))
            .rejects.toThrow('simulated insert failure 2');
        expect(vectorDatabase.documents.get(context.getCollectionName(project))).toHaveLength(1);
        expect(context.getLastInitialIndexingManifest()?.confirmedDocumentIds).toHaveLength(1);

        vectorDatabase.failOnNthInsert = Number.POSITIVE_INFINITY;
        await context.indexCodebase(project);

        expect(vectorDatabase.documents.get(context.getCollectionName(project))).toHaveLength(2);
        expect(context.getLastInitialIndexingManifest()).toEqual(expect.objectContaining({
            runState: 'completed',
            confirmedDocumentIds: expect.any(Array),
        }));
        expect(context.getLastInitialIndexingManifest()?.confirmedDocumentIds).toHaveLength(2);
    });

    test('CODE_CHUNK_LIMIT parser accepts valid values and falls back for default or invalid values', () => {
        expect(parseCodeChunkLimit()).toBe(450000);

        expect(parseCodeChunkLimit('7')).toBe(7);

        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(parseCodeChunkLimit('invalid')).toBe(450000);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid CODE_CHUNK_LIMIT'));
        warnSpy.mockRestore();

        process.env.CODE_CHUNK_LIMIT = '11';
        expect(getCodeChunkLimit()).toBe(11);
    });

    test('root anchored directory ignore patterns only match the codebase root', async () => {
        const context = createContext();
        const project = await makeTempDir();
        await fs.mkdir(path.join(project, 'Library'), { recursive: true });
        await fs.mkdir(path.join(project, 'src', 'Library'), { recursive: true });
        await fs.writeFile(path.join(project, 'Library', 'root.ts'), 'root');
        await fs.writeFile(path.join(project, 'src', 'Library', 'nested.ts'), 'nested');

        context.configureCodebaseSession(project, { customIgnorePatterns: ['/Library/'] });
        const session = (context as any).getOrCreateCodebaseSession(project);
        const files = await (context as any).getCodeFiles(project, session);
        const relativeFiles = files.map((file: string) => path.relative(project, file).replace(/\\/g, '/'));

        expect(relativeFiles).not.toContain('Library/root.ts');
        expect(relativeFiles).toContain('src/Library/nested.ts');
    });

    test('FileSynchronizer only tracks supported extensions', async () => {
        const project = await makeTempDir();
        await fs.writeFile(path.join(project, 'tracked.ts'), 'tracked');
        await fs.writeFile(path.join(project, 'ignored.txt'), 'ignored');

        const synchronizer = new FileSynchronizer(project, [], ['.ts']);
        const fileHashes = await (synchronizer as any).generateFileHashes(project);

        expect([...fileHashes.keys()]).toEqual(['tracked.ts']);
    });

    test('pre-index traversal preserves supported file selection semantics on fixture paths', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/index.ts', 'index');
        await writeFixtureFile(project, 'src/nested/component.js', 'component');
        await writeFixtureFile(project, 'src/nested/component.spec.ts', 'spec');
        await writeFixtureFile(project, '.hidden/secret.ts', 'secret');
        await writeFixtureFile(project, 'Library/root.ts', 'root');
        await writeFixtureFile(project, 'src/Library/nested.ts', 'nested library');
        await writeFixtureFile(project, 'build/generated.ts', 'generated');
        await writeFixtureFile(project, 'notes.txt', 'notes');
        await fs.mkdir(path.join(project, 'unreadable'), { recursive: true });
        await fs.chmod(path.join(project, 'unreadable'), 0o000);

        try {
            const traversal = await traversePreIndex(project, {
                supportedExtensions: ['.ts', '.js'],
                ignorePatterns: ['/Library/', 'build/', '*.spec.ts'],
                includeHashes: true,
                concurrency: 2,
            });

            expect(traversal.files.map((file) => file.relativePath)).toEqual([
                'src/Library/nested.ts',
                'src/index.ts',
                'src/nested/component.js',
            ]);
            expect(traversal.files.every((file) => typeof file.hash === 'string')).toBe(true);
            expect(traversal.selectedFileCount).toBe(3);
            expect(traversal.hashedFileCount).toBe(3);
            expect(traversal.timings.totalMs).toBeGreaterThanOrEqual(0);
        } finally {
            await fs.chmod(path.join(project, 'unreadable'), 0o700).catch(() => undefined);
        }
    });

    test('pre-index traversal matches sequential synchronizer hashes for compatibility', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/a.ts', 'a');
        await writeFixtureFile(project, 'src/b.js', 'b');
        await writeFixtureFile(project, 'src/b.spec.ts', 'ignored');
        await writeFixtureFile(project, 'tmp/c.ts', 'ignored dir');
        await writeFixtureFile(project, 'README.md', 'readme');

        const ignorePatterns = ['tmp/', '*.spec.ts'];
        const supportedExtensions = ['.ts', '.js', '.md'];
        const synchronizer = new FileSynchronizer(project, ignorePatterns, supportedExtensions);
        const sequentialHashes = await (synchronizer as any).generateFileHashes(project);
        const traversal = await traversePreIndex(project, {
            ignorePatterns,
            supportedExtensions,
            includeHashes: true,
            concurrency: 1,
        });

        expect(new Map(traversal.files.map((file) => [file.relativePath, file.hash]))).toEqual(sequentialHashes);
    });

    test('optimized pre-index traversal matches baseline ignore semantics on fixture coverage', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/a.ts', 'a');
        await writeFixtureFile(project, 'src/z.ts', 'z');
        await writeFixtureFile(project, 'src/nested/b.js', 'b');
        await writeFixtureFile(project, 'src/nested/b.spec.ts', 'spec');
        await writeFixtureFile(project, 'src/generated/drop.ts', 'drop');
        await writeFixtureFile(project, 'src/generated/keep.ts', 'keep');
        await writeFixtureFile(project, 'Library/root.ts', 'root library');
        await writeFixtureFile(project, 'src/Library/nested.ts', 'nested library');
        await writeFixtureFile(project, '.hidden/secret.ts', 'secret');
        await writeFixtureFile(project, 'tmp/c.ts', 'tmp');
        await writeFixtureFile(project, 'notes.xml', '<xml />');

        const ignorePatterns = [
            '/Library/',
            'tmp/',
            '*.spec.ts',
            'src/generated/**',
            '!src/generated/keep.ts',
        ];
        const supportedExtensions = ['.ts', '.js'];
        const baseline = await baselineTraverseFiles(project, ignorePatterns, supportedExtensions);
        const optimized = await traversePreIndex(project, {
            ignorePatterns,
            supportedExtensions,
            includeHashes: true,
            concurrency: 2,
            diagnostics: true,
        });

        expect(optimized.files.map((file) => file.relativePath)).toEqual([...baseline.keys()]);
        expect(new Map(optimized.files.map((file) => [file.relativePath, file.hash]))).toEqual(baseline);
        expect(optimized.diagnostics?.unsupportedFilesByExtension['.xml']).toBe(1);
        expect(optimized.diagnostics?.matcherCacheHits).toBeGreaterThan(0);
        expect(optimized.files.map((file) => file.order)).toEqual([0, 1, 2, 3]);
    });

    test('pre-index diagnostics preserve selected paths and hashes', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/a.ts', 'a');
        await writeFixtureFile(project, 'src/b.js', 'b');
        await writeFixtureFile(project, 'src/b.spec.ts', 'ignored');
        await writeFixtureFile(project, 'src/schema.xml', '<xml />');
        await writeFixtureFile(project, 'tmp/c.ts', 'ignored dir');

        const options = {
            ignorePatterns: ['tmp/', '*.spec.ts'],
            supportedExtensions: ['.ts', '.js'],
            includeHashes: true,
            concurrency: 2,
        };
        const withoutDiagnostics = await traversePreIndex(project, options);
        const withDiagnostics = await traversePreIndex(project, {
            ...options,
            diagnostics: true,
        });

        expect(withDiagnostics.files.map((file) => file.relativePath)).toEqual(
            withoutDiagnostics.files.map((file) => file.relativePath),
        );
        expect(withDiagnostics.files.map((file) => file.hash)).toEqual(
            withoutDiagnostics.files.map((file) => file.hash),
        );
        expect(withDiagnostics.diagnostics?.selectedFiles).toBe(withoutDiagnostics.selectedFileCount);
        expect(withDiagnostics.diagnostics?.hashedFiles).toBe(withoutDiagnostics.hashedFileCount);
        expect(withDiagnostics.diagnostics?.selectedPathFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(withDiagnostics.diagnostics?.selectedPathHashFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('pre-index diagnostics count unsupported extensions and serialize as JSON', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/a.ts', 'a');
        await writeFixtureFile(project, 'src/schema.xml', '<xml />');
        await writeFixtureFile(project, 'src/UPPER.XML', '<xml />');
        await writeFixtureFile(project, 'README', 'no extension');
        await writeFixtureFile(project, 'ignored/hidden.xml', '<xml />');

        const traversal = await traversePreIndex(project, {
            supportedExtensions: ['.ts'],
            ignorePatterns: ['ignored/'],
            includeHashes: false,
            concurrency: 1,
            diagnostics: true,
        });

        expect(traversal.selectedFileCount).toBe(1);
        expect(traversal.hashedFileCount).toBe(0);
        expect(traversal.diagnostics?.filesSeen).toBe(4);
        expect(traversal.diagnostics?.ignoredFiles).toBe(0);
        expect(traversal.diagnostics?.ignoredDirectories).toBe(1);
        expect(traversal.diagnostics?.unsupportedFilesByExtension['.xml']).toBe(2);
        expect(traversal.diagnostics?.unsupportedFilesByExtension['<none>']).toBe(1);
        expect(JSON.parse(JSON.stringify(traversal.diagnostics)).selectedFiles).toBe(1);
    });

    test('pre-index traversal reports native engine fallback to TypeScript', async () => {
        const project = await makeTempDir();
        await writeFixtureFile(project, 'src/a.ts', 'a');

        const traversal = await traversePreIndex(project, {
            supportedExtensions: ['.ts'],
            includeHashes: false,
            concurrency: 1,
            diagnostics: true,
            engine: 'native',
        });

        expect(traversal.diagnostics?.requestedEngine).toBe('native');
        expect(traversal.diagnostics?.engine).toBe('ts');
        expect(traversal.diagnostics?.engineFallbackReason).toContain('Native pre-index traversal is not available');
        expect(traversal.files.map((file) => file.relativePath)).toEqual(['src/a.ts']);
    });

    test('pre-index traversal bounds concurrent file hashing within one directory', async () => {
        const project = await makeTempDir();
        await Promise.all([0, 1, 2, 3].map((item) =>
            writeFixtureFile(project, `file${item}.ts`, `export const value${item} = ${item};`),
        ));
        let activeReads = 0;
        let maxActiveReads = 0;
        await traversePreIndex(project, {
            supportedExtensions: ['.ts'],
            includeHashes: true,
            concurrency: 2,
            readFile: async (filePath: string) => {
                activeReads++;
                maxActiveReads = Math.max(maxActiveReads, activeReads);
                try {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    return await fs.readFile(filePath, 'utf-8');
                } finally {
                    activeReads--;
                }
            },
        });

        expect(maxActiveReads).toBe(2);
    });

    test('semantic search deduplicates overlapping results', async () => {
        const vectorDatabase = new TestVectorDatabase();
        const context = createContext(vectorDatabase);
        const project = await makeTempDir();
        const collectionName = context.getCollectionName(project);
        vectorDatabase.collections.add(collectionName);
        vectorDatabase.searchResults = [
            {
                document: {
                    id: 'first',
                    vector: [1, 0, 0],
                    content: 'first',
                    relativePath: 'src/a.ts',
                    startLine: 1,
                    endLine: 10,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.9,
            },
            {
                document: {
                    id: 'overlap',
                    vector: [1, 0, 0],
                    content: 'overlap',
                    relativePath: 'src/a.ts',
                    startLine: 2,
                    endLine: 9,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.8,
            },
            {
                document: {
                    id: 'other',
                    vector: [1, 0, 0],
                    content: 'other',
                    relativePath: 'src/b.ts',
                    startLine: 1,
                    endLine: 2,
                    fileExtension: '.ts',
                    metadata: { language: 'typescript' },
                },
                score: 0.7,
            },
        ];

        const results = await context.semanticSearch(project, 'query', 5);

        expect(results.map((result) => result.content)).toEqual(['first', 'other']);
    });
});
