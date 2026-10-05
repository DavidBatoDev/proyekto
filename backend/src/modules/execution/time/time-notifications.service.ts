/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P08 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type {
  CommentRow,
  EntryAuthRow,
  FlaggedReason,
  TimeEntryView,
  TimesheetRow,
} from './time.types';

export type TimeNotificationType =
  | 'timesheet_submitted'
  | 'timesheet_returned'
  | 'timesheet_approved'
  | 'timesheet_reopened'
  | 'timesheet_reopen_requested'
  | 'timesheet_reminder'
  | 'timer_running_long'
  | 'timer_auto_stopped'
  | 'time_payout_recorded'
  | 'time_log_comment_added';

/** Pure; exported for the no-money spec. Never puts a digit-bearing amount or a currency in message. */
export function buildTimeContent(
  type: TimeNotificationType,
  i: {
    sheet?: TimesheetRow;
    entryId?: string;
    reason?: FlaggedReason;
    payoutId?: string;
    entryCount?: number;
    actorName?: string | null;
    snippet?: string;
  },
): Record<string, unknown> {
  throw new NotImplementedException('P08');
}

@Injectable()
export class TimeNotificationsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly notifications: NotificationsService,
    private readonly workspaces: WorkspacesService,
  ) {}
  // D51: every method below except hasNotified never throws (catch + warn), is awaited by callers, and fans out
  // with Promise.all; a failed notification must never turn a committed transition, payout or comment into an error.

  sheetSubmitted(
    sheet: TimesheetRow,
    deciderIds: string[],
    actorId: string | null,
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  sheetDecided(
    sheet: TimesheetRow,
    action: 'approve' | 'return' | 'reopen' | 'withdraw',
    actorId: string | null,
    deciderIds: string[],
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  reopenRequested(
    sheet: TimesheetRow,
    deciderIds: string[],
    actorId: string,
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  reminder(sheet: TimesheetRow): Promise<void> {
    throw new NotImplementedException('P08');
  }

  timerRunningLong(
    entry: Pick<
      TimeEntryView,
      'id' | 'member_user_id' | 'context_kind' | 'team_id' | 'started_at'
    >,
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  timerAutoStopped(
    entry: Pick<
      TimeEntryView,
      'id' | 'member_user_id' | 'context_kind' | 'team_id'
    >,
    reason: FlaggedReason,
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  payoutRecorded(
    p: { id: string; member_user_id: string; team_id: string },
    entryCount: number,
    actorId: string,
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  /** recipients computed inside */
  commentAdded(
    entry: EntryAuthRow,
    comment: CommentRow,
    actorId: string,
  ): Promise<void> {
    throw new NotImplementedException('P08');
  }

  /** Cron idempotency: a notification of `type` for `userId` whose content->>key = value exists. */
  hasNotified(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): Promise<boolean> {
    throw new NotImplementedException('P08');
  }
}
