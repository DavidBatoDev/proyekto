/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P07 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { TimePolicyService } from './time-policy.service';
import type {
  ClientHoursLevel,
  EntryAuthRow,
  TimeEntryView,
  TimesheetRow,
} from './time.types';

@Injectable()
export class TimeAuthorityService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: TimePolicyService,
  ) {}
  // DI graph (acyclic): policy ← {rates, authority, loggingContext}; {loggingContext, rates, authority,
  // notifications} ← entries; {authority, rates, notifications} ← timesheets; {entries, timesheets} ← cron.

  /** rpc can_view_timesheet */
  canViewTimesheet(userId: string, sheetId: string): Promise<boolean> {
    throw new NotImplementedException('P07');
  }

  /** rpc can_decide_timesheet */
  canDecide(userId: string, sheetId: string): Promise<boolean> {
    throw new NotImplementedException('P07');
  }

  /** 404 TIMESHEET_NOT_FOUND */
  assertViewTimesheet(userId: string, sheetId: string): Promise<TimesheetRow> {
    throw new NotImplementedException('P07');
  }

  /** Personal: member only. Else can_view_timesheet on its sheet, OR (context_kind='team' AND isTeamManager(team_id))
   *  (D49). Sheetless non-personal (pre-M2 only): member, or team manager for team context. 404 TIME_NOT_FOUND. */
  assertViewEntry(userId: string, entryId: string): Promise<EntryAuthRow> {
    throw new NotImplementedException('P07');
  }

  /** Member of the entry, else 404 (not 403) — writes on someone else's entry. */
  assertOwnEntry(userId: string, entryId: string): Promise<EntryAuthRow> {
    throw new NotImplementedException('P07');
  }

  /** rpc time_timesheet_deciders */
  approversFor(sheetId: string): Promise<string[]> {
    throw new NotImplementedException('P07');
  }

  /** team-authority.ts (P04) */
  isTeamManager(teamId: string, userId: string): Promise<boolean> {
    throw new NotImplementedException('P07');
  }

  /** rpc can_manage_workspace */
  canManageWorkspace(workspaceId: string, userId: string): Promise<boolean> {
    throw new NotImplementedException('P07');
  }

  costVisible(viewerId: string, rows: EntryAuthRow[]): Promise<Set<string>> {
    throw new NotImplementedException('P07');
  }

  identityVisible(
    viewerId: string,
    rows: EntryAuthRow[],
  ): Promise<Set<string>> {
    throw new NotImplementedException('P07');
  }

  /** project ids where viewer has access.time (resolvePermissions). Own entries are always content-visible. */
  contentVisible(viewerId: string, projectIds: string[]): Promise<Set<string>> {
    throw new NotImplementedException('P07');
  }

  /** Base select for all ids, then identity/content/cost selects with .in('id', allowed) per class.
   *  Never fetches a hidden class. Preserves input order. withEmail: self and team-manager views only. */
  hydrate(
    viewerId: string,
    rows: EntryAuthRow[],
    o?: { withEmail?: boolean },
  ): Promise<TimeEntryView[]> {
    throw new NotImplementedException('P07');
  }

  /** least(invoice-independent client_hours_detail_level) over the caller's active client-engagement
   *  hirer seats linked to the project; legacy contracts and none → 'none'. */
  clientHoursLevel(
    userId: string,
    projectId: string,
  ): Promise<ClientHoursLevel> {
    throw new NotImplementedException('P07');
  }

  /** Workers of assignments on the project under an engagement where the viewer is not a provider-side party. */
  maskedWorkerIds(projectId: string, viewerId: string): Promise<Set<string>> {
    throw new NotImplementedException('P07');
  }
}
