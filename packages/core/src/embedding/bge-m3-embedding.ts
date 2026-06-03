import { Embedding, EmbeddingVector, MultiVectorEmbedding } from './base-embedding';

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
    profile?: BgeM3WorkerProfile;
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

export class BgeM3Embedding extends Embedding {
    private readonly endpoint: string;
    private readonly workers: BgeM3Worker[];
    private readonly model: string;
    private readonly mode: BgeM3Mode;
    private readonly fetchImpl: FetchLike;
    private readonly retryBudget: number;
    private readonly expectedProfile?: Partial<BgeM3WorkerProfile>;
    private workersInitialized = false;
    private primaryProfile?: BgeM3WorkerProfile;
    private dimension: number;
    protected maxTokens: number = 8192;

    constructor(config: BgeM3EmbeddingConfig) {
        super();
        this.endpoint = config.endpoint.replace(/\/+$/, '');
        const endpoints = [
            this.endpoint,
            ...(config.workerEndpoints || []),
        ].map((endpoint) => endpoint.replace(/\/+$/, ''));
        this.workers = [...new Set(endpoints)].map((endpoint) => ({
            endpoint,
            inFlight: 0,
            healthy: endpoint === this.endpoint,
        }));
        this.model = config.model || 'BAAI/bge-m3';
        this.mode = config.mode || 'full';
        this.fetchImpl = config.fetch || (globalThis.fetch as unknown as FetchLike);
        this.retryBudget = Math.max(0, Math.floor(config.retryBudget ?? 1));
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

    async embedMultiBatchWithWorkerPool(texts: string[]): Promise<MultiVectorEmbedding[]> {
        const processedTexts = this.preprocessTexts(texts);
        const response = await this.withWorkerRetry((worker) => this.post(worker, '/embed_batch', {
                inputs: processedTexts,
                model: this.model,
                mode: this.mode,
            }));

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

    getWorkerSnapshot(): Array<{ endpoint: string; healthy: boolean; inFlight: number; rejectedReason?: string }> {
        return this.workers.map((worker) => ({
            endpoint: worker.endpoint,
            healthy: worker.healthy,
            inFlight: worker.inFlight,
            rejectedReason: worker.rejectedReason,
        }));
    }

    getRetrievalMode(): string {
        return this.mode === 'full' ? 'BGE-M3 full' : 'BGE-M3 dense-only';
    }

    private async post(worker: BgeM3Worker, path: string, body: Record<string, unknown>): Promise<unknown> {
        try {
            const response = await this.fetchImpl(`${worker.endpoint}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            });

            if (!response.ok) {
                throw new Error(
                    `BGE-M3 sidecar request failed at ${worker.endpoint}: ${response.status} ${response.statusText}`,
                );
            }

            return response.json();
        } finally {
            worker.inFlight = Math.max(0, worker.inFlight - 1);
        }
    }

    private async get(worker: BgeM3Worker, path: string): Promise<unknown> {
        const response = await this.fetchImpl(`${worker.endpoint}${path}`, {
            method: 'GET',
            headers: {},
        });

        if (!response.ok) {
            throw new Error(
                `BGE-M3 sidecar metadata request failed at ${worker.endpoint}: ${response.status} ${response.statusText}`,
            );
        }

        return response.json();
    }

    private async withWorkerRetry(run: (worker: BgeM3Worker) => Promise<unknown>): Promise<unknown> {
        let lastError: unknown;
        const attempts = Math.max(1, this.retryBudget + 1);
        for (let attempt = 0; attempt < attempts; attempt++) {
            const worker = await this.selectWorker();
            try {
                return await run(worker);
            } catch (error) {
                lastError = error;
                worker.healthy = false;
                worker.rejectedReason = error instanceof Error ? error.message : String(error);
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
        const healthyWorkers = this.workers.filter((worker) => worker.healthy);
        if (healthyWorkers.length === 0) {
            const primary = this.getPrimaryWorker();
            primary.healthy = true;
            primary.rejectedReason = undefined;
            primary.inFlight++;
            return primary;
        }

        const selectedWorker = healthyWorkers.sort((left, right) => left.inFlight - right.inFlight)[0];
        selectedWorker.inFlight++;
        return selectedWorker;
    }

    private async initializeWorkers(): Promise<void> {
        if (this.workersInitialized) {
            return;
        }

        this.workersInitialized = true;
        for (const worker of this.workers) {
            try {
                await this.get(worker, '/health');
                const rawProfile = await this.get(worker, '/metadata');
                const profile = this.parseWorkerProfile(rawProfile);
                this.validateWorkerProfile(profile);
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
            } catch (error) {
                if (worker.endpoint === this.endpoint) {
                    worker.healthy = true;
                    worker.rejectedReason = error instanceof Error ? `metadata unavailable: ${error.message}` : 'metadata unavailable';
                } else {
                    worker.healthy = false;
                    worker.rejectedReason = error instanceof Error ? error.message : String(error);
                }
            }
        }
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
        if (profile.denseDimension && profile.denseDimension !== this.dimension) {
            throw new Error(`BGE-M3 worker dimension mismatch: expected ${this.dimension}, got ${profile.denseDimension}`);
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
