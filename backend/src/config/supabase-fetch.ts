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
 */
export function supabaseFetch(
  timeoutMs: number,
  options: { logger?: LogSink; baseFetch?: typeof fetch } = {},
): typeof fetch {
  const logger = options.logger ?? new Logger('SupabaseFetch');
  const baseFetch = options.baseFetch ?? fetch;

  const attempt = (input: RequestInfo | URL, init?: RequestInit) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return baseFetch(input, { ...init, signal });
  };

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = methodOf(input, init);
    const started = Date.now();
    try {
      return await attempt(input, init);
    } catch (error) {
      const elapsed = Date.now() - started;
      const callerAborted = Boolean(init?.signal?.aborted);
      const retry = IDEMPOTENT.has(method) && !callerAborted;
      logger.warn(
        `Supabase ${method} ${pathOf(input)} failed after ${elapsed}ms (${reasonOf(error)})${retry ? '; retrying once' : ''}`,
      );
      if (!retry) throw error;
      try {
        return await attempt(input, init);
      } catch (second) {
        logger.warn(
          `Supabase ${method} ${pathOf(input)} failed again after ${Date.now() - started}ms (${reasonOf(second)})`,
        );
        throw second;
      }
    }
  };
}
