import { Ollama } from 'ollama';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface OllamaEmbeddingConfig {
    model: string;
    host?: string;
    fetch?: any;
    keepAlive?: string | number;
    options?: Record<string, any>;
    dimension?: number; // Optional dimension parameter
    maxTokens?: number; // Optional max tokens parameter
}

export class EmbeddingContextLimitError extends Error {
    public readonly code = 'EMBEDDING_CONTEXT_LIMIT_EXCEEDED';
    public readonly provider = 'Ollama';

    constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = 'EmbeddingContextLimitError';
        if (options && 'cause' in options) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

export class OllamaEmbedding extends Embedding {
    private client: Ollama;
    private config: OllamaEmbeddingConfig;
    private dimension: number = 768; // Default dimension for many embedding models
    private dimensionDetected: boolean = false; // Track if dimension has been detected
    protected maxTokens: number = 2048; // Default context window for Ollama

    constructor(config: OllamaEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new Ollama({
            host: config.host || 'http://127.0.0.1:11434',
            fetch: config.fetch,
        });

        // Set dimension based on config or will be detected on first use
        if (config.dimension) {
            this.dimension = config.dimension;
            this.dimensionDetected = true;
        }

        // Set max tokens based on config or use default
        if (config.maxTokens) {
            this.maxTokens = config.maxTokens;
        } else {
            // Set default based on known models
            this.setDefaultMaxTokensForModel(config.model);
        }

        // If no dimension is provided, it will be detected in the first embed call
    }

