/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P06 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { TimePolicyService } from './time-policy.service';
import type {
  ContextKind,
  FrozenRate,
  LoggingOption,
  MemberCaps,
  RateEstimate,
  RateType,
  WorkType,
} from './time.types';

@Injectable()
export class TimeRatesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: TimePolicyService,
  ) {}

  /** Write-time display estimate (L10). team: TMR in force today (work_type picks hourly vs training rate),
   *  0 without member_rates_enabled or time_team_rules; assignment: talent cost rate in force, client-only 0;
   *  workspace/personal: 0. Currency: rate row → teams.default_currency → projects.currency → 'USD'. */
  estimate(
    option: LoggingOption,
    memberId: string,
    projectId: string,
    workType: WorkType,
    at: Date,
  ): Promise<RateEstimate> {
    throw new NotImplementedException('P06');
  }

  /** Freeze-time re-resolution for local date d (CHANGE-4 step 1). Legacy entries (created_at < legacyCutoff)
   *  return their stored snapshot (D13). TMR fixed → rateType 'fixed', amountable false. */
  freezeRate(
    e: {
      context_kind: ContextKind;
      context_ref: string | null;
      team_id: string | null;
      engagement_assignment_id: string | null;
      member_user_id: string;
      project_id: string | null;
      work_type_snapshot: WorkType;
      created_at: string;
      rate_snapshot: number;
      rate_type_snapshot: RateType;
      currency_snapshot: string;
    },
    localDate: string,
    legacyCutoff: string | null,
  ): Promise<FrozenRate> {
    throw new NotImplementedException('P06');
  }

  /** team_member_rates row in force on d for (team, member, project ?? null) → caps. */
  memberCaps(
    teamId: string,
    memberId: string,
    projectId: string | null,
    localDate: string,
  ): Promise<MemberCaps | null> {
    throw new NotImplementedException('P06');
  }

  /** min(timesheet_events.created_at) WHERE event='legacy_import'; process-cached after the first non-null read. */
  legacyCutoff(): Promise<string | null> {
    throw new NotImplementedException('P06');
  }
}
