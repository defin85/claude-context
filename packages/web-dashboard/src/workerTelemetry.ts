export type VramCalibrationSource = 'cache' | 'default' | 'measured' | 'unmeasured' | string;

export interface RunningWorker {
    endpoint: string;
    port?: number;
    unitName?: string;
    lifecycle?: string;
}

export interface WorkerEndpointHealth {
    endpoint: string;
    health?: string;
    inFlight?: number;
    rejectedReason?: string;
    rejectedFailureReason?: string;
    rejectedRetrySafe?: boolean;
    recoveryAttempts?: number;
    poolState?: 'accepted' | 'rejected' | 'recovering' | string;
}

export interface VramPlanning {
    profileKey?: string;
    totalMiB?: number;
    usedBeforeMiB?: number;
    budgetMiB?: number;
    freeBudgetMiB?: number;
    safetyMarginMiB?: number;
    estimatedWorkerMiB?: number;
    calibrationSource?: VramCalibrationSource;
    managedWorkerLimit?: number;
    plannedWorkers?: number;
    startedWorkers?: number;
    stopReason?: string;
}

export interface ManagedBgeM3Workers {
    primaryEndpoint?: string;
    configuredEndpoints?: string[];
    totalPoolEndpoints?: string[];
    managedEndpoints?: string[];
    plannedEndpoints?: string[];
    runningWorkers?: RunningWorker[];
    fallbackReason?: string;
    vramPlanning?: VramPlanning;
}

export interface AcceleratorWorkerSnapshot {
    activeWorkers?: number;
    rejectedWorkers?: number;
    workerPool?: WorkerEndpointHealth[];
    workerEndpoints?: WorkerEndpointHealth[];
    workerHealth?: WorkerEndpointHealth[];
    fallbackReason?: string;
}

export interface WorkerTelemetryStatus {
    accelerator?: AcceleratorWorkerSnapshot;
    managedBgeM3Workers?: ManagedBgeM3Workers | null;
}

export interface WorkerTelemetryView {
    available: boolean;
    degraded: boolean;
    alerts: string[];
    summary: Array<[string, string]>;
    endpoints: WorkerEndpointHealth[];
    vram: Array<[string, string]>;
}

const neutralFallbackReasons = new Set([
    'background sync acceleration disabled',
]);

export function buildWorkerTelemetryView(status: WorkerTelemetryStatus | undefined): WorkerTelemetryView {
    const managed = status?.managedBgeM3Workers || undefined;
    const vramPlanning = managed?.vramPlanning;
    const endpoints = collectEndpointHealth(status);
    const alerts = uniqueStrings([
        status?.accelerator?.fallbackReason,
        managed?.fallbackReason,
        vramPlanning?.stopReason,
        ...endpoints.flatMap((endpoint) => endpointAlerts(endpoint)),
    ]
        .filter((value): value is string => Boolean(value))
        .filter((value) => !neutralFallbackReasons.has(value)));

    return {
        available: Boolean(managed),
        degraded: alerts.length > 0,
        alerts,
        summary: [
            ['Основной endpoint', managed?.primaryEndpoint || '—'],
            ['Настроено', formatCount(managed?.configuredEndpoints?.length)],
            ['Запланировано', formatCount(managed?.plannedEndpoints?.length)],
            ['Запущено', formatCount(managed?.runningWorkers?.length)],
            ['Под управлением', formatCount(managed?.managedEndpoints?.length)],
            ['Всего в пуле', formatCount(managed?.totalPoolEndpoints?.length)],
        ],
        endpoints,
        vram: [
            ['Бюджет', formatMiB(vramPlanning?.budgetMiB)],
            ['Занято до запуска', formatMiB(vramPlanning?.usedBeforeMiB)],
            ['Свободный бюджет', formatMiB(vramPlanning?.freeBudgetMiB)],
            ['Запас', formatMiB(vramPlanning?.safetyMarginMiB)],
            ['Оценка воркера', formatMiB(vramPlanning?.estimatedWorkerMiB)],
            ['Калибровка', vramPlanning?.calibrationSource || '—'],
            ['План воркеров', formatCount(vramPlanning?.plannedWorkers)],
            ['Запущено воркеров', formatCount(vramPlanning?.startedWorkers)],
        ],
    };
}

export function formatMiB(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '—';
    }
    return `${Math.round(value).toLocaleString('en-US')} MiB`;
}

function collectEndpointHealth(status: WorkerTelemetryStatus | undefined): WorkerEndpointHealth[] {
    const accelerator = status?.accelerator;
    const fromAccelerator = accelerator?.workerHealth || accelerator?.workerEndpoints || accelerator?.workerPool || [];
    if (fromAccelerator.length > 0) {
        return fromAccelerator;
    }

    const running = status?.managedBgeM3Workers?.runningWorkers || [];
    return running.map((worker) => ({
        endpoint: worker.endpoint,
        health: 'running',
        inFlight: 0,
        recoveryAttempts: 0,
        poolState: 'accepted',
    }));
}

function endpointAlerts(endpoint: WorkerEndpointHealth): string[] {
    const alerts = [];
    if (endpoint.poolState === 'rejected') {
        alerts.push(`${endpoint.endpoint}: воркер отклонён`);
    }
    if (endpoint.rejectedReason) {
        alerts.push(`${endpoint.endpoint}: ${endpoint.rejectedReason}`);
    }
    if (endpoint.rejectedFailureReason === 'recovery_failed') {
        alerts.push(`${endpoint.endpoint}: восстановление не удалось`);
    }
    if (endpoint.health && !['healthy', 'running', 'ok'].includes(endpoint.health)) {
        alerts.push(`${endpoint.endpoint}: health ${endpoint.health}`);
    }
    return alerts;
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
}

function formatCount(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}
