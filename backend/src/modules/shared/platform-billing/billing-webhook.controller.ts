import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { CronSecretGuard } from '../../../common/guards/cron-secret.guard';
import { BillingReconcileService } from './billing-reconcile.service';
import { BillingWebhookService } from './billing-webhook.service';

/**
 * Both routes are session-less, so both are `@Public()` paired with their own
 * authentication: the provider's webhook signature, and the shared cron secret
 * for the reconcile run.
 *
 * `cron/reconcile` is declared first so the literal route can never be
 * shadowed by the parameterised `webhooks/:provider` one, whatever is added
 * later.
 */
@Controller('platform-billing')
export class BillingWebhookController {
  constructor(
    private readonly webhooks: BillingWebhookService,
    private readonly reconcile: BillingReconcileService,
  ) {}

  /**
   * Cloud Scheduler target. Reuses MEETINGS_CRON_SECRET, the shared cron
   * secret, exactly as the invoices and team-time cron endpoints do rather than
   * minting another one.
   */
  @Post('cron/reconcile')
  @Public()
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  runReconcile() {
    return this.reconcile.run();
  }

  /**
   * One endpoint per provider: POST /api/platform-billing/webhooks/stripe,
   * .../webhooks/polar, and so on. Each provider is configured with its own
   * URL and signing secret, so events from two providers never share a
   * verification path, and a workspace still on the old provider keeps
   * receiving events after new sales move to a new one.
   *
   * `@RawResponse()` matters: providers expect a bare acknowledgement, and the
   * global ResponseInterceptor would otherwise wrap it in `{ data: ... }`.
   *
   * The handler deliberately does NOT swallow errors. A failure returns 500 so
   * the provider's retry ladder engages, and the event row stays `failed` so
   * the reconcile sweep can pick it up too.
   */
  @Post('webhooks/:provider')
  @Public()
  @RawResponse()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const outcome = await this.webhooks.handle(
      provider,
      req.rawBody,
      req.headers,
    );
    return { received: true, outcome };
  }
}
