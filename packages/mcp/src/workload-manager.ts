import * as crypto from 'node:crypto';
import { McpRuntimeMode } from './access-policy.js';

export type WorkloadLane = 'indexing' | 'search';
export type WorkloadJobType = 'interactive-index' | 'background-sync' | 'search';

interface WorkloadManagerOptions {
    mode: McpRuntimeMode;
    maxIndexingConcurrency?: number;
    maxSearchConcurrency?: number;
    backgroundSyncBaseBackoffMs?: number;
    backgroundSyncMaxBackoffMs?: number;
    interactivePriorityWindowMs?: number;
    interactiveRepoPriorityBoost?: number;
    onStateChanged?: (snapshot: WorkloadSnapshot, reason: string) => void | Promise<void>;
}

interface QueuedWorkloadJob<T> {
    id: string;
    lane: WorkloadLane;
    type: WorkloadJobType;
    codebasePath: string;
    basePriority: number;
    priority: number;
    enqueuedAt: string;
    readyAt?: number;
    abortController: AbortController;
    run: (signal: AbortSignal) => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

interface ActiveWorkloadJob {
    id: string;
    lane: WorkloadLane;
    type: WorkloadJobType;
    codebasePath: string;
    basePriority: number;
    priority: number;
    enqueuedAt: string;
    startedAt: string;
    abortController: AbortController;
    cancelRequestedAt?: string;
    cancellationReason?: string;
}

interface BackgroundSyncBackoffState {
    consecutiveFailures: number;
    retryAfterAt: number;
}

export interface WorkloadJobSnapshot {
    id: string;
    type: WorkloadJobType;
    codebasePath: string;
    priority: number;
    enqueuedAt: string;
    startedAt?: string;
    readyAt?: string;
    cancelRequestedAt?: string;
    queuePosition?: number;
}

export interface WorkloadLaneSnapshot {
    maxConcurrency: number;
    activeCount: number;
    queuedCount: number;
    activeJobs: WorkloadJobSnapshot[];
    queuedJobs: WorkloadJobSnapshot[];
}

export interface WorkloadSnapshot {
    mode: McpRuntimeMode;
    indexing: WorkloadLaneSnapshot;
    search: WorkloadLaneSnapshot;
}

interface QueueWorkOptions {
    codebasePath: string;
    priority: number;
    type: WorkloadJobType;
}

export interface EnqueuedIndexingTask<T> {
    startedImmediately: boolean;
    queuePosition: number;
    completion: Promise<T>;
}

export interface CancelledWorkloadSummary {
    queued: Array<{ id: string; type: WorkloadJobType; codebasePath: string }>;
    active: Array<{ id: string; type: WorkloadJobType; codebasePath: string }>;
}

export class WorkloadCancelledError extends Error {
    public readonly code = 'WORKLOAD_CANCELLED';

    constructor(message: string) {
        super(message);
        this.name = 'WorkloadCancelledError';
    }
}

export function isWorkloadCancelledError(error: unknown): error is WorkloadCancelledError {
    return error instanceof WorkloadCancelledError
        || (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'WORKLOAD_CANCELLED');
}

export class WorkloadManager {
    private readonly mode: McpRuntimeMode;
    private readonly maxIndexingConcurrency: number;
    private readonly maxSearchConcurrency: number;
    private readonly backgroundSyncBaseBackoffMs: number;
    private readonly backgroundSyncMaxBackoffMs: number;
    private readonly interactivePriorityWindowMs: number;
    private readonly interactiveRepoPriorityBoost: number;
    private readonly onStateChanged?: (snapshot: WorkloadSnapshot, reason: string) => void | Promise<void>;
    private readonly indexingQueue: Array<QueuedWorkloadJob<unknown>> = [];
    private readonly searchQueue: Array<QueuedWorkloadJob<unknown>> = [];
    private readonly activeIndexingJobs = new Map<string, ActiveWorkloadJob>();
    private readonly activeSearchJobs = new Map<string, ActiveWorkloadJob>();
    private readonly backgroundSyncBackoff = new Map<string, BackgroundSyncBackoffState>();
    private readonly recentInteractiveActivity = new Map<string, number>();
    private readonly laneWakeTimers: Partial<Record<WorkloadLane, ReturnType<typeof setTimeout>>> = {};

