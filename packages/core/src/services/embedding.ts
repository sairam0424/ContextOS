import { pipeline, Pipeline } from '@xenova/transformers';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('embedding');

const FAILOVER_THRESHOLD = 3;

export interface EmbeddingProvider {
    name: string;
    generate(text: string): Promise<Float32Array>;
    generateBatch?(texts: string[]): Promise<Float32Array[]>;
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
        if (!this.apiKey) {
            throw new Error('Gemini API key is required but not configured');
        }
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
                throw new Error(`Gemini Embedding Failed: ${data?.error?.message ?? 'No embedding in response'}`);
            }
            return new Float32Array(data.embedding.values);
        } finally {
            clearTimeout(timeout);
        }
    }

    async generateBatch(texts: string[]): Promise<Float32Array[]> {
        if (!this.apiKey) throw new Error('Gemini API key required');
        const BATCH_SIZE = 100;
        const results: Float32Array[] = [];
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30_000);
            try {
                const response = await fetch(
                    'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
                        signal: controller.signal,
                        body: JSON.stringify({
                            requests: batch.map(text => ({ model: 'models/text-embedding-004', content: { parts: [{ text }] } })),
                        }),
                    }
                );
                const data = await response.json() as any;
                if (!data.embeddings) throw new Error(`Batch failed: ${data?.error?.message ?? 'No embedding in response'}`);
                for (const emb of data.embeddings) results.push(new Float32Array(emb.values));
            } finally {
                clearTimeout(timeout);
            }
        }
        return results;
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
                throw new Error(`Ollama Embedding Failed: ${data?.error ?? 'No embedding in response'}`);
            }
            return new Float32Array(data.embedding);
        } finally {
            clearTimeout(timeout);
        }
    }
}

export class EmbeddingService {
    private providerChain: ReadonlyArray<EmbeddingProvider>;
    private activeIndex: number = 0;
    private failureCounts: Map<string, number> = new Map();

    constructor(apiKey?: string, ollamaModel?: string) {
        const chain: EmbeddingProvider[] = [];

        // Build failover chain: Gemini → Ollama → Transformers
        if (apiKey) {
            chain.push(new GeminiProvider(apiKey));
        }
        const resolvedOllamaModel = ollamaModel || process.env.OLLAMA_MODEL;
        if (resolvedOllamaModel) {
            chain.push(new OllamaProvider(resolvedOllamaModel));
        }
        // Transformers is always the last-resort fallback (local, no external deps)
        chain.push(new TransformersProvider());

        this.providerChain = Object.freeze([...chain]);
    }

    private get activeProvider(): EmbeddingProvider {
        return this.providerChain[this.activeIndex];
    }

    get dimension(): number {
        return this.activeProvider.dimension;
    }

    async getProviderName(): Promise<string> {
        return this.activeProvider.name;
    }

    private recordSuccess(providerName: string): void {
        if (this.failureCounts.has(providerName)) {
            this.failureCounts = new Map(
                [...this.failureCounts].filter(([key]) => key !== providerName)
            );
        }
    }

    private recordFailure(providerName: string): number {
        const currentCount = this.failureCounts.get(providerName) ?? 0;
        const nextCount = currentCount + 1;
        this.failureCounts = new Map([...this.failureCounts, [providerName, nextCount]]);
        return nextCount;
    }

    private advanceToNextProvider(): boolean {
        if (this.activeIndex >= this.providerChain.length - 1) {
            return false;
        }
        this.activeIndex = this.activeIndex + 1;
        log.warn(
            { from: this.providerChain[this.activeIndex - 1].name, to: this.activeProvider.name },
            'Embedding provider failover triggered'
        );
        return true;
    }

    async generate(text: string): Promise<Float32Array> {
        let lastError: Error | undefined;

        for (let attempt = this.activeIndex; attempt < this.providerChain.length; attempt++) {
            const provider = this.providerChain[attempt];
            try {
                const result = await provider.generate(text);
                this.activeIndex = attempt;
                this.recordSuccess(provider.name);
                return result;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                const failures = this.recordFailure(provider.name);
                log.warn(
                    { provider: provider.name, failures, threshold: FAILOVER_THRESHOLD },
                    'Embedding provider failure recorded'
                );

                if (failures >= FAILOVER_THRESHOLD || attempt > this.activeIndex) {
                    // Either threshold reached or we're already in failover — try next provider
                    if (attempt === this.activeIndex) {
                        this.advanceToNextProvider();
                    }
                    continue;
                }

                // Under threshold and still on primary — throw immediately to let caller retry
                throw lastError;
            }
        }

        // All providers exhausted
        throw lastError ?? new Error('All embedding providers failed');
    }

    async generateBatch(texts: string[]): Promise<Float32Array[]> {
        let lastError: Error | undefined;

        for (let attempt = this.activeIndex; attempt < this.providerChain.length; attempt++) {
            const provider = this.providerChain[attempt];
            try {
                let result: Float32Array[];
                if (provider.generateBatch) {
                    result = await provider.generateBatch(texts);
                } else {
                    result = await Promise.all(texts.map(t => provider.generate(t)));
                }
                this.activeIndex = attempt;
                this.recordSuccess(provider.name);
                return result;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                const failures = this.recordFailure(provider.name);
                log.warn(
                    { provider: provider.name, failures, threshold: FAILOVER_THRESHOLD, batchSize: texts.length },
                    'Embedding batch provider failure recorded'
                );

                if (failures >= FAILOVER_THRESHOLD || attempt > this.activeIndex) {
                    if (attempt === this.activeIndex) {
                        this.advanceToNextProvider();
                    }
                    continue;
                }

                throw lastError;
            }
        }

        throw lastError ?? new Error('All embedding providers failed');
    }

    async warmup(): Promise<void> {
        const provider = this.activeProvider;
        if (provider.warmup) {
            await provider.warmup();
        }
    }
}

let _sharedEmbeddingService: EmbeddingService | null = null;

/** @deprecated Use container.resolve(TOKENS.Embedding) from createContextOS() instead. */
export function getSharedEmbeddingService(): EmbeddingService {
    if (!_sharedEmbeddingService) {
        _sharedEmbeddingService = new EmbeddingService(
            process.env.GEMINI_API_KEY,
            process.env.OLLAMA_MODEL
        );
    }
    return _sharedEmbeddingService;
}
