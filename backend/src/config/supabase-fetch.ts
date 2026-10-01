import { Logger } from '@nestjs/common';

type LogSink = Pick<Logger, 'warn'>;

const IDEMPOTENT = new Set(['GET', 'HEAD']);

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

/** The REST path only: never the query string, which can carry filters on ids. */
function pathOf(input: RequestInfo | URL): string {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    return url.pathname;
  } catch {
    return '(unparsed url)';
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error
        ? `: ${cause.message}`
        : typeof cause === 'string' || typeof cause === 'number'
          ? `: ${cause}`
          : '';
    return `${error.name}: ${error.message}${causeText}`;
  }
  return String(error);
}

/**
 * The Supabase client's fetch: every request is bounded by `timeoutMs`, and
 * an idempotent read (GET/HEAD) that fails at the network level or hangs past
 * the bound is retried once on a fresh attempt.
 *
 * Why (2026-10-01): a counterparty's read of a just-sent amendment hung until
 * this timeout and failed, then the same read succeeded seconds later with
 * the database unchanged. A hung request on a reused keep-alive connection
 * looks exactly like that. Reads are safe to repeat; writes never are, so a
 * write is never retried. Every failure is logged with its method, REST path
 * and elapsed time, so the next one can be told apart from a logic error.
 *
 * A caller's own abort is never retried.
 *
 * Budget: a read's FIRST attempt gets a short bound (`firstReadTimeoutMs`,
 * ~6 s) and only the retry gets the full `timeoutMs`, so the worst case is
 * 6 s + 12 s = 18 s, well under the 25 s request budget
 * (REQUEST_TIMEOUT_MS). Two full-length attempts (24 s) left the interceptor
 * no room to answer. Writes keep the full bound on their single attempt.
 */
export const FIRST_READ_TIMEOUT_MS = 6000;

export function supabaseFetch(
  timeoutMs: number,
  options: {
    logger?: LogSink;
    baseFetch?: typeof fetch;
    firstReadTimeoutMs?: number;
  } = {},
): typeof fetch {
  const logger = options.logger ?? new Logger('SupabaseFetch');
  const baseFetch = options.baseFetch ?? fetch;
  const firstReadTimeoutMs = Math.min(
    options.firstReadTimeoutMs ?? FIRST_READ_TIMEOUT_MS,
    timeoutMs,
  );

  const attempt = (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    boundMs: number,
  ) => {
    const timeoutSignal = AbortSignal.timeout(boundMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return baseFetch(input, { ...init, signal });
  };

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = methodOf(input, init);
    const idempotent = IDEMPOTENT.has(method);
    const started = Date.now();
    try {
      return await attempt(
        input,
        init,
        idempotent ? firstReadTimeoutMs : timeoutMs,
      );
    } catch (error) {
      const elapsed = Date.now() - started;
      const callerAborted = Boolean(init?.signal?.aborted);
      const retry = idempotent && !callerAborted;
      logger.warn(
        `Supabase ${method} ${pathOf(input)} failed after ${elapsed}ms (${reasonOf(error)})${retry ? '; retrying once' : ''}`,
      );
      if (!retry) throw error;
      try {
        return await attempt(input, init, timeoutMs);
      } catch (second) {
        logger.warn(
          `Supabase ${method} ${pathOf(input)} failed again after ${Date.now() - started}ms (${reasonOf(second)})`,
        );
        throw second;
      }
    }
  };
}
