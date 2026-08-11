import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Renders OAuth endpoint failures in the flat RFC 6749 shape.
 *
 * The global HttpExceptionFilter wraps everything in `{error:{message,status,…}}`
 * and @RawResponse() only affects SUCCESS responses (it is read by
 * ResponseInterceptor, which an exception bypasses entirely). A controller-scoped
 * filter takes precedence over the global one, so mounting this on the OAuth
 * controller is what keeps `{"error":"invalid_grant"}` on the wire.
 *
 * Also sets the RFC 6749 §5.1 cache headers — CachePolicyInterceptor is opt-in
 * and adds nothing by default.
 */
@Catch()
export class OAuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        res.status(exception.getStatus()).json(body);
        return;
      }
      res.status(exception.getStatus()).json({
        error: 'invalid_request',
        error_description:
          typeof body === 'string' ? body : exception.message || undefined,
      });
      return;
    }

    this.logger.error(
      `Unhandled OAuth error: ${
        exception instanceof Error ? exception.stack : String(exception)
      }`,
    );
    res.status(500).json({ error: 'server_error' });
  }
}
