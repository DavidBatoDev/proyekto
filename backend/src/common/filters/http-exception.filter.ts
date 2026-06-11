import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    // Structured fields the thrower attached to an HttpException body (e.g.
    // `validation_issues`, `code`) — preserved so consumers like the AI agent
    // can tell users WHY a commit failed, not just that it did.
    let extras: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;

        // Handle class-validator array of messages
        if (Array.isArray(resp.message)) {
          message = (resp.message as string[]).join('; ');
        }

        const { message: _message, statusCode: _statusCode, ...rest } = resp;
        extras = rest;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
    }

    response.status(status).json({
      error: {
        ...extras,
        message,
        status,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
