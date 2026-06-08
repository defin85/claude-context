import type { IndexingAcceleratorSnapshot } from '@zilliz/claude-context-core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ManagedBgeM3WorkerManager } from './bge-m3-managed-workers.js';
import type { DaemonOperatorStatus } from './daemon-discovery.js';

export const GET_DAEMON_STATUS_TOOL_DESCRIPTION = 'Inspect daemon runtime metadata, known repositories, active workload state, and the agent worker planning policy.';

export const WORKER_PLANNING_POLICY_TEXT = 'Worker planning policy: daemon-owned; agents must submit indexing workloads only and must not start BGE-M3 workers directly.';

export interface WorkerPlanningPolicySnapshot {
    owner: 'daemon';
    agentDirective: 'submit_indexing_workloads_only';
    doNotStartWorkersDirectly: true;
    managedWorkerProvider: 'BGE_M3';
    planningScope: 'host_gpu';
    calibrationScope: 'host_profile';
    calibrationPath: '~/.context/mcp/bge-m3-worker-vram.json';
    profileKeyFields: Array<'model' | 'mode' | 'precision' | 'device' | 'lifecycle'>;
    statusFields: {
        queue: 'runtimes[].workload';
        workers: 'accelerator.workers';
        managedWorkers: 'managedBgeM3Workers';
        vramPlan: 'managedBgeM3Workers.vramPlanning';
        fallbackReasons: [
            'accelerator.fallbackReason',
            'managedBgeM3Workers.fallbackReason',
            'managedBgeM3Workers.vramPlanning.stopReason',
            'runtimes[].sync.reason',
        ];
    };
    recommendedAgentFlow: [
        'call get_daemon_status before indexing',
        'call index_codebase for allowed repo paths',
        'poll get_indexing_status or get_daemon_status',
        'if queued, wait or report queue state',
        'do not start sidecars, child processes, or systemd worker units directly',
        'if fallbackReason or stopReason is present, report it instead of overriding daemon policy',
    ];
}

type ManagedBgeM3WorkerSnapshot = ReturnType<ManagedBgeM3WorkerManager['getSnapshot']>;

export type DaemonStatusStructuredContent = DaemonOperatorStatus & {
    accelerator?: IndexingAcceleratorSnapshot;
    managedBgeM3Workers?: ManagedBgeM3WorkerSnapshot;
    workerPlanningPolicy: WorkerPlanningPolicySnapshot;
};

export type DaemonStatusResult = CallToolResult & {
    structuredContent: DaemonStatusStructuredContent;
};

export function createWorkerPlanningPolicy(): WorkerPlanningPolicySnapshot {
    return {
        owner: 'daemon',
        agentDirective: 'submit_indexing_workloads_only',
        doNotStartWorkersDirectly: true,
        managedWorkerProvider: 'BGE_M3',
        planningScope: 'host_gpu',
        calibrationScope: 'host_profile',
        calibrationPath: '~/.context/mcp/bge-m3-worker-vram.json',
        profileKeyFields: ['model', 'mode', 'precision', 'device', 'lifecycle'],
        statusFields: {
            queue: 'runtimes[].workload',
            workers: 'accelerator.workers',
            managedWorkers: 'managedBgeM3Workers',
            vramPlan: 'managedBgeM3Workers.vramPlanning',
            fallbackReasons: [
                'accelerator.fallbackReason',
                'managedBgeM3Workers.fallbackReason',
                'managedBgeM3Workers.vramPlanning.stopReason',
                'runtimes[].sync.reason',
            ],
        },
        recommendedAgentFlow: [
            'call get_daemon_status before indexing',
            'call index_codebase for allowed repo paths',
            'poll get_indexing_status or get_daemon_status',
            'if queued, wait or report queue state',
            'do not start sidecars, child processes, or systemd worker units directly',
            'if fallbackReason or stopReason is present, report it instead of overriding daemon policy',
        ],
    };
}

export function createDaemonStatusResult(
    operatorStatus: DaemonOperatorStatus,
    accelerator: IndexingAcceleratorSnapshot | undefined,
    managedBgeM3Workers: ManagedBgeM3WorkerSnapshot | undefined,
): DaemonStatusResult {
    const textLines = [
        `Daemon runtimes: ${operatorStatus.runtimes.length}`,
        WORKER_PLANNING_POLICY_TEXT,
    ];

    for (const runtime of operatorStatus.runtimes) {
        const knownCodebasesCount = runtime.knownCodebases?.length || 0;
        textLines.push(
            `- ${runtime.runtimeId} pid=${runtime.pid} healthy=${runtime.healthy} ` +
            `repos=${knownCodebasesCount} endpoint=${runtime.endpointUrl}`,
        );
    }
    if (accelerator) {
        const retryReasonText = accelerator.retryReasons
            ? Object.entries(accelerator.retryReasons)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => `${reason}=${count}`)
                .join(',')
            : '';
        textLines.push(
            `Accelerator: mode=${accelerator.mode} active=${accelerator.active} ` +
            `embeddingInFlight=${accelerator.inFlightEmbeddingBatches} insertInFlight=${accelerator.inFlightInsertBatches}` +
            ` retries=${accelerator.retriedBatches} rejectedWorkers=${accelerator.rejectedWorkers ?? 0}` +
            ` recoveredWorkers=${accelerator.workerLifecycle?.recovered ?? 0}` +
            `${retryReasonText ? ` retryReasons=${retryReasonText}` : ''}` +
            `${accelerator.fallbackReason ? ` fallback=${accelerator.fallbackReason}` : ''}`,
        );
    }
    if (managedBgeM3Workers) {
        const vramPlanning = managedBgeM3Workers.vramPlanning;
        textLines.push(
            `Managed BGE-M3 workers: primary=${managedBgeM3Workers.primaryEndpoint ?? 'none'} ` +
            `configured=${managedBgeM3Workers.configuredEndpoints.length} ` +
            `managedPlanned=${managedBgeM3Workers.plannedEndpoints.length} ` +
            `managedRunning=${managedBgeM3Workers.runningWorkers.length} ` +
            `totalPool=${managedBgeM3Workers.totalPoolEndpoints.length}` +
            `${managedBgeM3Workers.fallbackReason ? ` fallback=${managedBgeM3Workers.fallbackReason}` : ''}`,
        );
        if (vramPlanning) {
            textLines.push(
                `Managed BGE-M3 VRAM plan: budget=${vramPlanning.budgetMiB ?? 'unmeasured'}MiB ` +
                `used=${vramPlanning.usedBeforeMiB ?? 'unmeasured'}MiB ` +
                `estimate=${vramPlanning.estimatedWorkerMiB}MiB source=${vramPlanning.calibrationSource} ` +
                `planned=${vramPlanning.plannedWorkers} started=${vramPlanning.startedWorkers}` +
                `${vramPlanning.stopReason ? ` stop=${vramPlanning.stopReason}` : ''}`,
            );
        }
    }

    return {
        content: [{
            type: 'text',
            text: textLines.join('\n'),
        }],
        structuredContent: {
            ...operatorStatus,
            accelerator,
            managedBgeM3Workers,
            workerPlanningPolicy: createWorkerPlanningPolicy(),
        },
    };
}
