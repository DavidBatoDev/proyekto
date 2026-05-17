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

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestTimeoutInterceptor.name);

  constructor(private readonly timeoutMs: number) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          this.logger.error(
            `Request timed out after ${this.timeoutMs}ms: ${request.method} ${request.originalUrl ?? request.url}`,
          );
          return throwError(
            () =>
              new RequestTimeoutException(
                `Request timed out after ${this.timeoutMs}ms`,
              ),
          );
        }

        return throwError(() => error);
      }),
    );
  }
}
