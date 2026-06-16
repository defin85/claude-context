import { Embedding, EmbeddingVector, MultiVectorEmbedding } from './base-embedding';
import {
    createEmptyFailureCategorySummary,
    failureReasonToCategory,
    type EmbeddingFailureEvidence,
    type EmbeddingFailureRequestShape,
    type EmbeddingWorkerFailureCategory,
    type EmbeddingWorkerFailureCategorySummary,
    type EmbeddingWorkerFailureReason,
    type WorkerLifecycleEvent,
} from '../indexing-accelerator';

export type BgeM3Mode = 'full' | 'dense';

type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<unknown>;
}>;

export interface BgeM3EmbeddingConfig {
    endpoint: string;
    workerEndpoints?: string[];
    model?: string;
    mode?: BgeM3Mode;
    fetch?: FetchLike;
    dimension?: number;
    maxTokens?: number;
    retryBudget?: number;
    expectedProfile?: Partial<BgeM3WorkerProfile>;
    workerRecoveryCooldownMs?: number;
}

export interface BgeM3EmbeddingRequestContext {
    logicalBatchId?: number;
    chunkCount?: number;
    contentCharCount?: number;
    estimatedTokens?: number;
    maxContentChars?: number;
    maxEstimatedTokens?: number;
    retryAttempt?: number;
}

export interface BgeM3WorkerProfile {
    model: string;
    modelRevision?: string;
    defaultMode: BgeM3Mode;
    supportedModes: string[];
    outputs: string[];
    denseDimension?: number;
    precision?: string;
    maxTokens?: number;
    preprocessingProfile?: string;
}

interface BgeM3Worker {
    endpoint: string;
    inFlight: number;
    healthy: boolean;
    rejectedReason?: string;
    rejectedFailureReason?: EmbeddingWorkerFailureReason;
    rejectedRetrySafe?: boolean;
    profile?: BgeM3WorkerProfile;
    lastFailureAt?: string;
    lastSuccessAt?: string;
    recoveryAttempts: number;
    lastRecoveryAttemptAt?: string;
    recoveryEligibleAt?: number;
    lastFailureEvidence?: EmbeddingFailureEvidence;
    lastRecoveredFailureEvidence?: EmbeddingFailureEvidence;
    rejectionCountsByCategory: EmbeddingWorkerFailureCategorySummary;
    recovering: boolean;
}

export interface BgeM3WorkerSnapshot {
    endpoint: string;
    healthy: boolean;
    inFlight: number;
    rejectedReason?: string;
    rejectedFailureReason?: EmbeddingWorkerFailureReason;
    rejectedRetrySafe?: boolean;
    lastFailureAt?: string;
    lastSuccessAt?: string;
    recoveryAttempts: number;
    lastRecoveryAttemptAt?: string;
    lastFailedRequestId?: string;
    lastFailedLogicalBatchId?: number;
    lastFailureCategory?: EmbeddingWorkerFailureCategory;
    lastFailureEvidence?: EmbeddingFailureEvidence;
    lastRecoveredFailureEvidence?: EmbeddingFailureEvidence;
    recoveryEligibleAt?: string;
    rejectionCountsByCategory?: EmbeddingWorkerFailureCategorySummary;
    poolState: 'accepted' | 'rejected' | 'recovering';
}

export interface BgeM3WorkerFailure {
    reason: EmbeddingWorkerFailureReason;
    retrySafe: boolean;
    message: string;
    error: Error;
    evidence?: EmbeddingFailureEvidence;
}

interface BgeM3WorkerFailureContext {
    workerEndpoint: string;
    failure: BgeM3WorkerFailure;
}

export interface BgeM3WorkerLifecycleSnapshot {
    event: WorkerLifecycleEvent;
    endpoint: string;
    reason: EmbeddingWorkerFailureReason;
    retrySafe: boolean;
    occurredAt: string;
}

interface ParsedBgeM3Response {
    dense?: number[];
    sparse?: {
        indices: number[];
        values: number[];
    };
    colbert?: number[][];
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isNumberMatrix(value: unknown): value is number[][] {
    return Array.isArray(value) && value.every(isNumberArray);
}

function getProperty(source: Record<string, unknown>, names: string[]): unknown {
    for (const name of names) {
        if (name in source) {
            return source[name];
        }
    }
    return undefined;
}

function normalizeEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '');
}

