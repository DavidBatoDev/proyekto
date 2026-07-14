import { ConfigService } from '@nestjs/config';
import { CloudflareCachePurgeService } from './cloudflare-cache-purge.service';

type FetchMock = jest.MockedFunction<typeof fetch>;

function createService(env: Record<string, string>) {
  return new CloudflareCachePurgeService(new ConfigService(env));
}

function mockSuccessResponse(success: boolean) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ success }),
    text: jest.fn().mockResolvedValue(''),
  } as unknown as Response;
}

function mockErrorResponse(status: number, text: string) {
  return {
    ok: false,
    status,
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue(text),
  } as unknown as Response;
}

describe('CloudflareCachePurgeService', () => {
  let originalFetch: typeof fetch | undefined;
  let fetchMock: FetchMock;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn() as FetchMock;
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  it('deduplicates URLs and sends single purge request', async () => {
    fetchMock.mockResolvedValueOnce(mockSuccessResponse(true));
    const service = createService({
      CLOUDFLARE_PURGE_ENABLED: 'true',
      CLOUDFLARE_ZONE_ID: 'zone-1',
      CLOUDFLARE_PURGE_API_TOKEN: 'token-1',
      PUBLIC_API_URL: 'https://api.proyekto.tech',
    });

    await service.purgePaths([
      '/api/consultants',
      '/api/consultants',
      '/api/roadmap-templates',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer token-1',
      }),
    );
    expect(request?.body).toBe(
      JSON.stringify({
        files: [
          'https://api.proyekto.tech/api/consultants',
          'https://api.proyekto.tech/api/roadmap-templates',
        ],
      }),
    );
  });

  it('retries once when first purge attempt fails', async () => {
    fetchMock
      .mockResolvedValueOnce(mockErrorResponse(500, 'server error'))
      .mockResolvedValueOnce(mockSuccessResponse(true));
    const service = createService({
      CLOUDFLARE_PURGE_ENABLED: 'true',
      CLOUDFLARE_ZONE_ID: 'zone-1',
      CLOUDFLARE_PURGE_API_TOKEN: 'token-1',
    });

    await service.purgePaths(['/api/consultants']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips purge when disabled', async () => {
    const service = createService({
      CLOUDFLARE_PURGE_ENABLED: 'false',
      CLOUDFLARE_ZONE_ID: 'zone-1',
      CLOUDFLARE_PURGE_API_TOKEN: 'token-1',
    });

    await service.purgePaths(['/api/consultants']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open when fetch throws', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network still down'));
    const service = createService({
      CLOUDFLARE_PURGE_ENABLED: 'true',
      CLOUDFLARE_ZONE_ID: 'zone-1',
      CLOUDFLARE_PURGE_API_TOKEN: 'token-1',
    });

    await expect(service.purgePaths(['/api/consultants'])).resolves.toBe(
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