    constructor(options: WorkloadManagerOptions) {
        this.mode = options.mode;
        this.maxIndexingConcurrency = this.normalizeLimit(options.maxIndexingConcurrency, 1);
        this.maxSearchConcurrency = this.normalizeLimit(options.maxSearchConcurrency, 4);
        this.backgroundSyncBaseBackoffMs = this.normalizeLimit(options.backgroundSyncBaseBackoffMs, 30_000);
        this.backgroundSyncMaxBackoffMs = Math.max(
            this.backgroundSyncBaseBackoffMs,
            this.normalizeLimit(options.backgroundSyncMaxBackoffMs, 5 * 60 * 1000)
        );
        this.interactivePriorityWindowMs = this.normalizeLimit(options.interactivePriorityWindowMs, 10 * 60 * 1000);
        this.interactiveRepoPriorityBoost = Math.max(
            0,
            Math.floor(options.interactiveRepoPriorityBoost ?? 25)
        );
        this.onStateChanged = options.onStateChanged;
    }

    public getSnapshot(): WorkloadSnapshot {
        return {
            mode: this.mode,
            indexing: this.buildLaneSnapshot('indexing'),
            search: this.buildLaneSnapshot('search')
        };
    }

    public enqueueInteractiveIndexing<T>(codebasePath: string, run: (signal: AbortSignal) => Promise<T>): EnqueuedIndexingTask<T> {
        if (this.mode === 'daemon') {
            this.recordInteractiveActivity(codebasePath);
        }

        return this.enqueueIndexingTask(codebasePath, run, {
            codebasePath,
            priority: 0,
            type: 'interactive-index'
        });
    }

    public async runBackgroundSync<T>(codebasePath: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const task = this.enqueueIndexingTask(codebasePath, run, {
            codebasePath,
            priority: 100,
            type: 'background-sync'
        });
        return task.completion;
    }

    public async runSearch<T>(codebasePath: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (this.mode !== 'daemon') {
            return run(new AbortController().signal);
        }

        this.recordInteractiveActivity(codebasePath);

        return this.enqueueWork('search', run, {
            codebasePath,
            priority: 0,
            type: 'search'
        }).completion;
    }

    private enqueueIndexingTask<T>(
        codebasePath: string,
        run: (signal: AbortSignal) => Promise<T>,
        options: QueueWorkOptions
    ): EnqueuedIndexingTask<T> {
        if (this.mode !== 'daemon') {
            const completion = run(new AbortController().signal);
            return {
                startedImmediately: true,
                queuePosition: 0,
                completion
            };
        }

        return this.enqueueWork('indexing', run, options);
    }

    private enqueueWork<T>(
        lane: WorkloadLane,
        run: (signal: AbortSignal) => Promise<T>,
        options: QueueWorkOptions
    ): EnqueuedIndexingTask<T> {
        const queue = this.getQueue(lane);
        const activeJobs = this.getActiveJobs(lane);
        const jobId = crypto.randomUUID();
        const enqueuedAt = new Date().toISOString();
        const readyAt = options.type === 'background-sync'
            ? this.getBackgroundSyncReadyAt(options.codebasePath)
            : undefined;
        const priority = this.computePriority(options.type, options.codebasePath, options.priority);

        let resolveCompletion!: (value: T) => void;
        let rejectCompletion!: (reason?: unknown) => void;
        const completion = new Promise<T>((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        });

        const job: QueuedWorkloadJob<T> = {
            id: jobId,
            lane,
            type: options.type,
            codebasePath: options.codebasePath,
            basePriority: options.priority,
            priority,
            enqueuedAt,
            readyAt,
            abortController: new AbortController(),
            run,
            resolve: resolveCompletion,
            reject: rejectCompletion
        };

        const startedImmediately = activeJobs.size < this.getMaxConcurrency(lane)
            && queue.length === 0
            && readyAt === undefined;
        if (startedImmediately) {
            void this.startQueuedJob(job);
            return {
                startedImmediately: true,
                queuePosition: 0,
                completion
            };
        }

        queue.push(job as QueuedWorkloadJob<unknown>);
        this.sortQueue(queue);
        this.notifyStateChanged(`${lane}-queued`);
        void this.drainQueue(lane);

        return {
            startedImmediately: false,
            queuePosition: queue.findIndex((candidate) => candidate.id === jobId) + 1,
            completion
        };
    }