function createRequestId(): string {
    return `bge-m3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneFailureEvidence(evidence: EmbeddingFailureEvidence): EmbeddingFailureEvidence {
    return {
        ...evidence,
        request: { ...evidence.request },
    };
}

function getFailureEvidence(
    error: Error,
    reason: EmbeddingWorkerFailureReason,
    retrySafe: boolean,
): EmbeddingFailureEvidence | undefined {
    const source = error as Error & { bgeM3FailureEvidence?: EmbeddingFailureEvidence };
    if (!source.bgeM3FailureEvidence) {
        return undefined;
    }
    return {
        ...cloneFailureEvidence(source.bgeM3FailureEvidence),
        reason,
        retrySafe,
        category: source.bgeM3FailureEvidence.category || failureReasonToCategory(reason),
    };
}

function createFailureEvidence(options: {
    error: Error;
    workerEndpoint: string;
    request: EmbeddingFailureRequestShape;
    durationMs: number;
    retryAttempt: number;
    reason: EmbeddingWorkerFailureReason;
    retrySafe: boolean;
}): EmbeddingFailureEvidence {
    const cause = getErrorCause(options.error);
    return {
        requestId: options.request.requestId,
        workerEndpoint: options.workerEndpoint,
        occurredAt: new Date().toISOString(),
        durationMs: Math.max(0, Math.round(options.durationMs)),
        retryAttempt: options.retryAttempt,
        retrySafe: options.retrySafe,
        reason: options.reason,
        category: classifyFailureCategory(options.error, options.reason),
        timeoutOrCancellationState: getTimeoutOrCancellationState(options.error, options.reason),
        errorName: options.error.name || 'Error',
        errorMessage: options.error.message || String(options.error),
        causeName: cause.name,
        causeCode: cause.code,
        causeMessage: cause.message,
        sidecarPhase: 'unknown',
        request: { ...options.request },
    };
}

function getErrorCause(error: Error): { name?: string; code?: string; message?: string } {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (!cause || typeof cause !== 'object') {
        return {};
    }
    const source = cause as Record<string, unknown>;
    return {
        name: typeof source.name === 'string' ? source.name : undefined,
        code: typeof source.code === 'string' ? source.code : undefined,
        message: typeof source.message === 'string' ? source.message : undefined,
    };
}

function classifyFailureCategory(
    error: Error,
    reason: EmbeddingWorkerFailureReason,
): EmbeddingWorkerFailureCategory {
    const lowerMessage = (error.message || '').toLowerCase();
    const cause = getErrorCause(error);
    const lowerCauseMessage = (cause.message || '').toLowerCase();
    const causeCode = (cause.code || '').toUpperCase();
    if (reason === 'embedding_timeout') {
        return 'timeout';
    }
    if (reason === 'cancellation') {
        return 'cancellation';
    }
    if (reason === 'metadata' || reason === 'health') {
        return 'metadata';
    }
    if (reason === 'startup') {
        return 'startup';
    }
    if (
        lowerMessage.includes('fetch failed') ||
        causeCode.startsWith('ECONN') ||
        causeCode === 'UND_ERR_SOCKET' ||
        lowerCauseMessage.includes('socket') ||
        lowerCauseMessage.includes('other side closed')
    ) {
        return 'fetch_failed';
    }
    if (lowerMessage.includes('sidecar request failed') || /\b[45]\d\d\b/.test(lowerMessage)) {
        return 'http_error';
    }
    if (lowerMessage.includes('json') || lowerMessage.includes('parse')) {
        return 'parse_error';
    }
    return failureReasonToCategory(reason);
}

function getTimeoutOrCancellationState(
    error: Error,
    reason: EmbeddingWorkerFailureReason,
): 'none' | 'timeout' | 'cancelled' | 'unknown' {
    const lowerMessage = (error.message || '').toLowerCase();
    if (reason === 'embedding_timeout' || lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
        return 'timeout';
    }
    if (reason === 'cancellation' || error.name === 'AbortError') {
        return 'cancelled';
    }
    return 'none';
}

export class BgeM3Embedding extends Embedding {
    private readonly endpoint: string;
    private readonly workers: BgeM3Worker[];
    private readonly model: string;
    private readonly mode: BgeM3Mode;
    private readonly fetchImpl: FetchLike;
    private readonly retryBudget: number;
    private readonly workerRecoveryCooldownMs: number;
    private readonly expectedProfile?: Partial<BgeM3WorkerProfile>;
    private workersInitialized = false;
    private workersInitializationPromise?: Promise<void>;
    private primaryProfile?: BgeM3WorkerProfile;
    private dimension: number;
    protected maxTokens: number = 8192;

    constructor(config: BgeM3EmbeddingConfig) {
        super();
        this.endpoint = normalizeEndpoint(config.endpoint);
        const endpoints = [
            this.endpoint,
            ...(config.workerEndpoints || []),
        ].map(normalizeEndpoint);
        this.workers = [...new Set(endpoints)].map((endpoint) => ({
            endpoint,
            inFlight: 0,
            healthy: endpoint === this.endpoint,
            recoveryAttempts: 0,
            rejectionCountsByCategory: createEmptyFailureCategorySummary(),
            recovering: false,
        }));
        this.model = config.model || 'BAAI/bge-m3';
        this.mode = config.mode || 'full';
        this.fetchImpl = config.fetch || (globalThis.fetch as unknown as FetchLike);
        this.retryBudget = Math.max(0, Math.floor(config.retryBudget ?? 1));
        this.workerRecoveryCooldownMs = Math.max(0, Math.floor(config.workerRecoveryCooldownMs ?? 30000));
        this.expectedProfile = config.expectedProfile;
        this.dimension = config.dimension || 1024;
        if (config.maxTokens) {
            this.maxTokens = config.maxTokens;
        }

        if (!this.fetchImpl) {
            throw new Error('BGE-M3 embedding provider requires fetch support');
        }
    }

    async detectDimension(testText: string = 'test'): Promise<number> {
        const result = await this.embedMulti(testText);
        this.dimension = result.dense.dimension;
        return this.dimension;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const result = await this.embedMulti(text);
        return result.dense;
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const results = await this.embedMultiBatch(texts);
        return results.map((result) => result.dense);
    }

    async embedMulti(text: string): Promise<MultiVectorEmbedding> {
        const processedText = this.preprocessText(text);
        const worker = this.getPrimaryWorker();
        worker.inFlight++;
        const response = await this.post(worker, '/embed', {
            input: processedText,
            model: this.model,
            mode: this.mode,
        });
        return this.toMultiVector(this.parseResponse(response));
    }

    async embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]> {
        const processedTexts = this.preprocessTexts(texts);
        const worker = this.getPrimaryWorker();
        worker.inFlight++;
        const response = await this.post(worker, '/embed_batch', {
                inputs: processedTexts,
                model: this.model,
                mode: this.mode,
            });

        return this.parseMultiVectorBatchResponse(response, processedTexts.length);
    }

    async embedMultiBatchWithWorkerPool(
        texts: string[],
        onRetry?: (workerEndpoint: string, error: Error, failure?: BgeM3WorkerFailure) => void,
        requestContext?: BgeM3EmbeddingRequestContext,
    ): Promise<MultiVectorEmbedding[]> {
        const processedTexts = this.preprocessTexts(texts);
        const response = await this.withWorkerRetry((worker, attempt) => this.post(worker, '/embed_batch', {
                inputs: processedTexts,
                model: this.model,
                mode: this.mode,
            }, {
                ...requestContext,
                retryAttempt: attempt,
            }), onRetry);

        return this.parseMultiVectorBatchResponse(response, processedTexts.length);
    }

    private parseMultiVectorBatchResponse(response: unknown, expectedLength: number): MultiVectorEmbedding[] {
        if (!Array.isArray(response)) {
            throw new Error('BGE-M3 sidecar returned invalid batch response');
        }

        if (response.length !== expectedLength) {
            throw new Error(
                `BGE-M3 sidecar returned ${response.length} embeddings for ${expectedLength} inputs`,
            );
        }

        return response.map((item) => this.toMultiVector(this.parseResponse(item)));
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'BGE_M3';
    }

    getMode(): BgeM3Mode {
        return this.mode;
    }

    getWorkerSnapshot(): BgeM3WorkerSnapshot[] {
        return this.workers.map((worker) => ({
            endpoint: worker.endpoint,
            healthy: worker.healthy,
            inFlight: worker.inFlight,
            rejectedReason: worker.rejectedReason,
            rejectedFailureReason: worker.rejectedFailureReason,
            rejectedRetrySafe: worker.rejectedRetrySafe,
            lastFailedRequestId: worker.lastFailureEvidence?.requestId,
            lastFailedLogicalBatchId: worker.lastFailureEvidence?.request.logicalBatchId,
            lastFailureCategory: worker.lastFailureEvidence?.category,
            lastFailureEvidence: worker.lastFailureEvidence
                ? cloneFailureEvidence(worker.lastFailureEvidence)
                : undefined,
            lastRecoveredFailureEvidence: worker.lastRecoveredFailureEvidence
                ? cloneFailureEvidence(worker.lastRecoveredFailureEvidence)
                : undefined,
            recoveryEligibleAt: worker.recoveryEligibleAt !== undefined
                ? new Date(worker.recoveryEligibleAt).toISOString()
                : undefined,
            rejectionCountsByCategory: { ...worker.rejectionCountsByCategory },
            lastFailureAt: worker.lastFailureAt,
            lastSuccessAt: worker.lastSuccessAt,
            recoveryAttempts: worker.recoveryAttempts,
            lastRecoveryAttemptAt: worker.lastRecoveryAttemptAt,
            poolState: worker.recovering ? 'recovering' : worker.healthy ? 'accepted' : 'rejected',
        }));
    }

    getWorkerPoolSize(): number {
        return this.workers.length;
    }

    getRetrievalMode(): string {
        return this.mode === 'full' ? 'BGE-M3 full' : 'BGE-M3 dense-only';
    }

    registerWorkerEndpoints(endpoints: string[]): void {
        const knownEndpoints = new Set(this.workers.map((worker) => worker.endpoint));
        for (const endpoint of endpoints.map(normalizeEndpoint).filter(Boolean)) {
            if (knownEndpoints.has(endpoint)) {
                continue;
            }
            knownEndpoints.add(endpoint);
            this.workers.push({
                endpoint,
                inFlight: 0,
                healthy: true,
                recoveryAttempts: 0,
                rejectionCountsByCategory: createEmptyFailureCategorySummary(),
                recovering: false,
                recoveryEligibleAt: 0,
            });
        }
    }

    private async post(
        worker: BgeM3Worker,
        path: string,
        body: Record<string, unknown>,
        requestContext?: BgeM3EmbeddingRequestContext,
    ): Promise<unknown> {
        const requestId = createRequestId();
        const bodyJson = JSON.stringify(body);
        const requestShape = this.createRequestShape(requestId, path, body, bodyJson, requestContext);
        const startedAt = Date.now();
        try {
            const response = await this.fetchImpl(`${worker.endpoint}${path}`, {
            method: 'POST',
            headers: {
                'connection': 'close',
                'content-type': 'application/json',
                'x-claude-context-request-id': requestId,
            },
            body: bodyJson,
            });

            if (!response.ok) {
                throw new Error(
                    `BGE-M3 sidecar request failed at ${worker.endpoint}: ${response.status} ${response.statusText}`,
                );
            }

            const result = await response.json();
            this.recordWorkerSuccess(worker);
            return result;
        } catch (error) {
            throw this.attachFailureEvidence(
                error,
                worker.endpoint,
                requestShape,
                Date.now() - startedAt,
                requestContext?.retryAttempt ?? 0,
            );
        } finally {
            worker.inFlight = Math.max(0, worker.inFlight - 1);
        }
    }

    private async get(worker: BgeM3Worker, path: string): Promise<unknown> {
        const response = await this.fetchImpl(`${worker.endpoint}${path}`, {
            method: 'GET',
            headers: {
                'connection': 'close',
            },
        });

        if (!response.ok) {
            throw new Error(
                `BGE-M3 sidecar metadata request failed at ${worker.endpoint}: ${response.status} ${response.statusText}`,
            );
        }

        return response.json();
    }

    private async withWorkerRetry(
        run: (worker: BgeM3Worker, attempt: number) => Promise<unknown>,
        onRetry?: (workerEndpoint: string, error: Error, failure?: BgeM3WorkerFailure) => void,
    ): Promise<unknown> {
        let lastError: unknown;
        let lastFailureContext: BgeM3WorkerFailureContext | undefined;
        let retryAttempts = 0;
        const attempts = Math.max(1, this.retryBudget + 1);
        for (let attempt = 0; attempt < attempts; attempt++) {
            let worker: BgeM3Worker;
            try {
                worker = await this.selectWorker();
            } catch (error) {
                if (lastFailureContext) {
                    throw this.createRetryBudgetExhaustedError(lastFailureContext, retryAttempts, error);
                }
                throw error;
            }
            try {
                return await run(worker, attempt);
            } catch (error) {
                lastError = error;
                const failure = this.classifyFailure(error, 'embedding');
                if (failure.reason === 'cancellation') {
                    break;
                }
                this.rejectWorker(worker, failure);
                if (attempt < attempts - 1 && failure.retrySafe) {
                    retryAttempts++;
                    lastFailureContext = {
                        workerEndpoint: worker.endpoint,
                        failure,
                    };
                    onRetry?.(
                        worker.endpoint,
                        failure.error,
                        failure,
                    );
                } else if (!failure.retrySafe) {
                    break;
                } else {
                    throw this.createRetryBudgetExhaustedError({
                        workerEndpoint: worker.endpoint,
                        failure,
                    }, retryAttempts);
                }
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error(`BGE-M3 worker request failed: ${String(lastError)}`);
    }

    private getPrimaryWorker(): BgeM3Worker {
        return this.workers.find((worker) => worker.endpoint === this.endpoint) || this.workers[0];
    }

    private async selectWorker(): Promise<BgeM3Worker> {
        await this.initializeWorkers();
        await this.revalidateRejectedWorkers();
        const healthyWorkers = this.workers.filter((worker) => worker.healthy);
        if (healthyWorkers.length === 0) {
            throw this.createNoHealthyWorkersError();
        }

        const selectedWorker = healthyWorkers.sort((left, right) => left.inFlight - right.inFlight)[0];
        selectedWorker.inFlight++;
        return selectedWorker;
    }

    private async initializeWorkers(): Promise<void> {
        if (this.workersInitializationPromise) {
            await this.workersInitializationPromise;
            return;
        }
        if (this.workersInitialized) {
            return;
        }

        this.workersInitializationPromise = this.initializeWorkersOnce().finally(() => {
            this.workersInitializationPromise = undefined;
        });
        await this.workersInitializationPromise;
    }

    private async initializeWorkersOnce(): Promise<void> {
        this.workersInitialized = true;
        for (const worker of this.workers) {
            try {
                const profile = await this.validateWorkerReadiness(worker);
                if (worker.endpoint === this.endpoint) {
                    this.primaryProfile = profile;
                } else if (this.primaryProfile) {
                    this.validateEquivalentProfile(profile, this.primaryProfile);
                } else {
                    throw new Error('BGE-M3 primary worker metadata unavailable; strict worker validation cannot prove equivalence');
                }
                worker.profile = profile;
                worker.healthy = true;
                worker.rejectedReason = undefined;
                worker.lastSuccessAt = new Date().toISOString();
                worker.recovering = false;
            } catch (error) {
                this.rejectWorker(worker, this.normalizeWorkerFailure(error, 'startup'));
            }
        }
    }

    private rejectWorker(worker: BgeM3Worker, failure: BgeM3WorkerFailure): void {
        worker.healthy = false;
        worker.rejectedReason = failure.message;
        worker.rejectedFailureReason = failure.reason;
        worker.rejectedRetrySafe = failure.retrySafe;
        worker.lastFailureAt = new Date().toISOString();
        worker.recoveryEligibleAt = Date.now() + this.getInitialRecoveryCooldownMs(failure);
        worker.lastFailureEvidence = failure.evidence;
        worker.rejectionCountsByCategory[failure.evidence?.category || failureReasonToCategory(failure.reason)]++;
        worker.recovering = false;
        console.warn(`[BGE-M3] Rejected worker ${worker.endpoint}: ${failure.reason} ${failure.message}`);
    }

    private getInitialRecoveryCooldownMs(failure: BgeM3WorkerFailure): number {
        if (failure.reason === 'embedding_error' && failure.message === 'fetch failed') {
            return 0;
        }
        return this.workerRecoveryCooldownMs;
    }

    private recordWorkerSuccess(worker: BgeM3Worker): void {
        worker.lastSuccessAt = new Date().toISOString();
        if (!worker.healthy || worker.rejectedReason) {
            console.log(`[BGE-M3] Worker ${worker.endpoint} recovered and returned to the embedding pool.`);
        }
        if (worker.lastFailureEvidence) {
            worker.lastRecoveredFailureEvidence = worker.lastFailureEvidence;
        }
        worker.healthy = true;
        worker.rejectedReason = undefined;
        worker.rejectedFailureReason = undefined;
        worker.rejectedRetrySafe = undefined;
        worker.recoveryEligibleAt = undefined;
        worker.recovering = false;
    }

    private async revalidateRejectedWorkers(): Promise<void> {
        const now = Date.now();
        const rejectedWorkers = this.workers.filter((worker) => (
            !worker.healthy &&
            !worker.recovering &&
            (worker.recoveryEligibleAt ?? 0) <= now
        ));

        for (const worker of rejectedWorkers) {
            worker.recovering = true;
            worker.recoveryAttempts++;
            worker.lastRecoveryAttemptAt = new Date().toISOString();
            try {
                const profile = await this.validateWorkerReadiness(worker);
                if (worker.endpoint === this.endpoint) {
                    this.primaryProfile = profile;
                } else if (!this.primaryProfile) {
                    throw new Error('BGE-M3 primary worker metadata unavailable; strict worker validation cannot prove equivalence');
                } else {
                    this.validateEquivalentProfile(profile, this.primaryProfile);
                }
                worker.profile = profile;
                this.recordWorkerSuccess(worker);
            } catch (error) {
                const failure = this.normalizeWorkerFailure(error, 'metadata');
                worker.recovering = false;
                worker.healthy = false;
                worker.rejectedReason = failure.message;
                worker.rejectedFailureReason = failure.reason;
                worker.rejectedRetrySafe = failure.retrySafe;
                worker.lastFailureAt = new Date().toISOString();
                worker.recoveryEligibleAt = Date.now() + this.workerRecoveryCooldownMs;
                worker.lastFailureEvidence = failure.evidence;
                worker.rejectionCountsByCategory[failure.evidence?.category || failureReasonToCategory(failure.reason)]++;
                console.warn(`[BGE-M3] Worker ${worker.endpoint} recovery failed: ${failure.reason} ${failure.message}`);
            }
        }
    }

    private async validateWorkerReadiness(worker: BgeM3Worker): Promise<BgeM3WorkerProfile> {
        try {
            await this.get(worker, '/health');
        } catch (error) {
            throw this.classifyFailure(error, 'health');
        }

        try {
            const rawProfile = await this.get(worker, '/metadata');
            const profile = this.parseWorkerProfile(rawProfile);
            this.validateWorkerProfile(profile);
            return profile;
        } catch (error) {
            throw this.classifyFailure(error, 'metadata');
        }
    }

    private normalizeWorkerFailure(error: unknown, fallbackStage: 'startup' | 'health' | 'metadata' | 'embedding'): BgeM3WorkerFailure {
        if (this.isWorkerFailure(error)) {
            return error;
        }
        return this.classifyFailure(error, fallbackStage);
    }

    private isWorkerFailure(error: unknown): error is BgeM3WorkerFailure {
        return Boolean(
            error &&
            typeof error === 'object' &&
            'reason' in error &&
            'retrySafe' in error &&
            'message' in error &&
            'error' in error
        );
    }

    private createNoHealthyWorkersError(): Error {
        const workerContext = this.workers.map((worker) => (
            `${worker.endpoint}[state=${worker.recovering ? 'recovering' : worker.healthy ? 'accepted' : 'rejected'}, ` +
            `reason=${worker.rejectedFailureReason || 'none'}, retriesSafe=${worker.rejectedRetrySafe ?? 'unknown'}, ` +
            `recoveryAttempts=${worker.recoveryAttempts}]`
        )).join('; ');
        return new Error(`No healthy BGE-M3 workers available after recovery validation. Workers: ${workerContext || 'none'}`);
    }

    private createRetryBudgetExhaustedError(
        failureContext: BgeM3WorkerFailureContext,
        retryAttempts: number,
        selectionError?: unknown,
    ): Error {
        const suffix = selectionError instanceof Error
            ? ` Next worker selection failed: ${selectionError.message}`
            : '';
        return new Error(
            `BGE-M3 worker retry budget exhausted after ${retryAttempts} retry attempt(s). ` +
            `Last failure: ${failureContext.failure.reason} at ${failureContext.workerEndpoint}: ${failureContext.failure.message}.` +
            suffix,
        );
    }

    private classifyFailure(error: unknown, stage: 'startup' | 'health' | 'metadata' | 'embedding'): BgeM3WorkerFailure {
        const normalized = error instanceof Error ? error : new Error(String(error));
        const message = normalized.message || String(error);
        const lowerMessage = message.toLowerCase();
        let reason: EmbeddingWorkerFailureReason;
        let retrySafe = true;

        if (normalized.name === 'AbortError' || lowerMessage.includes('abort') || lowerMessage.includes('cancel')) {
            reason = 'cancellation';
            retrySafe = false;
        } else if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
            reason = 'embedding_timeout';
        } else if (stage === 'health' || lowerMessage.includes('/health') || lowerMessage.includes('health')) {
            reason = 'health';
        } else if (stage === 'metadata' || lowerMessage.includes('metadata') || lowerMessage.includes('model mismatch') || lowerMessage.includes('missing') || lowerMessage.includes('dimension mismatch')) {
            reason = 'metadata';
            retrySafe = false;
        } else if (stage === 'startup') {
            reason = 'startup';
        } else if (stage === 'embedding') {
            reason = 'embedding_error';
        } else {
            reason = 'unknown';
        }

        return {
            reason,
            retrySafe,
            message,
            error: normalized,
            evidence: getFailureEvidence(normalized, reason, retrySafe),
        };
    }

    private createRequestShape(
        requestId: string,
        path: string,
        body: Record<string, unknown>,
        bodyJson: string,
        requestContext?: BgeM3EmbeddingRequestContext,
    ): EmbeddingFailureRequestShape {
        const inputs = Array.isArray(body.inputs) ? body.inputs : undefined;
        const input = typeof body.input === 'string' ? body.input : undefined;
        const texts = inputs
            ? inputs.filter((item): item is string => typeof item === 'string')
            : input !== undefined ? [input] : [];
        const contentCharCount = requestContext?.contentCharCount ??
            texts.reduce((sum, text) => sum + text.length, 0);
        const estimatedTokens = requestContext?.estimatedTokens ??
            Math.ceil(contentCharCount / 4);
        return {
            requestId,
            path,
            logicalBatchId: requestContext?.logicalBatchId,
            chunkCount: requestContext?.chunkCount ?? texts.length,
            contentCharCount,
            estimatedTokens,
            mode: typeof body.mode === 'string' ? body.mode : this.mode,
            maxContentChars: requestContext?.maxContentChars,
            maxEstimatedTokens: requestContext?.maxEstimatedTokens,
            payloadBytes: Buffer.byteLength(bodyJson, 'utf8'),
        };
    }

    private attachFailureEvidence(
        error: unknown,
        workerEndpoint: string,
        request: EmbeddingFailureRequestShape,
        durationMs: number,
        retryAttempt: number,
    ): Error {
        const normalized = error instanceof Error ? error : new Error(String(error));
        const stage = request.path === '/metadata' ? 'metadata' : 'embedding';
        const classified = this.classifyFailure(normalized, stage);
        const evidence = createFailureEvidence({
            error: normalized,
            workerEndpoint,
            request,
            durationMs,
            retryAttempt,
            reason: classified.reason,
            retrySafe: classified.retrySafe,
        });
        Object.defineProperty(normalized, 'bgeM3FailureEvidence', {
            value: evidence,
            configurable: true,
        });
        return normalized;
    }

    private parseWorkerProfile(raw: unknown): BgeM3WorkerProfile {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('BGE-M3 worker returned invalid metadata');
        }

        const source = raw as Record<string, unknown>;
        const model = typeof source.model === 'string' ? source.model : '';
        const defaultMode = source.default_mode || source.defaultMode;
        const supportedModes = Array.isArray(source.supported_modes)
            ? source.supported_modes
            : source.supportedModes;
        const denseDimension = source.dense_dimension || source.denseDimension;
        const maxTokens = source.max_tokens || source.maxTokens;

        if (!model || (defaultMode !== 'full' && defaultMode !== 'dense') || !Array.isArray(supportedModes)) {
            throw new Error('BGE-M3 worker metadata is missing model, default mode, or supported modes');
        }

        return {
            model,
            modelRevision: typeof source.model_revision === 'string' ? source.model_revision : typeof source.modelRevision === 'string' ? source.modelRevision : undefined,
            defaultMode,
            supportedModes: supportedModes.filter((item): item is string => typeof item === 'string'),
            outputs: Array.isArray(source.outputs) ? source.outputs.filter((item): item is string => typeof item === 'string') : [],
            denseDimension: typeof denseDimension === 'number' ? denseDimension : undefined,
            precision: typeof source.precision === 'string' ? source.precision : undefined,
            maxTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
            preprocessingProfile: typeof source.preprocessing_profile === 'string' ? source.preprocessing_profile : typeof source.preprocessingProfile === 'string' ? source.preprocessingProfile : undefined,
        };
    }

    private validateWorkerProfile(profile: BgeM3WorkerProfile): void {
        if (profile.model !== this.model) {
            throw new Error(`BGE-M3 worker model mismatch: expected ${this.model}, got ${profile.model}`);
        }
        if (profile.defaultMode !== this.mode) {
            throw new Error(`BGE-M3 worker mode mismatch: expected ${this.mode}, got ${profile.defaultMode}`);
        }
        if (!profile.supportedModes.includes(this.mode)) {
            throw new Error(`BGE-M3 worker does not support mode ${this.mode}`);
        }
        if (this.mode === 'full') {
            for (const output of ['dense', 'sparse', 'colbert']) {
                if (!profile.outputs.includes(output)) {
                    throw new Error(`BGE-M3 worker is missing ${output} output`);
                }
            }
        }
        if (this.expectedProfile?.denseDimension && profile.denseDimension !== this.expectedProfile.denseDimension) {
            throw new Error(`BGE-M3 worker dimension mismatch: expected ${this.expectedProfile.denseDimension}, got ${profile.denseDimension || 'unknown'}`);
        }
        if (this.expectedProfile?.modelRevision && profile.modelRevision !== this.expectedProfile.modelRevision) {
            throw new Error(`BGE-M3 worker model revision mismatch: expected ${this.expectedProfile.modelRevision}, got ${profile.modelRevision || 'unknown'}`);
        }
        if (this.expectedProfile?.precision && profile.precision !== this.expectedProfile.precision) {
            throw new Error(`BGE-M3 worker precision mismatch: expected ${this.expectedProfile.precision}, got ${profile.precision || 'unknown'}`);
        }
        if (this.expectedProfile?.maxTokens && profile.maxTokens !== this.expectedProfile.maxTokens) {
            throw new Error(`BGE-M3 worker max token policy mismatch: expected ${this.expectedProfile.maxTokens}, got ${profile.maxTokens || 'unknown'}`);
        }
        if (this.expectedProfile?.preprocessingProfile && profile.preprocessingProfile !== this.expectedProfile.preprocessingProfile) {
            throw new Error(`BGE-M3 worker preprocessing profile mismatch: expected ${this.expectedProfile.preprocessingProfile}, got ${profile.preprocessingProfile || 'unknown'}`);
        }
    }

    private validateEquivalentProfile(profile: BgeM3WorkerProfile, primaryProfile: BgeM3WorkerProfile): void {
        if (profile.model !== primaryProfile.model) {
            throw new Error(`BGE-M3 worker model mismatch: expected ${primaryProfile.model}, got ${profile.model}`);
        }
        if (profile.defaultMode !== primaryProfile.defaultMode) {
            throw new Error(`BGE-M3 worker mode mismatch: expected ${primaryProfile.defaultMode}, got ${profile.defaultMode}`);
        }
        if (profile.denseDimension !== primaryProfile.denseDimension) {
            throw new Error(`BGE-M3 worker dimension mismatch: expected ${primaryProfile.denseDimension || 'unknown'}, got ${profile.denseDimension || 'unknown'}`);
        }
        for (const output of primaryProfile.outputs) {
            if (!profile.outputs.includes(output)) {
                throw new Error(`BGE-M3 worker is missing ${output} output`);
            }
        }
        if (profile.modelRevision !== primaryProfile.modelRevision) {
            throw new Error(`BGE-M3 worker model revision mismatch: expected ${primaryProfile.modelRevision || 'unknown'}, got ${profile.modelRevision || 'unknown'}`);
        }
        if (profile.precision !== primaryProfile.precision) {
            throw new Error(`BGE-M3 worker precision mismatch: expected ${primaryProfile.precision || 'unknown'}, got ${profile.precision || 'unknown'}`);
        }
        if (profile.maxTokens !== primaryProfile.maxTokens) {
            throw new Error(`BGE-M3 worker max token policy mismatch: expected ${primaryProfile.maxTokens || 'unknown'}, got ${profile.maxTokens || 'unknown'}`);
        }
        if (profile.preprocessingProfile !== primaryProfile.preprocessingProfile) {
            throw new Error(`BGE-M3 worker preprocessing profile mismatch: expected ${primaryProfile.preprocessingProfile || 'unknown'}, got ${profile.preprocessingProfile || 'unknown'}`);
        }
    }

    private parseResponse(raw: unknown): ParsedBgeM3Response {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('BGE-M3 sidecar returned invalid embedding response');
        }

        const source = raw as Record<string, unknown>;
        const dense = getProperty(source, ['dense', 'dense_vector', 'vector', 'embedding']);
        const sparse = getProperty(source, ['sparse', 'sparse_vector', 'lexical_weights']);
        const colbert = getProperty(source, ['colbert', 'colbert_vectors', 'token_vectors']);

        const parsed: ParsedBgeM3Response = {};
        if (isNumberArray(dense)) {
            parsed.dense = dense;
        }

        if (sparse && typeof sparse === 'object' && !Array.isArray(sparse)) {
            const sparseRecord = sparse as Record<string, unknown>;
            const indices = getProperty(sparseRecord, ['indices', 'idx']);
            const values = getProperty(sparseRecord, ['values', 'weights']);
            if (isNumberArray(indices) && isNumberArray(values) && indices.length === values.length) {
                parsed.sparse = { indices, values };
            }
        }

        if (isNumberMatrix(colbert)) {
            parsed.colbert = colbert;
        }

        return parsed;
    }

    private toMultiVector(parsed: ParsedBgeM3Response): MultiVectorEmbedding {
        if (!parsed.dense) {
            throw new Error('BGE-M3 response is missing dense vector data');
        }

        if (this.mode === 'full' && (!parsed.sparse || !parsed.colbert)) {
            throw new Error('BGE-M3 full mode requires dense, sparse, and ColBERT vectors');
        }

        this.dimension = parsed.dense.length;
        const result: MultiVectorEmbedding = {
            dense: {
                vector: parsed.dense,
                dimension: parsed.dense.length,
            },
        };

        if (parsed.sparse) {
            result.sparse = parsed.sparse;
        }

        if (parsed.colbert) {
            const firstVector = parsed.colbert[0];
            result.colbert = {
                vectors: parsed.colbert,
                dimension: firstVector ? firstVector.length : 0,
                tokenCount: parsed.colbert.length,
            };
        }

        return result;
    }
}
