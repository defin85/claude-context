import { envManager } from '../utils/env-manager';

export type OneCIndexScopeProfile = 'full' | 'developer' | 'minimal' | 'v8unpack';

export type OneCExportPathRole =
    | 'configuration-metadata'
    | 'object-metadata'
    | 'common-module'
    | 'object-module'
    | 'manager-module'
    | 'form-module'
    | 'command-module'
    | 'generated-or-low-value';

export interface OneCExportPathClassification {
    role: OneCExportPathRole;
    reason: string;
}

export interface OneCIndexScopeSummary {
    profile: OneCIndexScopeProfile;
    active: boolean;
    recognized: boolean;
    includedFiles: number;
    excludedFiles: number;
    includedByReason: Record<string, number>;
    excludedByReason: Record<string, number>;
    warning?: string;
}

export interface OneCIndexScopeDecision {
    include: boolean;
    reason: string;
    classification?: OneCExportPathClassification;
}

const VALID_ONE_C_SCOPE_PROFILES: OneCIndexScopeProfile[] = ['full', 'developer', 'minimal', 'v8unpack'];

const V8UNPACK_HEAVY_EXTENSIONS = new Set([
    '.mxl',
    '.bin',
    '.c1b64',
    '.c1brace',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
]);

const V8UNPACK_METADATA_ROOTS = new Set([
    'AccountingRegister',
    'AccumulationRegister',
    'BusinessProcess',
    'CalculationRegister',
    'Catalog',
    'ChartOfAccounts',
    'ChartOfCalculationTypes',
    'ChartOfCharacteristicTypes',
    'CommandGroup',
    'CommonCommand',
    'CommonForm',
    'CommonModule',
    'CommonPicture',
    'Constant',
    'DataProcessor',
    'DefinedType',
    'Document',
    'DocumentJournal',
    'Enum',
    'ExchangePlan',
    'FilterCriterion',
    'FunctionalOption',
    'HTTPService',
    'InformationRegister',
    'Language',
    'Report',
    'Role',
    'ScheduledJob',
    'Sequence',
    'SessionParameter',
    'SettingsStorage',
    'Style',
    'Subsystem',
    'Task',
    'WebService',
    'WSReference',
    'XDTOPackage',
]);