    private async startQueuedJob<T>(job: QueuedWorkloadJob<T>): Promise<void> {
        if (job.abortController.signal.aborted) {
            job.reject(job.abortController.signal.reason ?? new WorkloadCancelledError('Queued workload was cancelled before start.'));
            return;
        }

        const activeJobs = this.getActiveJobs(job.lane);
        const activeJob: ActiveWorkloadJob = {
            id: job.id,
            lane: job.lane,
            type: job.type,
            codebasePath: job.codebasePath,
            basePriority: job.basePriority,
            priority: job.priority,
            enqueuedAt: job.enqueuedAt,
            startedAt: new Date().toISOString(),
            abortController: job.abortController
        };

        activeJobs.set(job.id, activeJob);
        this.notifyStateChanged(`${job.lane}-started`);

        try {
            const result = await job.run(job.abortController.signal);
            if (job.type === 'background-sync') {
                this.clearBackgroundSyncBackoff(job.codebasePath);
            }
            job.resolve(result);
        } catch (error) {
            if (job.type === 'background-sync' && !isWorkloadCancelledError(error)) {
                const backoffMs = this.recordBackgroundSyncFailure(job.codebasePath);
                console.warn(
                    `[WORKLOAD] Background sync for '${job.codebasePath}' failed. ` +
                    `Applying retry backoff of ${backoffMs}ms.`
                );
            }
            job.reject(error);
        } finally {
            activeJobs.delete(job.id);
            this.notifyStateChanged(`${job.lane}-finished`);
            void this.drainQueue(job.lane);
        }
    }

    private async drainQueue(lane: WorkloadLane): Promise<void> {
        const queue = this.getQueue(lane);
        const activeJobs = this.getActiveJobs(lane);
        const maxConcurrency = this.getMaxConcurrency(lane);

        this.clearWakeTimer(lane);

        while (queue.length > 0 && activeJobs.size < maxConcurrency) {
            this.sortQueue(queue);
            const nextJob = queue[0];
            if (!nextJob) {
                break;
            }

            if (typeof nextJob.readyAt === 'number' && nextJob.readyAt > Date.now()) {
                this.scheduleWakeTimer(lane, nextJob.readyAt);
                break;
            }

            queue.shift();
            void this.startQueuedJob(nextJob);
        }

        if (queue.length === 0) {
            this.clearWakeTimer(lane);
        }

        this.notifyStateChanged(`${lane}-drained`);
    }

    public cancelCodebaseIndexingWork(
        codebasePath: string,
        reason: string = 'Cancelled by daemon operator.'
    ): CancelledWorkloadSummary {
        const cancellationError = new WorkloadCancelledError(reason);
        const queued: CancelledWorkloadSummary['queued'] = [];
        const active: CancelledWorkloadSummary['active'] = [];

        for (let index = this.indexingQueue.length - 1; index >= 0; index -= 1) {
            const job = this.indexingQueue[index];
            if (job.codebasePath !== codebasePath) {
                continue;
            }

            this.indexingQueue.splice(index, 1);
            job.abortController.abort(cancellationError);
            job.reject(cancellationError);
            queued.push({
                id: job.id,
                type: job.type,
                codebasePath: job.codebasePath
            });
        }

        for (const job of this.activeIndexingJobs.values()) {
            if (job.codebasePath !== codebasePath) {
                continue;
            }

            job.cancelRequestedAt = new Date().toISOString();
            job.cancellationReason = reason;
            job.abortController.abort(cancellationError);
            active.push({
                id: job.id,
                type: job.type,
                codebasePath: job.codebasePath
            });
        }

        if (queued.length > 0 || active.length > 0) {
            this.notifyStateChanged('indexing-cancelled');
        }

        return { queued, active };
    }

