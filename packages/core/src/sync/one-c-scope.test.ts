import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    classifyOneCExportPath,
    resolveOneCIndexScopeProfile,
    traversePreIndex,
} from '../index';

async function writeFixtureFile(root: string, relativePath: string, content: string = ''): Promise<void> {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content || `// ${relativePath}`);
}

describe('1C indexing scope profiles', () => {
    let previousScope: string | undefined;

    beforeEach(() => {
        previousScope = process.env['1C_INDEX_SCOPE_PROFILE'];
        delete process.env['1C_INDEX_SCOPE_PROFILE'];
    });

    afterEach(() => {
        if (previousScope === undefined) {
            delete process.env['1C_INDEX_SCOPE_PROFILE'];
        } else {
            process.env['1C_INDEX_SCOPE_PROFILE'] = previousScope;
        }
    });

    it('classifies common 1C exported configuration paths by stable role', () => {
        expect(classifyOneCExportPath('Configuration.xml')?.role).toBe('configuration-metadata');
        expect(classifyOneCExportPath('CommonModules/Exchange/Ext/Module.bsl')?.role).toBe('common-module');
        expect(classifyOneCExportPath('Catalogs/Products/Ext/ObjectModule.bsl')?.role).toBe('object-module');
        expect(classifyOneCExportPath('Documents/Sales/Ext/ManagerModule.bsl')?.role).toBe('manager-module');
        expect(classifyOneCExportPath('Catalogs/Products/Forms/ItemForm/Ext/Form/Module.bsl')?.role).toBe('form-module');
        expect(classifyOneCExportPath('Catalogs/Products/Commands/Recalculate/Ext/CommandModule.bsl')?.role).toBe('command-module');
        expect(classifyOneCExportPath('Catalogs/Products/Ext/Help/en.html')?.role).toBe('generated-or-low-value');
    });

    it('filters recognized 1C exports by explicit developer and minimal profiles before hashing', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'one-c-scope-'));
        await writeFixtureFile(root, 'Configuration.xml', '<MetaDataObject />');
        await writeFixtureFile(root, 'CommonModules/Exchange/Ext/Module.bsl');
        await writeFixtureFile(root, 'Catalogs/Products/Ext/ObjectModule.bsl');
        await writeFixtureFile(root, 'Catalogs/Products/Ext/ManagerModule.bsl');
        await writeFixtureFile(root, 'Catalogs/Products/Forms/ItemForm/Ext/Form/Module.bsl');
        await writeFixtureFile(root, 'Catalogs/Products/Commands/Recalculate/Ext/CommandModule.bsl');
        await writeFixtureFile(root, 'Catalogs/Products/Ext/Help/en.html');
        await writeFixtureFile(root, 'notes.md');

        const full = await traversePreIndex(root, {
            supportedExtensions: ['.bsl', '.xml', '.html', '.md'],
            diagnostics: true,
            oneCIndexScopeProfile: 'full',
        });
        const developer = await traversePreIndex(root, {
            supportedExtensions: ['.bsl', '.xml', '.html', '.md'],
            diagnostics: true,
            oneCIndexScopeProfile: 'developer',
        });
        const minimal = await traversePreIndex(root, {
            supportedExtensions: ['.bsl', '.xml', '.html', '.md'],
            diagnostics: true,
            oneCIndexScopeProfile: 'minimal',
        });

        expect(full.files.map((file) => file.relativePath)).toContain('Catalogs/Products/Ext/Help/en.html');
        expect(developer.files.map((file) => file.relativePath)).toEqual([
            'Catalogs/Products/Commands/Recalculate/Ext/CommandModule.bsl',
            'Catalogs/Products/Ext/ManagerModule.bsl',
            'Catalogs/Products/Ext/ObjectModule.bsl',
            'Catalogs/Products/Forms/ItemForm/Ext/Form/Module.bsl',
            'CommonModules/Exchange/Ext/Module.bsl',
            'Configuration.xml',
        ]);
        expect(minimal.files.map((file) => file.relativePath)).toEqual([
            'Catalogs/Products/Commands/Recalculate/Ext/CommandModule.bsl',
            'Catalogs/Products/Ext/ManagerModule.bsl',
            'Catalogs/Products/Ext/ObjectModule.bsl',
            'Catalogs/Products/Forms/ItemForm/Ext/Form/Module.bsl',
            'CommonModules/Exchange/Ext/Module.bsl',
        ]);
        expect(developer.diagnostics?.oneCIndexScope).toEqual(expect.objectContaining({
            profile: 'developer',
            active: true,
            excludedFiles: 2,
        }));
        expect(developer.diagnostics?.oneCIndexScope?.excludedByReason['one-c-generated-or-low-value']).toBe(1);
        expect(developer.diagnostics?.oneCIndexScope?.excludedByReason['one-c-non-configuration-file']).toBe(1);
        expect(minimal.diagnostics?.oneCIndexScope?.excludedFiles).toBe(3);
    });

    it('keeps non-1C repositories unchanged when no reduced profile is selected', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'one-c-scope-non-1c-'));
        await writeFixtureFile(root, 'src/app.ts', 'export const app = true;');
        await writeFixtureFile(root, 'README.md', '# readme');

        const traversal = await traversePreIndex(root, {
            supportedExtensions: ['.ts', '.md'],
            diagnostics: true,
        });

        expect(resolveOneCIndexScopeProfile()).toBe('full');
        expect(traversal.files.map((file) => file.relativePath)).toEqual(['README.md', 'src/app.ts']);
        expect(traversal.diagnostics?.oneCIndexScope?.active).toBe(false);
    });

    it('fails clearly when reduced scope is requested for an unrecognized tree', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'one-c-scope-unrecognized-'));
        await writeFixtureFile(root, 'src/app.ts', 'export const app = true;');

        await expect(traversePreIndex(root, {
            supportedExtensions: ['.ts'],
            oneCIndexScopeProfile: 'developer',
        })).rejects.toThrow(/1C_INDEX_SCOPE_PROFILE=developer requires a recognized exported 1C configuration tree/);
    });
});
