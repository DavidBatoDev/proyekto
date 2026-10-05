/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P11 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { TimeAuthorityService } from './time-authority.service';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import type {
  ApprovalRow,
  FreezePayload,
  FreezePreview,
  Paged,
  SheetScopeKind,
  TimeOverview,
  TimesheetAction,
  TimesheetDetail,
  TimesheetRow,
  TimesheetSummary,
} from './time.types';

@Injectable()
export class TimesheetsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly authority: TimeAuthorityService,
    private readonly policy: TimePolicyService,
    private readonly rates: TimeRatesService,
    private readonly notifications: TimeNotificationsService,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  get(viewerId: string, id: string): Promise<TimesheetDetail> {
    throw new NotImplementedException('P11');
  }

  listMine(
    userId: string,
    q: { from?: string; to?: string },
  ): Promise<TimesheetSummary[]> {
    throw new NotImplementedException('P11');
  }

  /** The only path to time_timesheet_transition. Builds p_freeze for submit/auto_submit/approve,
   *  maps errors, retries once on 40P01 and (system actor only) once on STALE_REVISION{reason:'entry_set'},
   *  then sends one notification per transition. expectedRevisions null only for a NULL actor. */
  act(
    actorId: string | null,
    action: TimesheetAction,
    ids: string[],
    expectedRevisions: number[] | null,
    o?: { note?: string; approveOvertime?: boolean },
  ): Promise<TimesheetRow[]> {
    throw new NotImplementedException('P11');
  }

  approveBulk(
    userId: string,
    input: {
      ids: string[];
      expected_revisions: number[];
      note?: string;
      approve_overtime?: boolean;
    },
  ): Promise<TimesheetRow[]> {
    throw new NotImplementedException('P11');
  }

  buildFreeze(
    sheetIds: string[],
    o: { approveOvertime: boolean; mode: 'approve' | 'submit' },
  ): Promise<{
    payload: FreezePayload;
    preview: Record<string, FreezePreview>;
  }> {
    throw new NotImplementedException('P11');
  }

  queue(
    userId: string,
    q: {
      status: 'submitted' | 'decided';
      since?: string;
      scope_kind?: SheetScopeKind;
      page: number;
      limit: number;
      currentWorkspaceId?: string | null;
    },
  ): Promise<Paged<ApprovalRow>> {
    throw new NotImplementedException('P11');
  }

  queueCount(userId: string): Promise<{ waiting: number }> {
    throw new NotImplementedException('P11');
  }

  /** guests → EMPTY_TIME_OVERVIEW */
  overview(user: AuthenticatedUser, tz?: string): Promise<TimeOverview> {
    throw new NotImplementedException('P11');
  }
}
