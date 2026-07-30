import { Controller, Get, UseGuards } from '@nestjs/common';
import { CACHE_POLICY_PRESETS } from '../cache/cache-policy';
import { SetCachePolicy } from '../decorators/cache-policy.decorator';
import { AdminGuard } from '../guards/admin.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { MailerService, type MailDiagnostics } from './mailer.service';

/**
 * Is outbound email actually working?
 *
 * Exists because the failure mode is silent: `issueInvoice` commits the invoice
 * and only then attempts delivery, so a dead refresh token looks like a
 * successful issue with an odd toast. This turns "the client says they never
 * got it" into one request.
 *
 * Admin-only and NO_STORE: the response names sender addresses and says which
 * credentials are present, which is not something to cache or expose broadly.
 * It never returns a credential value, and it never sends a message — it only
 * refreshes the OAuth token, so it is safe to poll.
 */
@Controller('health/mail')
@UseGuards(SupabaseAuthGuard, AdminGuard)
export class MailHealthController {
  constructor(private readonly mailer: MailerService) {}

  @Get()
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  check(): Promise<MailDiagnostics> {
    return this.mailer.diagnostics();
  }
}
