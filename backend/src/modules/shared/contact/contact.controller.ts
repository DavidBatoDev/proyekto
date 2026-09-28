import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ContactService } from './contact.service';
import { SubmitContactMessageDto } from './dto/contact.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * The public contact form.
   *
   * `@UseGuards(ThrottlerGuard)` is load-bearing and must stay: no APP_GUARD
   * binds the throttler globally, so `@Throttle` on its own is inert and this
   * unauthenticated write would be unlimited. Same shape as the public
   * contract-signing and unsubscribe routes.
   *
   * Always 200, even when the mail transport is down. The sender has no other
   * channel and no account to retry from; failing the request would lose the
   * message and blame them for it. The service logs a delivery failure at
   * error level, which is the signal that reaches someone who can act.
   */
  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() dto: SubmitContactMessageDto,
  ): Promise<{ received: true }> {
    await this.contact.submit(dto);
    return { received: true };
  }
}
