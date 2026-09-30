import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import type { Request } from 'express';
import { redactUrl } from './request-logging.interceptor';

/** Routes that wait on a model reading a document. */
export const LONG_RUNNING_PATHS: readonly RegExp[] = [
  /^\/api\/intake\/documents\/[^/]+\/(classify|extract|reread)$/,
  /^\/api\/contracts\/[^/]+\/compare\/[^/]+\/summary$/,
];
export const LONG_RUNNING_TIMEOUT_MS = 120_000;

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestTimeoutInterceptor.name);

  constructor(private readonly timeoutMs: number) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    // The MCP endpoint streams its own response via the SDK transport and can
    // hold the connection open longer than a normal REST call; a mid-stream
    // timeout here would try to send after headers are already flushed. It has
    // its own guard, so it opts out of the global request timeout.
    if (request.path === '/mcp') {
      return next.handle();
    }

    // Document AI (intake classify/extract, contract change summaries) waits on
    // a vision model reading a whole file; those routes get a longer budget
    // rather than failing at the default.
    const budget = LONG_RUNNING_PATHS.some((pattern) =>
      pattern.test(request.path),
    )
      ? Math.max(this.timeoutMs, LONG_RUNNING_TIMEOUT_MS)
      : this.timeoutMs;

    return next.handle().pipe(
      timeout(budget),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          this.logger.error(
            `Request timed out after ${budget}ms: ${request.method} ${redactUrl(request.originalUrl ?? request.url)}`,
          );
          return throwError(
            () =>
              new RequestTimeoutException(
                `Request timed out after ${budget}ms`,
              ),
          );
        }

        return throwError(() => error);
      }),
    );
  }
}