    private setDefaultMaxTokensForModel(model: string): void {
        // Set different max tokens based on known models
        if (model?.includes('nomic-embed-text')) {
            this.maxTokens = 8192; // nomic-embed-text supports 8192 tokens
        } else if (model?.includes('snowflake-arctic-embed')) {
            this.maxTokens = 8192; // snowflake-arctic-embed supports 8192 tokens
        } else {
            this.maxTokens = 2048; // Default for most Ollama models
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        await this.ensureDimensionDetected();

        const embedding = await this.embedProcessedSingle(processedText);
        return {
            vector: embedding,
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);
        await this.ensureDimensionDetected();

        const embeddings = await this.embedProcessedBatch(processedTexts);
        return embeddings.map((embedding) => ({
            vector: embedding,
            dimension: this.dimension
        }));
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Ollama';
    }

    /**
     * Set model type and detect its dimension
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        // Reset dimension detection when model changes
        this.dimensionDetected = false;
        // Update max tokens for new model
        this.setDefaultMaxTokensForModel(model);
        if (!this.config.dimension) {
            this.dimension = await this.detectDimension();
            this.dimensionDetected = true;
            console.log(`[OllamaEmbedding] 📏 Detected Ollama embedding dimension: ${this.dimension} for model: ${this.config.model}`);
        } else {
            console.log('[OllamaEmbedding] Dimension already detected for model ' + this.config.model);
        }
    }

    /**
     * Set host URL
     * @param host Ollama host URL
     */
    setHost(host: string): void {
        this.config.host = host;
        this.client = new Ollama({
            host: host,
            fetch: this.config.fetch,
        });
    }

    /**
     * Set keep alive duration
     * @param keepAlive Keep alive duration
     */
    setKeepAlive(keepAlive: string | number): void {
        this.config.keepAlive = keepAlive;
    }

    /**
     * Set additional options
     * @param options Additional options for the model
     */
    setOptions(options: Record<string, any>): void {
        this.config.options = options;
    }

    /**
     * Set max tokens manually
     * @param maxTokens Maximum number of tokens
     */
    setMaxTokens(maxTokens: number): void {
        this.config.maxTokens = maxTokens;
        this.maxTokens = maxTokens;
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): Ollama {
        return this.client;
    }

    async detectDimension(testText: string = 'test'): Promise<number> {
        console.log('[OllamaEmbedding] Detecting embedding dimension...');

        try {
            const processedText = this.preprocessText(testText);
            const response = await this.client.embed(this.buildEmbedOptions(processedText));

            if (!response.embeddings || !response.embeddings[0]) {
                throw new Error('Ollama API returned invalid response');
            }

            const dimension = response.embeddings[0].length;
            console.log(`[OllamaEmbedding] Successfully detected embedding dimension: ${dimension}`);
            return dimension;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[OllamaEmbedding] Failed to detect dimension: ${errorMessage}`);
            throw new Error(`Failed to detect Ollama embedding dimension: ${errorMessage}`);
        }
    }

    private async ensureDimensionDetected(): Promise<void> {
        if (this.dimensionDetected || this.config.dimension) {
            return;
        }

        this.dimension = await this.detectDimension();
        this.dimensionDetected = true;
        console.log(`[OllamaEmbedding] 📏 Detected Ollama embedding dimension: ${this.dimension} for model: ${this.config.model}`);
    }

    private buildEmbedOptions(input: string | string[]): any {
        const embedOptions: any = {
            model: this.config.model,
            input,
            options: this.config.options,
        };

        if (this.config.keepAlive && this.config.keepAlive !== '') {
            embedOptions.keep_alive = this.config.keepAlive;
        }

        return embedOptions;
    }

    private async embedProcessedBatch(processedTexts: string[]): Promise<number[][]> {
        try {
            const response = await this.client.embed(this.buildEmbedOptions(processedTexts));
            if (!response.embeddings || !Array.isArray(response.embeddings)) {
                throw new Error('Ollama API returned invalid batch response');
            }
            if (response.embeddings.length !== processedTexts.length) {
                throw new Error(
                    `Ollama API returned ${response.embeddings.length} embeddings for ${processedTexts.length} inputs`
                );
            }
            return response.embeddings as number[][];
        } catch (error) {
            if (!this.isContextLengthError(error)) {
                throw error;
            }

            if (processedTexts.length === 1) {
                return [await this.embedProcessedSingle(processedTexts[0])];
            }

            const midpoint = Math.ceil(processedTexts.length / 2);
            console.warn(
                `[OllamaEmbedding] Batch of ${processedTexts.length} inputs exceeded context length. ` +
                `Retrying as ${midpoint} + ${processedTexts.length - midpoint}.`
            );

            const left = await this.embedProcessedBatch(processedTexts.slice(0, midpoint));
            const right = await this.embedProcessedBatch(processedTexts.slice(midpoint));
            return [...left, ...right];
        }
    }

    private async embedProcessedSingle(processedText: string, attempt: number = 0): Promise<number[]> {
        try {
            const response = await this.client.embed(this.buildEmbedOptions(processedText));
            if (!response.embeddings || !response.embeddings[0]) {
                throw new Error('Ollama API returned invalid response');
            }
            return response.embeddings[0] as number[];
        } catch (error) {
            if (!this.isContextLengthError(error)) {
                throw error;
            }

            const truncatedText = this.shrinkProcessedText(processedText);
            if (truncatedText === processedText || attempt >= 8) {
                throw new EmbeddingContextLimitError(
                    `Ollama refused a single embedding input after ${attempt + 1} context-length retries.`,
                    { cause: error }
                );
            }

            console.warn(
                `[OllamaEmbedding] Single input exceeded context length. ` +
                `Retrying with ${truncatedText.length} chars (attempt ${attempt + 1}).`
            );
            return this.embedProcessedSingle(truncatedText, attempt + 1);
        }
    }

    private shrinkProcessedText(processedText: string): string {
        if (processedText.length <= 1) {
            return processedText;
        }

        if (processedText.length <= 64) {
            return processedText.slice(0, processedText.length - 1);
        }

        return processedText.slice(0, Math.max(64, Math.floor(processedText.length / 2)));
    }

    private isContextLengthError(error: unknown): boolean {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const normalizedMessage = errorMessage.toLowerCase();

        return normalizedMessage.includes('context length')
            || normalizedMessage.includes('input length exceeds')
            || normalizedMessage.includes('prompt is too long');
    }
}
