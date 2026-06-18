import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkerTelemetryView, formatMiB } from './workerTelemetry';

test('worker telemetry reports a quiet unavailable state', () => {
    const view = buildWorkerTelemetryView({});

    assert.equal(view.available, false);
    assert.equal(view.degraded, false);
    assert.deepEqual(view.alerts, []);
    assert.deepEqual(view.summary.map(([label, value]) => [label, value]), [
        ['Основной endpoint', '—'],
        ['Настроено', '—'],
        ['Запланировано', '—'],
        ['Запущено', '—'],
        ['Под управлением', '—'],
        ['Всего в пуле', '—'],
    ]);
});

test('worker telemetry summarizes healthy managed workers and VRAM planning', () => {
    const view = buildWorkerTelemetryView({
        managedBgeM3Workers: {
            primaryEndpoint: 'http://127.0.0.1:8000',
            configuredEndpoints: ['http://127.0.0.1:8100'],
            plannedEndpoints: ['http://127.0.0.1:8001', 'http://127.0.0.1:8002'],
            managedEndpoints: ['http://127.0.0.1:8001', 'http://127.0.0.1:8002'],
            runningWorkers: [
                { endpoint: 'http://127.0.0.1:8001', port: 8001, lifecycle: 'systemd' },
                { endpoint: 'http://127.0.0.1:8002', port: 8002, lifecycle: 'systemd' },
            ],
            totalPoolEndpoints: [
                'http://127.0.0.1:8000',
                'http://127.0.0.1:8100',
                'http://127.0.0.1:8001',
                'http://127.0.0.1:8002',
            ],
            vramPlanning: {
                totalMiB: 24564,
                usedBeforeMiB: 6000,
                budgetMiB: 18423,
                freeBudgetMiB: 10423,
                safetyMarginMiB: 1024,
                estimatedWorkerMiB: 2048,
                calibrationSource: 'measured',
                managedWorkerLimit: 2,
                plannedWorkers: 2,
                startedWorkers: 2,
            },
        },
    });

    assert.equal(view.available, true);
    assert.equal(view.degraded, false);
    assert.deepEqual(view.summary, [
        ['Основной endpoint', 'http://127.0.0.1:8000'],
        ['Настроено', '1'],
        ['Запланировано', '2'],
        ['Запущено', '2'],
        ['Под управлением', '2'],
        ['Всего в пуле', '4'],
    ]);
    assert.deepEqual(view.vram, [
        ['Бюджет', '18,423 MiB'],
        ['Занято до запуска', '6,000 MiB'],
        ['Свободный бюджет', '10,423 MiB'],
        ['Запас', '1,024 MiB'],
        ['Оценка воркера', '2,048 MiB'],
        ['Калибровка', 'measured'],
        ['План воркеров', '2'],
        ['Запущено воркеров', '2'],
    ]);
    assert.equal(view.endpoints.length, 2);
    assert.equal(view.endpoints[0]?.poolState, 'accepted');
});

test('worker telemetry highlights fallback, stop reason, and rejected endpoint health', () => {
    const view = buildWorkerTelemetryView({
        accelerator: {
            fallbackReason: 'accelerator disabled',
            workerHealth: [{
                endpoint: 'http://127.0.0.1:8001',
                health: 'unhealthy',
                inFlight: 1,
                rejectedReason: '503 Service Unavailable',
                rejectedFailureReason: 'embedding_error',
                recoveryAttempts: 2,
                poolState: 'rejected',
            }],
        },
        managedBgeM3Workers: {
            primaryEndpoint: 'http://127.0.0.1:8000',
            configuredEndpoints: [],
            managedEndpoints: [],
            plannedEndpoints: [],
            runningWorkers: [],
            totalPoolEndpoints: ['http://127.0.0.1:8000'],
            fallbackReason: 'VRAM metrics unavailable',
            vramPlanning: {
                safetyMarginMiB: 1024,
                estimatedWorkerMiB: 2048,
                calibrationSource: 'default',
                managedWorkerLimit: 2,
                plannedWorkers: 0,
                startedWorkers: 0,
                stopReason: 'VRAM metrics unavailable',
            },
        },
    });

    assert.equal(view.available, true);
    assert.equal(view.degraded, true);
    assert.ok(view.alerts.includes('accelerator disabled'));
    assert.ok(view.alerts.includes('VRAM metrics unavailable'));
    assert.equal(view.alerts.filter((alert) => alert === 'VRAM metrics unavailable').length, 1);
    assert.ok(view.alerts.includes('http://127.0.0.1:8001: воркер отклонён'));
    assert.ok(view.alerts.includes('http://127.0.0.1:8001: 503 Service Unavailable'));
    assert.ok(view.alerts.includes('http://127.0.0.1:8001: health unhealthy'));
});

test('formatMiB tolerates absent or invalid memory readings', () => {
    assert.equal(formatMiB(undefined), '—');
    assert.equal(formatMiB(Number.NaN), '—');
    assert.equal(formatMiB(1024.4), '1,024 MiB');
});
