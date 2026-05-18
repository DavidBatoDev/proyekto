import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { EMPTY, Observable, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import {
  buildCacheControlHeader,
  type CachePolicyConfig,
} from '../cache/cache-policy';
import { CACHE_POLICY_METADATA_KEY } from '../decorators/cache-policy.decorator';

function normalizeEtag(value: string): string {
  return value.replace(/^W\//, '').trim();
}

function extractIfNoneMatchValues(
  headerValue: string | string[] | undefined,
): string[] {
  if (!headerValue) return [];
  const raw = Array.isArray(headerValue)
    ? headerValue.join(',')
    : headerValue;
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function buildWeakEtag(payload: unknown): string {
  let serialized = '';
  if (payload !== undefined) {
    try {
      serialized = JSON.stringify(payload) ?? String(payload);
    } catch {
      serialized = String(payload);
    }
  }
  const digest = createHash('sha1').update(serialized).digest('base64url');
  return `W/"${digest}"`;
}

export function ifNoneMatchMatchesEtag(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  const providedEtags = extractIfNoneMatchValues(ifNoneMatch);
  if (providedEtags.length === 0) return false;
  if (providedEtags.includes('*')) return true;

  const target = normalizeEtag(etag);
  return providedEtags.some((provided) => normalizeEtag(provided) === target);
}

@Injectable()
export class CachePolicyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = this.reflector.getAllAndOverride<CachePolicyConfig>(
      CACHE_POLICY_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    response.setHeader('Cache-Control', buildCacheControlHeader(policy));

    const shouldGenerateEtag =
      policy.etag &&
      policy.mode !== 'no-store' &&
      (request.method === 'GET' || request.method === 'HEAD');

    if (!shouldGenerateEtag) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap((payload) => {
        const etag = buildWeakEtag(payload);
        response.setHeader('ETag', etag);

        if (ifNoneMatchMatchesEtag(request.headers['if-none-match'], etag)) {
          response.status(304);
          response.end();
          return EMPTY;
        }

        return of(payload);
      }),
    );
  }
}
