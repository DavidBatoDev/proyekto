import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../../../common/decorators/public.decorator';
import { CronSecretGuard } from '../../../../common/guards/cron-secret.guard';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import { TimeGuestGuard } from '../guards/time-guest.guard';
import { TimeCronService, type TimeCronResult } from '../time-cron.service';

/**
 * Cloud Scheduler, hourly (no user session). Auth is the shared cron secret (`x-cron-secret`); @Public skips the
 * Supabase JWT guard and the guest guard, matching POST /api/invoices/cron/run. The run is budgeted under the
 * global request timeout (D52) and answers `truncated: true` when the next run must continue.
 */
@UseGuards(SupabaseAuthGuard, TimeGuestGuard)
@Controller('time/cron')
export class TimeCronController {
  constructor(private readonly cron: TimeCronService) {}

  @Post('run')
  @Public()
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  run(): Promise<TimeCronResult> {
    return this.cron.run();
  }
}
