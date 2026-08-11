import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dims
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_INPUTS_PER_CALL = 100;
const MAX_INPUT_CHARS = 8_000;

interface EmbeddingsResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
}

/**
 * Thin OpenAI embeddings client for the knowledge pipeline. Disabled (returns
 * nulls) when OPENAI_API_KEY is absent so every caller has a text-only lane —
 * the same optionality contract as the title/metadata generators.
 */
@Injectable()
export class KnowledgeEmbeddingsService {
  private readonly logger = new Logger(KnowledgeEmbeddingsService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('OPENAI_API_KEY');
  }

  /** Embed texts in order; each result is a 1536-float vector or null when
   * embeddings are disabled. Throws on API failure so ingest callers convert
   * the batch into an outbox retry. */
  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) return texts.map(() => null);

    const results: (number[] | null)[] = new Array<number[] | null>(
      texts.length,
    ).fill(null);
    for (let offset = 0; offset < texts.length; offset += MAX_INPUTS_PER_CALL) {
      const batch = texts
        .slice(offset, offset + MAX_INPUTS_PER_CALL)
        .map((text) => (text ?? '').slice(0, MAX_INPUT_CHARS));
      const vectors = await this.callOpenAi(apiKey, batch);
      for (let i = 0; i < vectors.length; i += 1) {
        results[offset + i] = vectors[i];
      }
    }
    return results;
  }

  /** pgvector's text input format — pass through PostgREST unambiguously. */
  toVectorLiteral(embedding: number[]): string {
    return JSON.stringify(embedding);
  }

  private async callOpenAi(
    apiKey: string,
    inputs: string[],
  ): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `OpenAI embeddings failed (${response.status}): ${detail.slice(0, 300)}`,
        );
      }
      const payload = (await response.json()) as EmbeddingsResponse;
      const rows = payload.data ?? [];
      const vectors: number[][] = new Array<number[]>(inputs.length);
      for (const row of rows) {
        const index = row.index ?? -1;
        if (
          index >= 0 &&
          index < inputs.length &&
          Array.isArray(row.embedding)
        ) {
          vectors[index] = row.embedding;
        }
      }
      for (let i = 0; i < inputs.length; i += 1) {
        if (!vectors[i]) {
          throw new Error(`OpenAI embeddings response missing index ${i}`);
        }
      }
      return vectors;
    } finally {
      clearTimeout(timeout);
    }
  }
}