function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function extensionOf(relativePath: string): string {
    const fileName = relativePath.split('/').pop() || relativePath;
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

function increment(target: Record<string, number>, key: string): void {
    target[key] = (target[key] || 0) + 1;
}

export function parseOneCIndexScopeProfile(value: string | undefined, source: string = '1C_INDEX_SCOPE_PROFILE'): OneCIndexScopeProfile {
    if (!value || value.trim().length === 0) {
        return 'full';
    }

    const normalized = value.trim().toLowerCase();
    if (VALID_ONE_C_SCOPE_PROFILES.includes(normalized as OneCIndexScopeProfile)) {
        return normalized as OneCIndexScopeProfile;
    }

    throw new Error(`${source} must be one of: ${VALID_ONE_C_SCOPE_PROFILES.join(', ')}.`);
}

export function resolveOneCIndexScopeProfile(explicitProfile?: OneCIndexScopeProfile | string): OneCIndexScopeProfile {
    if (explicitProfile !== undefined) {
        return parseOneCIndexScopeProfile(String(explicitProfile), 'oneCIndexScopeProfile');
    }

    return parseOneCIndexScopeProfile(envManager.get('1C_INDEX_SCOPE_PROFILE'), '1C_INDEX_SCOPE_PROFILE');
}

export function isReducedOneCIndexScopeProfile(profile: OneCIndexScopeProfile | undefined): boolean {
    return profile === 'developer' || profile === 'minimal' || profile === 'v8unpack';
}

export function classifyOneCExportPath(relativePath: string): OneCExportPathClassification | undefined {
    const normalizedPath = normalizeRelativePath(relativePath);
    const parts = normalizedPath.split('/');
    const extension = extensionOf(normalizedPath);
    const fileName = parts[parts.length - 1] || '';
    const hasExtSegment = parts.includes('Ext');

    if (normalizedPath === 'Configuration.xml') {
        return { role: 'configuration-metadata', reason: 'one-c-configuration-metadata' };
    }

    if (extension === '.bsl') {
        if (parts[0] === 'CommonModules' && fileName === 'Module.bsl') {
            return { role: 'common-module', reason: 'one-c-common-module' };
        }
        if (fileName === 'ObjectModule.bsl') {
            return { role: 'object-module', reason: 'one-c-object-module' };
        }
        if (fileName === 'ManagerModule.bsl') {
            return { role: 'manager-module', reason: 'one-c-manager-module' };
        }
        if (fileName === 'CommandModule.bsl') {
            return { role: 'command-module', reason: 'one-c-command-module' };
        }
        if (fileName === 'Module.bsl' && parts.includes('Forms')) {
            return { role: 'form-module', reason: 'one-c-form-module' };
        }
        if (hasExtSegment) {
            return { role: 'object-module', reason: 'one-c-bsl-module' };
        }
    }

    if (extension === '.xml' && parts.length > 1 && hasExtSegment) {
        return { role: 'object-metadata', reason: 'one-c-object-metadata' };
    }

    if (isLikelyOneCExportPath(parts)) {
        return { role: 'generated-or-low-value', reason: 'one-c-generated-or-low-value' };
    }

    return undefined;
}

export function classifyV8UnpackExportPath(relativePath: string): OneCExportPathClassification | undefined {
    const normalizedPath = normalizeRelativePath(relativePath);
    const parts = normalizedPath.split('/');
    const extension = extensionOf(normalizedPath);
    const fileName = parts[parts.length - 1] || '';
    const root = parts[0] || '';

    if (V8UNPACK_HEAVY_EXTENSIONS.has(extension)) {
        return { role: 'generated-or-low-value', reason: 'one-c-v8unpack-heavy-resource' };
    }

    if (normalizedPath === 'Configuration.json') {
        return { role: 'configuration-metadata', reason: 'one-c-v8unpack-configuration-metadata' };
    }

    if (!V8UNPACK_METADATA_ROOTS.has(root)) {
        return undefined;
    }

    if (extension === '.bsl') {
        if (root === 'CommonModule' && fileName === 'CommonModule.obj.bsl') {
            return { role: 'common-module', reason: 'one-c-v8unpack-common-module' };
        }
        if (fileName.endsWith('.cmd.bsl') || parts.includes('Command')) {
            return { role: 'command-module', reason: 'one-c-v8unpack-command-module' };
        }
        if (fileName.endsWith('.obj.bsl')) {
            return {
                role: parts.includes('Form') ? 'form-module' : 'object-module',
                reason: 'one-c-v8unpack-object-module',
            };
        }
        if (fileName.endsWith('.mgr.bsl')) {
            return { role: 'manager-module', reason: 'one-c-v8unpack-manager-module' };
        }
        return { role: 'generated-or-low-value', reason: 'one-c-v8unpack-generated-or-low-value' };
    }

    if (extension === '.json') {
        return {
            role: parts.includes('Form') ? 'form-module' : 'object-metadata',
            reason: 'one-c-v8unpack-json-metadata',
        };
    }

    return { role: 'generated-or-low-value', reason: 'one-c-v8unpack-generated-or-low-value' };
}

function isLikelyOneCExportPath(parts: string[]): boolean {
    return [
        'CommonModules',
        'Catalogs',
        'Documents',
        'DataProcessors',
        'Reports',
        'InformationRegisters',
        'AccumulationRegisters',
        'ChartsOfCharacteristicTypes',
        'Enums',
        'ExchangePlans',
        'CommonForms',
        'CommonCommands',
        'Roles',
        'Subsystems',
    ].includes(parts[0]);
}

export function evaluateOneCIndexScopePath(
    relativePath: string,
    profile: OneCIndexScopeProfile,
): OneCIndexScopeDecision {
    if (profile === 'v8unpack') {
        const classification = classifyV8UnpackExportPath(relativePath);
        if (!classification) {
            return {
                include: false,
                reason: 'one-c-non-configuration-file',
            };
        }

        const include = classification.role !== 'generated-or-low-value';
        return {
            include,
            reason: classification.reason,
            classification,
        };
    }

    const classification = classifyOneCExportPath(relativePath);
    if (profile === 'full') {
        return {
            include: true,
            reason: classification?.reason || 'one-c-full-scope',
            classification,
        };
    }

    if (!classification) {
        return {
            include: false,
            reason: 'one-c-non-configuration-file',
        };
    }

    if (profile === 'developer') {
        const include = classification.role !== 'generated-or-low-value';
        return {
            include,
            reason: include ? classification.reason : 'one-c-generated-or-low-value',
            classification,
        };
    }

    const include = [
        'common-module',
        'object-module',
        'manager-module',
        'form-module',
        'command-module',
    ].includes(classification.role);
    return {
        include,
        reason: include ? classification.reason : `one-c-minimal-excludes-${classification.role}`,
        classification,
    };
}

export function createOneCIndexScopeSummary(profile: OneCIndexScopeProfile): OneCIndexScopeSummary {
    return {
        profile,
        active: false,
        recognized: false,
        includedFiles: 0,
        excludedFiles: 0,
        includedByReason: {},
        excludedByReason: {},
    };
}

export function recordOneCIndexScopeDecision(
    summary: OneCIndexScopeSummary,
    decision: OneCIndexScopeDecision,
): void {
    if (decision.classification) {
        summary.recognized = true;
    }
    if (decision.include) {
        summary.includedFiles++;
        increment(summary.includedByReason, decision.reason);
    } else {
        summary.excludedFiles++;
        increment(summary.excludedByReason, decision.reason);
    }
}
