import { FIRST_READ_TIMEOUT_MS, supabaseFetch } from './supabase-fetch';

/**
 * Reproduces the 2026-10-01 failure: a read of a just-sent amendment hung
 * until the client timeout and failed, and the same read succeeded seconds
 * later with the database unchanged. Reads are now retried once; writes never.
 */
describe('supabaseFetch', () => {
  const ok = () => new Response('{"id":"x","revision":1}', { status: 200 });
  /** A request that never answers: it settles only when its signal aborts. */
  const hang = (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('The operation was aborted due to timeout')),
      );
    });
  const url =
    'https://dev.supabase.co/rest/v1/contracts?select=*&id=eq.6616188a';

  it('retries a read that hung past the timeout, and logs it without the query', async () => {
    const baseFetch = jest
      .fn()
      .mockImplementationOnce(hang)
      .mockResolvedValue(ok());
    const logger = { warn: jest.fn() };
    const fetcher = supabaseFetch(30, {
      baseFetch: baseFetch as never,
      logger,
    });

    const response = await fetcher(url, { method: 'GET' });

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = String(logger.warn.mock.calls[0][0]);
    expect(line).toMatch(
      /^Supabase GET \/rest\/v1\/contracts failed after \d+ms/,
    );
    expect(line).toContain('retrying once');
    expect(line).not.toContain('6616188a');
  });

  it('never repeats a write', async () => {
    const baseFetch = jest.fn().mockImplementation(hang);
    const fetcher = supabaseFetch(30, {
      baseFetch: baseFetch as never,
      logger: { warn: jest.fn() },
    });

    await expect(
      fetcher(url, { method: 'PATCH', body: '{}' }),
    ).rejects.toBeDefined();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after one retry', async () => {
    const baseFetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed'));
    const logger = { warn: jest.fn() };
    const fetcher = supabaseFetch(30, {
      baseFetch: baseFetch as never,
      logger,
    });

    await expect(fetcher(url)).rejects.toThrow('fetch failed');
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  describe('the attempt bounds', () => {
    /** Records the bound each attempt got, by when its signal fired. */
    function timedHang(bounds: number[]) {
      return (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const started = Date.now();
          init?.signal?.addEventListener('abort', () => {
            bounds.push(Date.now() - started);
            reject(new Error('The operation was aborted due to timeout'));
          });
        });
    }

    it('gives a read a short first attempt and the full bound on the retry', async () => {
      const bounds: number[] = [];
      const baseFetch = jest.fn().mockImplementation(timedHang(bounds));
      const fetcher = supabaseFetch(300, {
        baseFetch: baseFetch as never,
        logger: { warn: jest.fn() },
        firstReadTimeoutMs: 50,
      });
      await expect(fetcher(url)).rejects.toBeDefined();
      expect(baseFetch).toHaveBeenCalledTimes(2);
      expect(bounds[0]).toBeLessThan(200);
      expect(bounds[1]).toBeGreaterThanOrEqual(250);
    });

    it('keeps the full bound on a write', async () => {
      const bounds: number[] = [];
      const baseFetch = jest.fn().mockImplementation(timedHang(bounds));
      const fetcher = supabaseFetch(200, {
        baseFetch: baseFetch as never,
        logger: { warn: jest.fn() },
        firstReadTimeoutMs: 20,
      });
      await expect(
        fetcher(url, { method: 'POST', body: '{}' }),
      ).rejects.toBeDefined();
      expect(bounds).toHaveLength(1);
      expect(bounds[0]).toBeGreaterThanOrEqual(150);
    });

    it('keeps the default worst case well under the 25 s request budget', () => {
      const SUPABASE_FETCH_TIMEOUT_MS = 12000;
      const REQUEST_TIMEOUT_MS = 25000;
      expect(FIRST_READ_TIMEOUT_MS).toBe(6000);
      expect(
        FIRST_READ_TIMEOUT_MS + SUPABASE_FETCH_TIMEOUT_MS,
      ).toBeLessThanOrEqual(REQUEST_TIMEOUT_MS - 5000);
    });
  });

  it('does not retry when the caller aborted', async () => {
    const controller = new AbortController();
    const baseFetch = jest.fn().mockImplementation(hang);
    const fetcher = supabaseFetch(1000, {
      baseFetch: baseFetch as never,
      logger: { warn: jest.fn() },
    });

    const pending = fetcher(url, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
