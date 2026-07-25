import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { Request, Response } from 'express';

/**
 * Drop the query string on the OAuth endpoints before it reaches the log sink.
 * `/oauth/authorize` carries `code_challenge` and `state`, and its error
 * redirects carry `code` — none of which belong in Cloud Logging.
 */
export function redactUrl(url: string): string {
  if (!url.startsWith('/oauth')) return url;
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?<redacted>`;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  constructor(private readonly slowThresholdMs: number) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Date.now() - start;
        const statusCode = response?.statusCode ?? 0;
        const route = `${request.method} ${redactUrl(request.originalUrl ?? request.url)}`;
        const message = `${route} -> ${statusCode} (${durationMs}ms)`;

        if (durationMs >= this.slowThresholdMs) {
          this.logger.warn(`Slow request: ${message}`);
          return;
        }

        this.logger.log(message);
      }),
    );
  }
}
