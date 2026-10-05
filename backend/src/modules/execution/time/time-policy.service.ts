/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P06 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import type { EntitlementRef } from '../../shared/entitlements/entitlement-keys';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import type {
  TeamTimePolicyInput,
  WorkspaceTimePolicyInput,
} from './dto/policies.dto';
import { TimeCacheService } from './time-cache';
import type {
  ContextKind,
  ResolvedTimePolicy,
  SheetScopeRef,
  SheetScopeResult,
  TeamPolicyView,
  WorkspacePolicyView,
} from './time.types';

@Injectable()
export class TimePolicyService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
    private readonly cache: TimeCacheService,
  ) {}

  /** rpc time_resolve_policy + member caps (team scope with memberUserId: TMR in force on the local date)
   *  + client_hours_detail_level (engagement scope: settingsInForceOn). */
  resolve(
    scope: SheetScopeRef,
    policyWorkspaceId: string | null,
    at: Date,
    o?: { memberUserId?: string; teamId?: string; projectId?: string },
  ): Promise<ResolvedTimePolicy> {
    throw new NotImplementedException('P06');
  }

  sheetScopeFor(
    kind: ContextKind,
    ref: string | null,
    projectId: string,
  ): Promise<SheetScopeResult | null> {
    throw new NotImplementedException('P06');
  }

  ensureWorkspacePolicy(
    workspaceId: string,
    tzHint?: string | null,
    memberId?: string | null,
  ): Promise<string | null> {
    throw new NotImplementedException('P06');
  }

  /** can_manage_workspace else 404 */
  getWorkspacePolicy(
    callerId: string,
    workspaceId: string,
    tzHint?: string,
  ): Promise<WorkspacePolicyView> {
    throw new NotImplementedException('P06');
  }

  putWorkspacePolicy(
    callerId: string,
    workspaceId: string,
    input: WorkspaceTimePolicyInput,
  ): Promise<WorkspacePolicyView> {
    throw new NotImplementedException('P06');
  }

  /** isTeamManager else 404 */
  getTeamPolicy(callerId: string, teamId: string): Promise<TeamPolicyView> {
    throw new NotImplementedException('P06');
  }

  /** owner for approval/money fields; time_team_rules */
  putTeamPolicy(
    callerId: string,
    teamId: string,
    input: TeamTimePolicyInput,
  ): Promise<TeamPolicyView> {
    throw new NotImplementedException('P06');
  }

  /** owner; ungated; rpc time_policy_delete */
  deleteTeamPolicy(callerId: string, teamId: string): Promise<void> {
    throw new NotImplementedException('P06');
  }

  /** TeamsService write-through (D28). Bumps the logging-for epoch. */
  setTeamRetroactiveDays(
    teamId: string,
    days: number | null,
    actorId: string,
  ): Promise<void> {
    throw new NotImplementedException('P06');
  }

  /** policy row tz, else 'UTC'; never materialises */
  workspaceTimezone(workspaceId: string | null): Promise<string> {
    throw new NotImplementedException('P06');
  }

  /** resolve(team scope via sheetScopeFor).timezone */
  teamTimezone(teamId: string): Promise<string> {
    throw new NotImplementedException('P06');
  }

  /** D26: team.workspace_id ?? entitlements.resolveScopeForTeam(team.id). Never null. */
  planRefForTeam(team: {
    id: string;
    workspace_id: string | null;
  }): Promise<EntitlementRef> {
    throw new NotImplementedException('P06');
  }
}
