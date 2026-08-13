import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class QaFixtureSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled =
      String(
        this.config.get<string>('PRODUCTION_QA_ENABLED') ?? '',
      ).toLowerCase() === 'true';
    if (!enabled) throw new NotFoundException();

    const secret = this.config.get<string>('PRODUCTION_QA_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Production QA is not configured.');
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const raw = request.headers['x-qa-secret'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided || !safeEqual(provided, secret)) {
      throw new UnauthorizedException('Invalid production QA secret.');
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
