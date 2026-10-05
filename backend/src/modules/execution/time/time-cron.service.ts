/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P11 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TimeEntriesService } from './time-entries.service';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimesheetsService } from './timesheets.service';

@Injectable()
export class TimeCronService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly entries: TimeEntriesService,
    private readonly timesheets: TimesheetsService,
    private readonly policy: TimePolicyService,
    private readonly notifications: TimeNotificationsService,
  ) {}

  /** Five idempotent jobs in order; each catches its own errors and reports a count. D52: batch cap 200 per
   *  job, 20 s soft budget for the run, `truncated: true` when it stopped early. */
  run(now?: Date): Promise<{
    auto_stopped: number;
    long_notified: number;
    auto_submitted: number;
    finished: number;
    reminders: number;
    errors: string[];
    truncated: boolean;
  }> {
    throw new NotImplementedException('P11');
  }
}
