import * as crypto from 'node:crypto';
import { McpRuntimeMode } from './access-policy.js';

export type WorkloadLane = 'indexing' | 'search';
export type WorkloadJobType = 'interactive-index' | 'background-sync' | 'search';

interface WorkloadManagerOptions {
    mode: McpRuntimeMode;
    maxIndexingConcurrency?: number;
    maxSearchConcurrency?: number;
    onStateChanged?: (snapshot: WorkloadSnapshot, reason: string) => void | Promise<void>;
}

interface QueuedWorkloadJob<T> {
    id: string;
    lane: WorkloadLane;
    type: WorkloadJobType;
    codebasePath: string;
    priority: number;
    enqueuedAt: string;
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

interface ActiveWorkloadJob {
    id: string;
    lane: WorkloadLane;
    type: WorkloadJobType;
    codebasePath: string;
    priority: number;
    enqueuedAt: string;
    startedAt: string;
}

export interface WorkloadJobSnapshot {
    id: string;
    type: WorkloadJobType;
    codebasePath: string;
    priority: number;
    enqueuedAt: string;
    startedAt?: string;
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

export class WorkloadManager {
    private readonly mode: McpRuntimeMode;
    private readonly maxIndexingConcurrency: number;
    private readonly maxSearchConcurrency: number;
    private readonly onStateChanged?: (snapshot: WorkloadSnapshot, reason: string) => void | Promise<void>;
    private readonly indexingQueue: Array<QueuedWorkloadJob<unknown>> = [];
    private readonly searchQueue: Array<QueuedWorkloadJob<unknown>> = [];
    private readonly activeIndexingJobs = new Map<string, ActiveWorkloadJob>();
    private readonly activeSearchJobs = new Map<string, ActiveWorkloadJob>();

    constructor(options: WorkloadManagerOptions) {
        this.mode = options.mode;
        this.maxIndexingConcurrency = this.normalizeLimit(options.maxIndexingConcurrency, 1);
        this.maxSearchConcurrency = this.normalizeLimit(options.maxSearchConcurrency, 4);
        this.onStateChanged = options.onStateChanged;
    }

    public getSnapshot(): WorkloadSnapshot {
        return {
            mode: this.mode,
            indexing: this.buildLaneSnapshot('indexing'),
            search: this.buildLaneSnapshot('search')
        };
    }

    public enqueueInteractiveIndexing<T>(codebasePath: string, run: () => Promise<T>): EnqueuedIndexingTask<T> {
        return this.enqueueIndexingTask(codebasePath, run, {
            codebasePath,
            priority: 0,
            type: 'interactive-index'
        });
    }

    public async runBackgroundSync<T>(codebasePath: string, run: () => Promise<T>): Promise<T> {
        const task = this.enqueueIndexingTask(codebasePath, run, {
            codebasePath,
            priority: 100,
            type: 'background-sync'
        });
        return task.completion;
    }

    public async runSearch<T>(codebasePath: string, run: () => Promise<T>): Promise<T> {
        if (this.mode !== 'daemon') {
            return run();
        }

        return this.enqueueWork('search', run, {
            codebasePath,
            priority: 0,
            type: 'search'
        }).completion;
    }

    private enqueueIndexingTask<T>(
        codebasePath: string,
        run: () => Promise<T>,
        options: QueueWorkOptions
    ): EnqueuedIndexingTask<T> {
        if (this.mode !== 'daemon') {
            const completion = run();
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
        run: () => Promise<T>,
        options: QueueWorkOptions
    ): EnqueuedIndexingTask<T> {
        const queue = this.getQueue(lane);
        const activeJobs = this.getActiveJobs(lane);
        const jobId = crypto.randomUUID();
        const enqueuedAt = new Date().toISOString();

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
            priority: options.priority,
            enqueuedAt,
            run,
            resolve: resolveCompletion,
            reject: rejectCompletion
        };

        const startedImmediately = activeJobs.size < this.getMaxConcurrency(lane) && queue.length === 0;
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

        return {
            startedImmediately: false,
            queuePosition: queue.findIndex((candidate) => candidate.id === jobId) + 1,
            completion
        };
    }

    private async startQueuedJob<T>(job: QueuedWorkloadJob<T>): Promise<void> {
        const activeJobs = this.getActiveJobs(job.lane);
        const activeJob: ActiveWorkloadJob = {
            id: job.id,
            lane: job.lane,
            type: job.type,
            codebasePath: job.codebasePath,
            priority: job.priority,
            enqueuedAt: job.enqueuedAt,
            startedAt: new Date().toISOString()
        };

        activeJobs.set(job.id, activeJob);
        this.notifyStateChanged(`${job.lane}-started`);

        try {
            const result = await job.run();
            job.resolve(result);
        } catch (error) {
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

        while (queue.length > 0 && activeJobs.size < maxConcurrency) {
            const nextJob = queue.shift();
            if (!nextJob) {
                break;
            }

            void this.startQueuedJob(nextJob);
        }

        this.notifyStateChanged(`${lane}-drained`);
    }

    private sortQueue(queue: Array<QueuedWorkloadJob<unknown>>): void {
        queue.sort((left, right) => {
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
                startedAt: job.startedAt
            })),
            queuedJobs: queue.map((job) => ({
                id: job.id,
                type: job.type,
                codebasePath: job.codebasePath,
                priority: job.priority,
                enqueuedAt: job.enqueuedAt
            }))
        };
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
