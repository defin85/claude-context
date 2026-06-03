import { Embedding, EmbeddingVector, MultiVectorEmbedding } from './base-embedding';

export type BgeM3Mode = 'full' | 'dense';

type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
}) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<unknown>;
}>;

export interface BgeM3EmbeddingConfig {
    endpoint: string;
    model?: string;
    mode?: BgeM3Mode;
    fetch?: FetchLike;
    dimension?: number;
    maxTokens?: number;
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
    private readonly model: string;
    private readonly mode: BgeM3Mode;
    private readonly fetchImpl: FetchLike;
    private dimension: number;
    protected maxTokens: number = 8192;

    constructor(config: BgeM3EmbeddingConfig) {
        super();
        this.endpoint = config.endpoint.replace(/\/+$/, '');
        this.model = config.model || 'BAAI/bge-m3';
        this.mode = config.mode || 'full';
        this.fetchImpl = config.fetch || (globalThis.fetch as unknown as FetchLike);
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
        const response = await this.post('/embed', {
            input: processedText,
            model: this.model,
            mode: this.mode,
        });
        return this.toMultiVector(this.parseResponse(response));
    }

    async embedMultiBatch(texts: string[]): Promise<MultiVectorEmbedding[]> {
        const processedTexts = this.preprocessTexts(texts);
        const response = await this.post('/embed_batch', {
            inputs: processedTexts,
            model: this.model,
            mode: this.mode,
        });

        if (!Array.isArray(response)) {
            throw new Error('BGE-M3 sidecar returned invalid batch response');
        }

        if (response.length !== processedTexts.length) {
            throw new Error(
                `BGE-M3 sidecar returned ${response.length} embeddings for ${processedTexts.length} inputs`,
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

    getRetrievalMode(): string {
        return this.mode === 'full' ? 'BGE-M3 full' : 'BGE-M3 dense-only';
    }

    private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
        const response = await this.fetchImpl(`${this.endpoint}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(
                `BGE-M3 sidecar request failed: ${response.status} ${response.statusText}`,
            );
        }

        return response.json();
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
