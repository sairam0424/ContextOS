import { pipeline, Pipeline } from '@xenova/transformers';

export interface EmbeddingProvider {
    name: string;
    generate(text: string): Promise<Float32Array>;
    dimension: number;
    warmup?(): Promise<void>;
}

export class TransformersProvider implements EmbeddingProvider {
    name = 'local';
    dimension = 384;
    private extractor: any = null;

    private async getOrLoadModel(): Promise<any> {
        if (!this.extractor) {
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        }
        return this.extractor;
    }

    async generate(text: string): Promise<Float32Array> {
        const extractor = await this.getOrLoadModel();
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return new Float32Array(output.data);
    }

    async warmup(): Promise<void> {
        try { await this.getOrLoadModel(); } catch { /* swallow - lazy load retry */ }
    }
}

export class GeminiProvider implements EmbeddingProvider {
    name = 'gemini';
    dimension = 768; // text-embedding-004 standard
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async generate(text: string): Promise<Float32Array> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
                signal: controller.signal,
                body: JSON.stringify({
                    content: { parts: [{ text }] }
                })
            });

            const data = await response.json();
            if (!data.embedding) {
                throw new Error(`Gemini Embedding Failed: ${JSON.stringify(data)}`);
            }
            return new Float32Array(data.embedding.values);
        } finally {
            clearTimeout(timeout);
        }
    }
}

export class OllamaProvider implements EmbeddingProvider {
    name = 'ollama';
    dimension = 768; // Based on nomic-embed-text
    private model: string;

    constructor(model: string = 'nomic-embed-text') {
        this.model = model;
    }

    async generate(text: string): Promise<Float32Array> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const response = await fetch('http://localhost:11434/api/embeddings', {
                method: 'POST',
                signal: controller.signal,
                body: JSON.stringify({
                    model: this.model,
                    prompt: text
                })
            });

            const data = await response.json();
            if (!data.embedding) {
                throw new Error(`Ollama Embedding Failed: ${JSON.stringify(data)}`);
            }
            return new Float32Array(data.embedding);
        } finally {
            clearTimeout(timeout);
        }
    }
}

export class EmbeddingService {
    private provider: EmbeddingProvider;

    constructor(apiKey?: string, ollamaModel?: string) {
        if (apiKey) {
            this.provider = new GeminiProvider(apiKey);
        } else if (ollamaModel || process.env.OLLAMA_MODEL) {
            this.provider = new OllamaProvider(ollamaModel || process.env.OLLAMA_MODEL);
        } else {
            this.provider = new TransformersProvider();
        }
    }

    get dimension(): number {
        return this.provider.dimension;
    }

    async getProviderName(): Promise<string> {
        return this.provider.name;
    }

    async generate(text: string): Promise<Float32Array> {
        return this.provider.generate(text);
    }

    async warmup(): Promise<void> {
        if (this.provider && 'warmup' in this.provider && typeof (this.provider as any).warmup === 'function') {
            await (this.provider as any).warmup();
        }
    }
}

let _sharedEmbeddingService: EmbeddingService | null = null;

export function getSharedEmbeddingService(): EmbeddingService {
    if (!_sharedEmbeddingService) {
        _sharedEmbeddingService = new EmbeddingService(
            process.env.GEMINI_API_KEY,
            process.env.OLLAMA_MODEL
        );
    }
    return _sharedEmbeddingService;
}