    public async waitForCodebaseIndexingIdle(
        codebasePath: string,
        timeoutMs: number = 15000
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const hasQueued = this.indexingQueue.some((job) => job.codebasePath === codebasePath);
            const hasActive = Array.from(this.activeIndexingJobs.values()).some((job) => job.codebasePath === codebasePath);
            if (!hasQueued && !hasActive) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return false;
    }

    public cancelAllWork(reason: string = 'Cancelled by daemon shutdown.'): CancelledWorkloadSummary {
        const cancellationError = new WorkloadCancelledError(reason);
        const queued: CancelledWorkloadSummary['queued'] = [];
        const active: CancelledWorkloadSummary['active'] = [];

        for (const queue of [this.indexingQueue, this.searchQueue]) {
            for (const job of queue.splice(0, queue.length)) {
                job.abortController.abort(cancellationError);
                job.reject(cancellationError);
                queued.push({
                    id: job.id,
                    type: job.type,
                    codebasePath: job.codebasePath
                });
            }
        }

        for (const activeJobs of [this.activeIndexingJobs, this.activeSearchJobs]) {
            for (const job of activeJobs.values()) {
                job.cancelRequestedAt = new Date().toISOString();
                job.cancellationReason = reason;
                job.abortController.abort(cancellationError);
                active.push({
                    id: job.id,
                    type: job.type,
                    codebasePath: job.codebasePath
                });
            }
        }

        this.clearWakeTimer('indexing');
        this.clearWakeTimer('search');
        this.notifyStateChanged('all-work-cancelled');

        return { queued, active };
    }

    private sortQueue(queue: Array<QueuedWorkloadJob<unknown>>): void {
        queue.sort((left, right) => {
            const leftReadyAt = left.readyAt ?? 0;
            const rightReadyAt = right.readyAt ?? 0;
            if (leftReadyAt !== rightReadyAt) {
                return leftReadyAt - rightReadyAt;
            }
            if (left.priority !== right.priority) {
                return left.priority - right.priority;
            }
            return left.enqueuedAt.localeCompare(right.enqueuedAt);
        });
    }

    private normalizeLimit(rawLimit: number | undefined, fallback: number): number {
        if (!rawLimit || !Number.isFinite(rawLimit) || rawLimit < 1) {
            return fallback;
        }

        return Math.max(1, Math.floor(rawLimit));
    }

    private getQueue(lane: WorkloadLane): Array<QueuedWorkloadJob<unknown>> {
        return lane === 'indexing' ? this.indexingQueue : this.searchQueue;
    }

    private getActiveJobs(lane: WorkloadLane): Map<string, ActiveWorkloadJob> {
        return lane === 'indexing' ? this.activeIndexingJobs : this.activeSearchJobs;
    }

    private getMaxConcurrency(lane: WorkloadLane): number {
        return lane === 'indexing' ? this.maxIndexingConcurrency : this.maxSearchConcurrency;
    }

