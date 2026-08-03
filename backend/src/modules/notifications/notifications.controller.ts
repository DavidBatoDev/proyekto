import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CronSecretGuard } from '../../common/guards/cron-secret.guard';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import {
  UnsubscribeQueryDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-email.dto';
import { NotificationEmailWorkerService } from './email/notification-email-worker.service';
import { NotificationPreferencesService } from './email/notification-preferences.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  MarkNotificationReadDto,
  NotificationsQueryDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(SupabaseAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly emailWorker: NotificationEmailWorkerService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  // Declared before the parameterised routes below: Nest matches in
  // registration order, and a literal path must win over any future `:id`
  // sibling. (The invoices and contracts controllers document the same hazard.)
  //
  // Scheduler-triggered (no user session): send due notification email. Auth is
  // the shared cron secret; @Public skips the Supabase JWT guard for this route.
  @Post('cron/email-dispatch')
  @Public()
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  dispatchEmail() {
    return this.emailWorker.runDispatch();
  }

  /**
   * One-click unsubscribe (RFC 8058), reached from the `List-Unsubscribe`
   * header. The token is the whole authorization — there is no session, because
   * the point is that it works from an inbox.
   *
   * ALWAYS 200, even for an unknown token: a status code that varies would turn
   * this into a token oracle, and mail clients treat a non-2xx as a broken
   * unsubscribe and may stop offering the button.
   *
   * `@UseGuards(ThrottlerGuard)` is required — no APP_GUARD binds the throttler
   * globally, so `@Throttle` alone would be inert on an unauthenticated route.
   *
   * Note the deliberate absence of `@Body()`. Mail clients POST
   * `List-Unsubscribe=One-Click` as urlencoded form data, and the global
   * ValidationPipe runs `forbidNonWhitelisted` — binding the body to a DTO
   * would 400 every real unsubscribe click unless that exact field were
   * declared. Not reading the body at all sidesteps it: the token in the query
   * string is the entire input.
   */
  @Post('unsubscribe')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@Query() query: UnsubscribeQueryDto) {
    await this.preferences.unsubscribeByToken(query.token, query.scope);
    return { unsubscribed: true };
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.getForUser(user.id);
  }

  @Put('preferences')
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.updateForUser(user.id, dto);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationsQueryDto,
  ) {
    return this.notificationsService.listForUser(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: MarkNotificationReadDto,
  ) {
    return this.notificationsService.markAsRead(user.id, id, body);
  }

  @Delete(':id')
  async deleteOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.deleteNotification(user.id, id);
  }
}
