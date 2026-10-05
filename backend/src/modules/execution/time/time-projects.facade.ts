/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P16 replaces the bodies; the public signatures are final (blueprint §2.8).
// The only door ProjectsService uses into the time module.
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TimeAuthorityService } from './time-authority.service';
import { TimeEntriesService } from './time-entries.service';
import { TimePolicyService } from './time-policy.service';
import type { ClientHoursLevel, TimesheetStatus } from './time.types';

@Injectable()
export class TimeProjectsFacade {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly entries: TimeEntriesService,
    private readonly authority: TimeAuthorityService,
    private readonly policy: TimePolicyService,
  ) {}

  stopRunningForProject(projectId: string): Promise<number> {
    throw new NotImplementedException('P16');
  }

  dashboardTime(
    userId: string,
    projectIds: string[],
    q: { from?: string; to?: string },
  ): Promise<{
    time: {
      total_logs: number;
      total_seconds: number;
      total_hours: number;
      status_counts: {
        pending: number;
        approved: number;
        paid: number;
        rejected: number;
      };
      sheet_status_counts: Record<TimesheetStatus | 'personal', number>;
      total_fees: number;
    };
    overtime: { over_limit_windows: number; overage_hours_total: number };
  }> {
    throw new NotImplementedException('P16');
  }

  clientHoursLevel(
    userId: string,
    projectId: string,
  ): Promise<ClientHoursLevel> {
    throw new NotImplementedException('P16');
  }

  maskedWorkerIds(projectId: string, viewerId: string): Promise<Set<string>> {
    throw new NotImplementedException('P16');
  }
}
