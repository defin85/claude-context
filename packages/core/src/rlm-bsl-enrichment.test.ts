import {
    DEFAULT_RLM_BSL_ENRICHMENT_LIMITS,
    getRlmBslCompatibilityProof,
    normalizeRlmBslProviderStatus,
    normalizeRlmBslSnapshot,
    parseRlmBslSnapshotJson,
    translateRlmBslSnapshotPath,
} from './rlm-bsl-enrichment';

describe('rlm bsl enrichment snapshot contract', () => {
    it('normalizes an available provider export snapshot with Cyrillic paths and fingerprint diagnostics', () => {
        const snapshot = normalizeRlmBslSnapshot(makeSnapshot(), {
            codebasePath: '/repo/Проект с пробелом',
        });

        expect(snapshot.status).toBe('available');
        expect(snapshot.rawStatus).toBe('available');
        expect(snapshot.provider).toBe('rlm-tools-bsl');
        expect(snapshot.providerSchemaVersion).toBe(1);
        expect(snapshot.sourceFingerprint).toBe('fingerprint-1');
        expect(snapshot.diagnostics).toEqual(expect.objectContaining({
            indexStatus: 'fresh',
            sourceFingerprint: 'fingerprint-1',
        }));
        expect(snapshot.files).toHaveLength(1);
        expect(snapshot.files[0]).toEqual(expect.objectContaining({
            relativePath: 'cf/CommonModules/СкладскойЖурнал/Ext/Module.bsl',
            objectName: 'СкладскойЖурнал',
            objectKind: 'CommonModules',
            moduleKind: 'Module',
            synonyms: ['Складской журнал'],
        }));
        expect(snapshot.files[0].symbols[0]).toEqual({
            name: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
            declarationKind: 'procedure',
            startLine: 10,
            endLine: 18,
            isExport: true,
            params: '',
        });
    });

    it('parses JSON and rejects invalid JSON with a clear diagnostic', () => {
        expect(() => parseRlmBslSnapshotJson('{not json', { codebasePath: '/repo' }))
            .toThrow(/Invalid RLM BSL provider JSON/);
    });

    it('rejects missing required fields and unsupported statuses', () => {
        expect(() => normalizeRlmBslSnapshot({ provider: 'rlm-tools-bsl' }, { codebasePath: '/repo' }))
            .toThrow(/schemaVersion/);
        expect(() => normalizeRlmBslSnapshot({ ...makeSnapshot(), status: 'warming_up' }, { codebasePath: '/repo' }))
            .toThrow(/Unsupported RLM BSL provider status/);
    });

    it('bounds arrays and strings before accepting provider payloads', () => {
        const limits = { ...DEFAULT_RLM_BSL_ENRICHMENT_LIMITS, maxFiles: 1, maxSymbolsPerFile: 1, maxSynonymsPerFile: 1, maxStringLength: 256 };

        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [makeSnapshot().files[0], makeSnapshot().files[0]],
        }, { codebasePath: '/repo', limits })).toThrow(/files exceeds/);

        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [{
                ...makeSnapshot().files[0],
                symbols: [makeSnapshot().files[0].symbols[0], makeSnapshot().files[0].symbols[0]],
            }],
        }, { codebasePath: '/repo', limits })).toThrow(/symbols exceeds/);

        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [{
                ...makeSnapshot().files[0],
                synonyms: ['one', 'two'],
            }],
        }, { codebasePath: '/repo', limits })).toThrow(/synonyms exceeds/);

        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            sourceFingerprint: 'x'.repeat(257),
        }, { codebasePath: '/repo', limits })).toThrow(/sourceFingerprint exceeds/);
    });

    it('enforces default symbol synonym and string caps', () => {
        const baseFile = makeSnapshot().files[0];
        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [{
                ...baseFile,
                symbols: Array.from({ length: DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxSymbolsPerFile + 1 }, (_, index) => ({
                    name: `Метод${index}`,
                    declarationKind: 'procedure',
                    startLine: index + 1,
                    endLine: index + 1,
                })),
            }],
        }, { codebasePath: '/repo' })).toThrow(/symbols exceeds/);

        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [{
                ...baseFile,
                synonyms: Array.from({ length: DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxSynonymsPerFile + 1 }, (_, index) => `Синоним ${index}`),
            }],
        }, { codebasePath: '/repo' })).toThrow(/synonyms exceeds/);

        expect(() => normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [{
                ...baseFile,
                objectName: 'x'.repeat(DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxStringLength + 1),
            }],
        }, { codebasePath: '/repo' })).toThrow(/objectName exceeds/);
    });

    it('accepts payloads at default symbol and synonym caps', () => {
        const baseFile = makeSnapshot().files[0];
        const snapshot = normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            files: [{
                ...baseFile,
                synonyms: Array.from({ length: DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxSynonymsPerFile }, (_, index) => `Синоним ${index}`),
                symbols: Array.from({ length: DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxSymbolsPerFile }, (_, index) => ({
                    name: `Метод${index}`,
                    declarationKind: 'procedure',
                    startLine: index + 1,
                    endLine: index + 1,
                })),
            }],
        }, { codebasePath: '/repo' });

        expect(snapshot.files[0].synonyms).toHaveLength(DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxSynonymsPerFile);
        expect(snapshot.files[0].symbols).toHaveLength(DEFAULT_RLM_BSL_ENRICHMENT_LIMITS.maxSymbolsPerFile);
    });

    it('truncates diagnostics that exceed the configured diagnostics budget', () => {
        const snapshot = normalizeRlmBslSnapshot({
            ...makeSnapshot(),
            diagnostics: {
                large: 'x'.repeat(500),
            },
        }, {
            codebasePath: '/repo',
            limits: { maxDiagnosticsBytes: 64 },
        });

        expect(snapshot.diagnostics).toEqual({
            truncated: true,
            sourceFingerprint: 'fingerprint-1',
        });
    });

    it('translates equal-root and nested-root source roots without shell-sensitive path parsing', () => {
        expect(translateRlmBslSnapshotPath({
            relativePath: 'CommonModules/A/Ext/Module.bsl',
            sourceRoot: '/repo/src/cf',
            codebasePath: '/repo',
        })).toBe('src/cf/CommonModules/A/Ext/Module.bsl');
        expect(translateRlmBslSnapshotPath({
            relativePath: 'CommonModules/A/Ext/Module.bsl',
            sourceRoot: '/repo/src/cf',
            codebasePath: '/repo/src/cf',
        })).toBe('CommonModules/A/Ext/Module.bsl');
        expect(translateRlmBslSnapshotPath({
            relativePath: 'CommonModules/Складской Журнал/Ext/Module.bsl',
            sourceRoot: '/repo/Проект с пробелом/cf',
            codebasePath: '/repo/Проект с пробелом',
        })).toBe('cf/CommonModules/Складской Журнал/Ext/Module.bsl');
    });

    it('normalizes raw provider statuses into stable enrichment statuses', () => {
        expect(normalizeRlmBslProviderStatus('available')).toBe('available');
        expect(normalizeRlmBslProviderStatus('missing_index')).toBe('missing');
        expect(normalizeRlmBslProviderStatus('stale')).toBe('stale');
        expect(normalizeRlmBslProviderStatus('busy')).toBe('busy');
        expect(normalizeRlmBslProviderStatus('error')).toBe('error');
    });

    it('builds compatibility proof from normalized status and source fingerprint', () => {
        const snapshot = normalizeRlmBslSnapshot(makeSnapshot(), {
            codebasePath: '/repo/Проект с пробелом',
        });

        expect(getRlmBslCompatibilityProof(snapshot)).toEqual({
            provider: 'rlm-tools-bsl',
            providerSchemaVersion: 1,
            status: 'available',
            rawStatus: 'available',
            sourceRoot: '/repo/Проект с пробелом/cf',
            sourceFingerprint: 'fingerprint-1',
        });
    });
});

function makeSnapshot() {
    return {
        schemaVersion: 1,
        provider: 'rlm-tools-bsl',
        status: 'available',
        sourceRoot: '/repo/Проект с пробелом/cf',
        sourceFingerprint: 'fingerprint-1',
        capabilities: {
            hasMethods: true,
            hasObjects: true,
            hasFilePaths: true,
        },
        files: [{
            relativePath: 'CommonModules/СкладскойЖурнал/Ext/Module.bsl',
            objectName: 'СкладскойЖурнал',
            objectKind: 'CommonModules',
            moduleKind: 'Module',
            synonyms: ['Складской журнал'],
            symbols: [{
                name: 'ПараметрыЗаполненияЗаписейСкладскогоЖурнала',
                declarationKind: 'procedure',
                startLine: 10,
                endLine: 18,
                isExport: true,
                params: '',
            }],
        }],
        diagnostics: {
            indexStatus: 'fresh',
            stats: { modules: 1, methods: 1 },
            dbPath: '/home/user/.cache/rlm-tools-bsl/hash/bsl_index.db',
        },
    };
}
