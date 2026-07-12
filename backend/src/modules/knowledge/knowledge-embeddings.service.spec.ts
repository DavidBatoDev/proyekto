import { ConfigService } from '@nestjs/config';
import { KnowledgeEmbeddingsService } from './knowledge-embeddings.service';

const buildConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

describe('KnowledgeEmbeddingsService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is disabled and returns nulls without OPENAI_API_KEY', async () => {
    const service = new KnowledgeEmbeddingsService(buildConfig({}));
    expect(service.isEnabled()).toBe(false);
    await expect(service.embedBatch(['a', 'b'])).resolves.toEqual([null, null]);
  });

  it('batches more than 100 inputs across API calls, preserving order', async () => {
    const service = new KnowledgeEmbeddingsService(
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
    );
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string) as {
          input: string[];
        };
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: body.input.map((text, index) => ({
                index,
                embedding: [text.length, index],
              })),
            }),
        } as Response);
      });

    const inputs = Array.from({ length: 130 }, (_, i) => `text-${i}`);
    const vectors = await service.embedBatch(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(130);
    expect(vectors[0]).toEqual(['text-0'.length, 0]);
    // Second batch restarts API indexes at 0 but lands at the right offset.
    expect(vectors[100]).toEqual(['text-100'.length, 0]);
  });

  it('throws on a non-OK response so ingest can retry via the outbox', async () => {
    const service = new KnowledgeEmbeddingsService(
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
    } as Response);

    await expect(service.embedBatch(['a'])).rejects.toThrow('429');
  });

  it('serializes vectors in pgvector text format', () => {
    const service = new KnowledgeEmbeddingsService(buildConfig({}));
    expect(service.toVectorLiteral([0.1, -0.2])).toBe('[0.1,-0.2]');
  });
});
