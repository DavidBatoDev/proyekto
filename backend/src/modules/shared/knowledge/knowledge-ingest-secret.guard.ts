import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

/**
 * Guards the knowledge ingest cron endpoint, which has no user session. The
 * caller must send `x-cron-secret` matching `KNOWLEDGE_INGEST_SECRET`. Pair
 * with `@Public()` so the Supabase JWT guard is skipped for the same route.
 * (Mirror of CronSecretGuard, which hardcodes the MEETINGS secret key.)
 */
@Injectable()
export class KnowledgeIngestSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('KNOWLEDGE_INGEST_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Cron endpoint is not configured.');
    }
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = req.headers['x-cron-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !safeEqual(provided, secret)) {
      throw new UnauthorizedException('Invalid cron secret.');
    }
    return true;
  }
}

// Constant-time comparison that also tolerates unequal lengths.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
