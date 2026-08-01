import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, concatMap, map } from 'rxjs/operators';
import { activityStorage } from '../activity/activity-context';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * Flushes the request's buffered activity rows as one multi-row insert.
 *
 * WHY THE STORE IS ESTABLISHED IN MIDDLEWARE, NOT HERE:
 * `next.handle()` returns a COLD Observable that Nest subscribes to only after
 * every intercept() has returned. So the intuitive
 *
 *     return activityStorage.run(store, () => next.handle())
 *
 * silently loses the context — the route handler executes on subscribe, which
 * is outside the run() callback. The store is therefore opened by an Express
 * middleware in main.ts, which is genuinely upstream of the handler, and this
 * interceptor only reads it. See activity-context.spec.ts, which regression-
 * locks that distinction.
 *
 * Registered LAST in main.ts so it sits innermost: the flush happens before
 * ResponseInterceptor wraps the envelope and inside RequestTimeoutInterceptor's
 * window.
 */
@Injectable()
export class ActivityFlushInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const store = activityStorage.getStore();
    if (!store) return next.handle();

    // `flush` never throws, so neither branch can turn a successful response
    // into an error or mask the original one.
    const flush = () => from(this.audit.flush(store));

    return next.handle().pipe(
      concatMap((value) => flush().pipe(map(() => value))),
      // A 4xx/5xx still flushes whatever was recorded before the throw — this
      // matters for partially-applied batches (e.g. addCommentToTasks).
      catchError((err: unknown) =>
        flush().pipe(concatMap(() => throwError(() => err))),
      ),
    );
  }
}
