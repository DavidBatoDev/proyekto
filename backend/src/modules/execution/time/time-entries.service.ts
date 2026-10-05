/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P10 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type {
  CreateEntryInput,
  StartEntryInput,
  StopEntryOptions,
  UpdateEntryInput,
} from './dto/entries.dto';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import type {
  CapContext,
  CommentRow,
  EntryWithWarnings,
  LoggingForRequest,
  MySummary,
  Paged,
  SegmentRow,
  TimeEntryView,
  UserTimePreferences,
  WorkItemsResult,
} from './time.types';

@Injectable()
export class TimeEntriesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly loggingContext: LoggingContextService,
    private readonly policy: TimePolicyService,
    private readonly rates: TimeRatesService,
    private readonly authority: TimeAuthorityService,
    private readonly notifications: TimeNotificationsService,
  ) {}

  start(
    userId: string,
    input: StartEntryInput,
    o?: { purpose?: 'timer' | 'alias'; native?: boolean },
  ): Promise<EntryWithWarnings> {
    throw new NotImplementedException('P10');
  }

  createManual(
    userId: string,
    input: CreateEntryInput,
    o?: { purpose?: 'manual' | 'alias'; native?: boolean },
  ): Promise<EntryWithWarnings> {
    throw new NotImplementedException('P10');
  }

  /** actorId null only with o.system. Folds an open pause (stoppedTimerPatch semantics), closes the open segment.
   *  Never touches context or sheet (L60). Stopping a stopped entry → 409 TIMER_NOT_RUNNING. */
  stop(
    actorId: string | null,
    entryId: string,
    o?: StopEntryOptions & { alias?: { native: boolean } },
  ): Promise<TimeEntryView> {
    throw new NotImplementedException('P10');
  }

  pause(userId: string, entryId: string): Promise<TimeEntryView> {
    throw new NotImplementedException('P10');
  }

  resume(userId: string, entryId: string): Promise<TimeEntryView> {
    throw new NotImplementedException('P10');
  }

  update(
    userId: string,
    entryId: string,
    input: UpdateEntryInput,
    o?: { purpose?: 'edit' | 'alias'; native?: boolean },
  ): Promise<TimeEntryView> {
    throw new NotImplementedException('P10');
  }

  remove(
    userId: string,
    entryId: string,
    o?: { native?: boolean; alias?: boolean },
  ): Promise<void> {
    throw new NotImplementedException('P10');
  }

  getRunning(userId: string): Promise<TimeEntryView | null> {
    throw new NotImplementedException('P10');
  }

  get(viewerId: string, entryId: string): Promise<TimeEntryView> {
    throw new NotImplementedException('P10');
  }

  listSegments(viewerId: string, entryId: string): Promise<SegmentRow[]> {
    throw new NotImplementedException('P10');
  }

  listComments(viewerId: string, entryId: string): Promise<CommentRow[]> {
    throw new NotImplementedException('P10');
  }

  addComment(
    viewerId: string,
    entryId: string,
    body: string,
  ): Promise<CommentRow> {
    throw new NotImplementedException('P10');
  }

  listMine(
    userId: string,
    q: {
      from: string;
      to: string;
      project_id?: string;
      for?: LoggingForRequest | null;
      page: number;
      limit: number;
    },
  ): Promise<Paged<TimeEntryView>> {
    throw new NotImplementedException('P10');
  }

  mySummary(
    userId: string,
    q: { from: string; to: string },
  ): Promise<MySummary> {
    throw new NotImplementedException('P10');
  }

  /** access.roadmap else 404 */
  workItems(userId: string, projectId: string): Promise<WorkItemsResult> {
    throw new NotImplementedException('P10');
  }

  getPreferences(userId: string): Promise<UserTimePreferences | null> {
    throw new NotImplementedException('P10');
  }

  setPreferences(
    userId: string,
    input: { timezone: string; week_start?: number | null },
  ): Promise<UserTimePreferences> {
    throw new NotImplementedException('P10');
  }

  /** insert only, never overwrites */
  seedPreferences(userId: string, tz: string): Promise<void> {
    throw new NotImplementedException('P10');
  }

  /** rpc time_stop_running_entries */
  stopRunningForProject(projectId: string): Promise<number> {
    throw new NotImplementedException('P10');
  }

  capContext(
    rows: Array<
      Pick<
        TimeEntryView,
        | 'id'
        | 'member_user_id'
        | 'team_id'
        | 'project_id'
        | 'started_at'
        | 'context_kind'
      >
    >,
  ): Promise<Map<string, CapContext>> {
    throw new NotImplementedException('P10');
  }
}
