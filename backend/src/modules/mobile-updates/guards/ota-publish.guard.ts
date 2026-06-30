import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the OTA publish endpoints with a shared bearer secret (OTA_PUBLISH_TOKEN).
 * Used by CI to presign/register bundles. If the secret is unset, the guard
 * denies all requests (publishing stays closed until the secret is provisioned).
 */
@Injectable()
export class OtaPublishGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('OTA_PUBLISH_TOKEN');
    if (!expected) {
      throw new UnauthorizedException('OTA publishing is not configured.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['authorization'];
    const provided =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : '';

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid OTA publish token.');
    }

    return true;
  }
}
