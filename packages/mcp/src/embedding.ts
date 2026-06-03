import { OpenAIEmbedding, VoyageAIEmbedding, GeminiEmbedding, OllamaEmbedding, BgeM3Embedding } from "@zilliz/claude-context-core";
import { ContextMcpConfig } from "./config.js";

type SupportedEmbedding = OpenAIEmbedding | VoyageAIEmbedding | GeminiEmbedding | OllamaEmbedding | BgeM3Embedding;

// Helper function to create embedding instance based on provider
export function createEmbeddingInstance(config: ContextMcpConfig): SupportedEmbedding {
    console.log(`[EMBEDDING] Creating ${config.embeddingProvider} embedding instance...`);

    switch (config.embeddingProvider) {
        case 'OpenAI':
            if (!config.openaiApiKey) {
                console.error(`[EMBEDDING] ❌ OpenAI API key is required but not provided`);
                throw new Error('OPENAI_API_KEY is required for OpenAI embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring OpenAI with model: ${config.embeddingModel}`);
            const openaiEmbedding = new OpenAIEmbedding({
                apiKey: config.openaiApiKey,
                model: config.embeddingModel,
                ...(config.openaiBaseUrl && { baseURL: config.openaiBaseUrl })
            });
            console.log(`[EMBEDDING] ✅ OpenAI embedding instance created successfully`);
            return openaiEmbedding;

        case 'VoyageAI':
            if (!config.voyageaiApiKey) {
                console.error(`[EMBEDDING] ❌ VoyageAI API key is required but not provided`);
                throw new Error('VOYAGEAI_API_KEY is required for VoyageAI embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring VoyageAI with model: ${config.embeddingModel}`);
            const voyageEmbedding = new VoyageAIEmbedding({
                apiKey: config.voyageaiApiKey,
                model: config.embeddingModel
            });
            console.log(`[EMBEDDING] ✅ VoyageAI embedding instance created successfully`);
            return voyageEmbedding;

        case 'Gemini':
            if (!config.geminiApiKey) {
                console.error(`[EMBEDDING] ❌ Gemini API key is required but not provided`);
                throw new Error('GEMINI_API_KEY is required for Gemini embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring Gemini with model: ${config.embeddingModel}`);
            const geminiEmbedding = new GeminiEmbedding({
                apiKey: config.geminiApiKey,
                model: config.embeddingModel,
                ...(config.geminiBaseUrl && { baseURL: config.geminiBaseUrl })
            });
            console.log(`[EMBEDDING] ✅ Gemini embedding instance created successfully`);
            return geminiEmbedding;

        case 'Ollama':
            const ollamaHost = config.ollamaHost || 'http://127.0.0.1:11434';
            console.log(`[EMBEDDING] 🔧 Configuring Ollama with model: ${config.embeddingModel}, host: ${ollamaHost}${config.ollamaDimension ? `, dimension: ${config.ollamaDimension}` : ''}`);
            const ollamaEmbedding = new OllamaEmbedding({
                model: config.embeddingModel,
                host: ollamaHost,
                ...(config.ollamaDimension && { dimension: config.ollamaDimension })
            });
            console.log(`[EMBEDDING] ✅ Ollama embedding instance created successfully`);
            return ollamaEmbedding;

        case 'BGE_M3':
            if (!config.bgeM3Endpoint) {
                console.error(`[EMBEDDING] ❌ BGE_M3_ENDPOINT is required but not provided`);
                throw new Error('BGE_M3_ENDPOINT is required for BGE-M3 embedding provider');
            }
            console.log(`[EMBEDDING] 🔧 Configuring BGE-M3 with model: ${config.embeddingModel}, endpoint: ${config.bgeM3Endpoint}, mode: ${config.bgeM3Mode}`);
            const bgeM3Embedding = new BgeM3Embedding({
                endpoint: config.bgeM3Endpoint,
                model: config.embeddingModel,
                mode: config.bgeM3Mode,
                dimension: config.ollamaDimension
            });
            console.log(`[EMBEDDING] ✅ BGE-M3 embedding instance created successfully (${bgeM3Embedding.getRetrievalMode()})`);
            return bgeM3Embedding;

        default:
            console.error(`[EMBEDDING] ❌ Unsupported embedding provider: ${config.embeddingProvider}`);
            throw new Error(`Unsupported embedding provider: ${config.embeddingProvider}`);
    }
}

export function logEmbeddingProviderInfo(config: ContextMcpConfig, embedding: SupportedEmbedding): void {
    console.log(`[EMBEDDING] ✅ Successfully initialized ${config.embeddingProvider} embedding provider`);
    console.log(`[EMBEDDING] Provider details - Model: ${config.embeddingModel}, Dimension: ${embedding.getDimension()}`);

    // Log provider-specific configuration details
    switch (config.embeddingProvider) {
        case 'OpenAI':
            console.log(`[EMBEDDING] OpenAI configuration - API Key: ${config.openaiApiKey ? '✅ Provided' : '❌ Missing'}, Base URL: ${config.openaiBaseUrl || 'Default'}`);
            break;
        case 'VoyageAI':
            console.log(`[EMBEDDING] VoyageAI configuration - API Key: ${config.voyageaiApiKey ? '✅ Provided' : '❌ Missing'}`);
            break;
        case 'Gemini':
            console.log(`[EMBEDDING] Gemini configuration - API Key: ${config.geminiApiKey ? '✅ Provided' : '❌ Missing'}, Base URL: ${config.geminiBaseUrl || 'Default'}`);
            break;
        case 'Ollama':
            console.log(`[EMBEDDING] Ollama configuration - Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}, Model: ${config.embeddingModel}${config.ollamaDimension ? `, Dimension: ${config.ollamaDimension}` : ''}`);
            break;
        case 'BGE_M3':
            console.log(`[EMBEDDING] BGE-M3 configuration - Endpoint: ${config.bgeM3Endpoint}, Mode: ${config.bgeM3Mode === 'full' ? 'full dense+sparse+ColBERT' : 'dense-only'}, Model: ${config.embeddingModel}`);
            break;
    }
}