    private buildLaneSnapshot(lane: WorkloadLane): WorkloadLaneSnapshot {
        const queue = this.getQueue(lane);
        const activeJobs = this.getActiveJobs(lane);

        return {
            maxConcurrency: this.getMaxConcurrency(lane),
            activeCount: activeJobs.size,
            queuedCount: queue.length,
            activeJobs: Array.from(activeJobs.values()).map((job) => ({
                id: job.id,
                type: job.type,
                codebasePath: job.codebasePath,
                priority: job.priority,
                enqueuedAt: job.enqueuedAt,
                startedAt: job.startedAt,
                ...(job.cancelRequestedAt ? { cancelRequestedAt: job.cancelRequestedAt } : {})
            })),
            queuedJobs: queue.map((job, index) => ({
                id: job.id,
                type: job.type,
                codebasePath: job.codebasePath,
                priority: job.priority,
                enqueuedAt: job.enqueuedAt,
                queuePosition: index + 1,
                ...(typeof job.readyAt === 'number' ? { readyAt: new Date(job.readyAt).toISOString() } : {})
            }))
        };
    }

    private recordInteractiveActivity(codebasePath: string): void {
        this.recentInteractiveActivity.set(codebasePath, Date.now());
        this.reprioritizeQueuedBackgroundSyncJobs();
    }

    private reprioritizeQueuedBackgroundSyncJobs(): void {
        let changed = false;
        for (const job of this.indexingQueue) {
            if (job.type !== 'background-sync') {
                continue;
            }

            const nextPriority = this.computePriority(job.type, job.codebasePath, job.basePriority);
            if (nextPriority !== job.priority) {
                job.priority = nextPriority;
                changed = true;
            }
        }

        if (changed) {
            this.sortQueue(this.indexingQueue);
            this.notifyStateChanged('indexing-reprioritized');
        }
    }

    private computePriority(type: WorkloadJobType, codebasePath: string, basePriority: number): number {
        if (type !== 'background-sync') {
            return basePriority;
        }

        const lastInteractiveAt = this.recentInteractiveActivity.get(codebasePath);
        if (!lastInteractiveAt) {
            return basePriority;
        }

        if ((Date.now() - lastInteractiveAt) > this.interactivePriorityWindowMs) {
            return basePriority;
        }

        return Math.max(1, basePriority - this.interactiveRepoPriorityBoost);
    }

    private getBackgroundSyncReadyAt(codebasePath: string): number | undefined {
        const state = this.backgroundSyncBackoff.get(codebasePath);
        if (!state) {
            return undefined;
        }

        if (state.retryAfterAt <= Date.now()) {
            this.backgroundSyncBackoff.delete(codebasePath);
            return undefined;
        }

        return state.retryAfterAt;
    }

    private clearBackgroundSyncBackoff(codebasePath: string): void {
        this.backgroundSyncBackoff.delete(codebasePath);
    }

    private recordBackgroundSyncFailure(codebasePath: string): number {
        const currentState = this.backgroundSyncBackoff.get(codebasePath);
        const consecutiveFailures = (currentState?.consecutiveFailures ?? 0) + 1;
        const backoffMs = Math.min(
            this.backgroundSyncBaseBackoffMs * (2 ** (consecutiveFailures - 1)),
            this.backgroundSyncMaxBackoffMs
        );

        this.backgroundSyncBackoff.set(codebasePath, {
            consecutiveFailures,
            retryAfterAt: Date.now() + backoffMs
        });

        return backoffMs;
    }

    private scheduleWakeTimer(lane: WorkloadLane, readyAt: number): void {
        this.clearWakeTimer(lane);

        const delayMs = Math.max(0, readyAt - Date.now());
        this.laneWakeTimers[lane] = setTimeout(() => {
            this.laneWakeTimers[lane] = undefined;
            void this.drainQueue(lane);
        }, delayMs);
    }

    private clearWakeTimer(lane: WorkloadLane): void {
        const timer = this.laneWakeTimers[lane];
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.laneWakeTimers[lane] = undefined;
    }

    private notifyStateChanged(reason: string): void {
        if (!this.onStateChanged) {
            return;
        }

        try {
            void this.onStateChanged(this.getSnapshot(), reason);
        } catch (error) {
            console.error('[WORKLOAD] Failed to report workload state change:', error);
        }
    }
}
