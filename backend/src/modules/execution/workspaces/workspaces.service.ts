import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  MailerService,
  type SendMailResult,
} from '../../../common/mail/mailer.service';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { isEmailSuppressed } from '../../shared/notifications/email/email-suppression';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { buildWorkspaceInviteEmail } from './workspace-invite-email.template';
import { WORKSPACE_INVITES_PATH } from './workspace-invites-path';
import {
  CreateWorkspaceDto,
  InviteWorkspaceMemberDto,
  RespondWorkspaceInviteDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceMemberDto,
  WorkspaceMemberRole,
  WorkspacePlan,
} from './dto/workspaces.dto';

export interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The caller's own standing. Populated by listMyWorkspaces and getWorkspace;
   * undefined elsewhere. The web switcher and settings pages branch on it.
   */
  my_role?: WorkspaceMemberRole | null;
  member_count?: number;
  plan?: WorkspacePlan;
  /**
   * Seats in use. Always the live member count, never a stored counter, so it
   * cannot drift from workspace_members.
   */
  seats_used?: number;
  subscription?: WorkspaceSubscriptionRow | null;
}

export interface WorkspaceSubscriptionRow {
  workspace_id: string;
  plan: WorkspacePlan;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  seat_limit: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
}

export interface WorkspaceMemberProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  joined_at: string;
  user?: WorkspaceMemberProfile | null;
}

export interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  invited_by: string | null;
  invitee_id: string | null;
  invitee_email: string | null;
  role: WorkspaceMemberRole;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  message: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  workspace?: { id: string; name: string; avatar_url: string | null } | null;
  invited_by_profile?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
}

const WORKSPACE_MEMBER_SELECT =
  '*, user:profiles!workspace_members_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)';

const WORKSPACE_INVITE_SELECT = `
  *,
  workspace:workspaces!workspace_invites_workspace_id_fkey(id, name, avatar_url),
  invited_by_profile:profiles!workspace_invites_invited_by_fkey(id, display_name, avatar_url, email)
`;

/**
 * Supabase types a to-one embedded relation as an array. Same normalization the
 * projects and chat repositories carry.
 */
function firstEmbeddedRow<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type UpdateWorkspaceField = keyof UpdateWorkspaceDto;

/**
 * Editable by the workspace owner AND by workspace admins: the organization's
 * identity, which is what the settings page puts on screen.
 */
const WORKSPACE_SHARED_UPDATE_FIELDS = [
  'name',
  'description',
  'avatar_url',
] as const satisfies readonly UpdateWorkspaceField[];
// Consumed only by the type-level check below — which is the whole reason it
// exists. Referenced here so it does not read as dead code.
void WORKSPACE_SHARED_UPDATE_FIELDS;

/**
 * Owner only. Empty today, and that is the point: the workspace is the billing
 * boundary, so the first plan, seat-limit, or billing-identity field to land on
 * UpdateWorkspaceDto must be classified here rather than silently becoming
 * admin-editable. See the exhaustiveness check below.
 */
const WORKSPACE_OWNER_ONLY_UPDATE_FIELDS =
  [] as const satisfies readonly UpdateWorkspaceField[];

/**
 * Adding a field to UpdateWorkspaceDto without classifying it above is a compile
 * error, not a silent grant. This mirrors the guard TeamsService carries for its
 * billing fields; the failure mode being guarded against is an admin quietly
 * gaining a billing field months from now, which should surface as tsc output
 * rather than as an incident.
 */
type UnclassifiedUpdateWorkspaceField = Exclude<
  UpdateWorkspaceField,
  | (typeof WORKSPACE_SHARED_UPDATE_FIELDS)[number]
  // Indexing the empty owner-only tuple yields `never` today, which the lint
  // rule flags as a redundant union member. Keep the arm: it is what makes the
  // guard start working the moment the first billing field is classified there,
  // and the disable comment goes away with it.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  | (typeof WORKSPACE_OWNER_ONLY_UPDATE_FIELDS)[number]
>;
const _everyUpdateWorkspaceFieldIsClassified: UnclassifiedUpdateWorkspaceField extends never
  ? true
  : never = true;
void _everyUpdateWorkspaceFieldIsClassified;

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly notifications: NotificationsService,
    // MailModule is @Global(), so WorkspacesModule needs no import for these.
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  // ─── provisioning ────────────────────────────────────────────────────────

  /**
   * The server-side backstop behind the required "create your workspace" step:
   * idempotent, advisory-locked, and safe to race with the welcome deck's own
   * POST /workspaces. Guests are rejected by the RPC itself.
   */
  async provisionDefault(
    userId: string,
  ): Promise<{ id: string; name: string } | null> {
    const { data, error } = await this.supabase.rpc(
      'provision_default_workspace',
      { p_user_id: userId },
    );
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return row as { id: string; name: string };
  }

  /**
   * Which workspace a newly created team or project belongs in. The single
   * definition of that rule — teams, projects, and roadmap conversion all call
   * this rather than resolving a workspace themselves.
   *
   * Returns null only for guests, who own nothing until they convert.
   */
  async resolveWorkspaceForWrite(
    userId: string,
    explicitWorkspaceId?: string | null,
  ): Promise<string | null> {
    if (explicitWorkspaceId) {
      // Any role qualifies. Workspace membership is the seat pool, not an
      // authorization ladder: any member may create work in their own
      // organization, exactly as in Linear.
      const membership = await this.findMembership(explicitWorkspaceId, userId);
      if (!membership) {
        throw new ForbiddenException('You are not a member of that workspace');
      }
      return explicitWorkspaceId;
    }

    const fallback = await this.findDefaultWorkspaceId(userId);
    if (fallback) return fallback;

    // No owned workspace at all. Self-heal for a real user (someone who deleted
    // their only workspace); guests get null and their project stays unhomed
    // until conversion.
    if (await this.isGuest(userId)) return null;
    const provisioned = await this.provisionDefault(userId);
    return provisioned?.id ?? null;
  }

  /**
   * The default-workspace rule, defined once: earliest owner-role membership.
   * provision_default_workspace and the backfill migration implement the same
   * ordering in SQL.
   */
  private async findDefaultWorkspaceId(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .order('joined_at', { ascending: true })
      .order('workspace_id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { workspace_id?: string } | null)?.workspace_id ?? null;
  }

  private async isGuest(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('is_guest')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean((data as { is_guest?: boolean } | null)?.is_guest);
  }

  // ─── reads ───────────────────────────────────────────────────────────────

  async listMyWorkspaces(userId: string): Promise<WorkspaceRow[]> {
    const { data: memberships, error } = await this.supabase
      .from('workspace_members')
      .select('workspace_id, role, joined_at, workspace:workspaces(*)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (memberships ?? []) as unknown as Array<{
      workspace_id: string;
      role: WorkspaceMemberRole;
      // The client types an embedded relation as an array even when it is
      // to-one, so normalize both shapes rather than trusting either.
      workspace: WorkspaceRow | WorkspaceRow[] | null;
    }>;
    const present = rows
      .map((row) => ({
        workspace_id: row.workspace_id,
        role: row.role,
        workspace: firstEmbeddedRow(row.workspace),
      }))
      .filter(
        (row): row is typeof row & { workspace: WorkspaceRow } =>
          row.workspace !== null,
      );
    if (present.length === 0) return [];

    const ids = present.map((row) => row.workspace_id);
    const [counts, plans] = await Promise.all([
      this.countMembersByWorkspace(ids),
      this.fetchPlansByWorkspace(ids),
    ]);

    return present.map((row) => ({
      ...row.workspace,
      my_role: row.role,
      member_count: counts.get(row.workspace_id) ?? 0,
      plan: plans.get(row.workspace_id) ?? 'free',
    }));
  }

  async getWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceRow> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    const role = await this.assertCanRead(workspace, userId);

    const counts = await this.countMembersByWorkspace([workspaceId]);
    const seatsUsed = counts.get(workspaceId) ?? 0;

    const base: WorkspaceRow = {
      ...workspace,
      my_role: role,
      member_count: seatsUsed,
      seats_used: seatsUsed,
    };

    // Billing is not a plain member's business — only owners and admins see the
    // subscription block, matching the RLS on workspace_subscriptions.
    if (role === 'owner' || role === 'admin') {
      const subscription = await this.fetchSubscription(workspaceId);
      return {
        ...base,
        subscription,
        plan: subscription?.plan ?? 'free',
      };
    }
    return base;
  }

  private async countMembersByWorkspace(
    workspaceIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (workspaceIds.length === 0) return counts;
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select('workspace_id')
      .in('workspace_id', workspaceIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ workspace_id: string }>) {
      counts.set(row.workspace_id, (counts.get(row.workspace_id) ?? 0) + 1);
    }
    return counts;
  }

  private async fetchPlansByWorkspace(
    workspaceIds: string[],
  ): Promise<Map<string, WorkspacePlan>> {
    const plans = new Map<string, WorkspacePlan>();
    if (workspaceIds.length === 0) return plans;
    const { data, error } = await this.supabase
      .from('workspace_subscriptions')
      .select('workspace_id, plan')
      .in('workspace_id', workspaceIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{
      workspace_id: string;
      plan: WorkspacePlan;
    }>) {
      plans.set(row.workspace_id, row.plan);
    }
    return plans;
  }

  private async fetchSubscription(
    workspaceId: string,
  ): Promise<WorkspaceSubscriptionRow | null> {
    const { data, error } = await this.supabase
      .from('workspace_subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as WorkspaceSubscriptionRow | null) ?? null;
  }

  async listMembers(
    workspaceId: string,
    callerId: string,
  ): Promise<WorkspaceMemberRow[]> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    await this.assertCanRead(workspace, callerId);
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select(WORKSPACE_MEMBER_SELECT)
      .eq('workspace_id', workspaceId)
      .order('joined_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as WorkspaceMemberRow[];
  }

  // ─── writes ──────────────────────────────────────────────────────────────

  async createWorkspace(
    userId: string,
    dto: CreateWorkspaceDto,
  ): Promise<WorkspaceRow> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Workspace name is required');

    const { data, error } = await this.supabase
      .from('workspaces')
      .insert({
        name,
        description: dto.description?.trim() || null,
        avatar_url: dto.avatar_url ?? null,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create workspace');
    }
    const workspace = data as WorkspaceRow;

    const insertOwner = await this.supabase.from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner',
    });
    if (insertOwner.error) {
      // Compensating delete: these writes are not in one transaction, and a
      // workspace nobody owns is unreachable — it would not even appear in the
      // creator's own list. The welcome deck calls this on a retryable step, so
      // without the rollback every retry strands another one.
      const cleanup = await this.supabase
        .from('workspaces')
        .delete()
        .eq('id', workspace.id);
      if (cleanup.error) {
        this.logger.error(
          `Orphan workspace ${workspace.id}: owner insert failed (${insertOwner.error.message}) and rollback failed (${cleanup.error.message})`,
        );
      }
      throw new Error(insertOwner.error.message);
    }

    // Best-effort: a missing subscription row degrades to the free defaults
    // everywhere it is read, so it must not fail workspace creation.
    const subscription = await this.supabase
      .from('workspace_subscriptions')
      .insert({ workspace_id: workspace.id });
    if (subscription.error) {
      this.logger.warn(
        `Failed to seed subscription for workspace ${workspace.id}: ${subscription.error.message}`,
      );
    }

    return { ...workspace, my_role: 'owner', member_count: 1, plan: 'free' };
  }

  async updateWorkspace(
    workspaceId: string,
    userId: string,
    dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceRow> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    const role = await this.assertCanManageWorkspace(
      workspace,
      userId,
      'update the workspace',
    );

    // Reject rather than silently drop: a silent drop shows the web a success
    // toast while the value snaps back on the next refetch.
    if (role !== 'owner') {
      const blocked = WORKSPACE_OWNER_ONLY_UPDATE_FIELDS.filter(
        (key) => dto[key] !== undefined,
      );
      if (blocked.length > 0) {
        throw new ForbiddenException(
          `Only the workspace owner can change: ${blocked.join(', ')}`,
        );
      }
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Workspace name is required');
      patch.name = name;
    }
    if (dto.description !== undefined) {
      patch.description = dto.description.trim() || null;
    }
    if (dto.avatar_url !== undefined) patch.avatar_url = dto.avatar_url;

    const { data, error } = await this.supabase
      .from('workspaces')
      .update(patch)
      .eq('id', workspaceId)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update workspace');
    }
    return { ...(data as WorkspaceRow), my_role: role };
  }

  /**
   * Owner only. Teams and projects survive: both workspace_id columns are
   * ON DELETE SET NULL, so the work is orphaned from the organization rather
   * than destroyed with it.
   */
  async deleteWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string }> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    await this.assertOwner(workspace, userId, 'delete the workspace');

    const { error } = await this.supabase
      .from('workspaces')
      .delete()
      .eq('id', workspaceId);
    if (error) throw new Error(error.message);
    return { id: workspaceId };
  }

  async updateMember(
    workspaceId: string,
    targetUserId: string,
    callerId: string,
    dto: UpdateWorkspaceMemberDto,
  ): Promise<WorkspaceMemberRow> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    const callerRole = await this.assertCanManageWorkspace(
      workspace,
      callerId,
      'manage members',
    );

    const target = await this.findMembership(workspaceId, targetUserId);
    if (!target) throw new NotFoundException('Member not found');

    // Ownership is only an owner's to give or take. An admin promoting
    // themselves would otherwise be a one-request privilege escalation.
    if (
      (dto.role === 'owner' || target.role === 'owner') &&
      callerRole !== 'owner'
    ) {
      throw new ForbiddenException(
        'Only a workspace owner can change owner roles',
      );
    }

    if (target.role === 'owner' && dto.role !== 'owner') {
      await this.assertNotLastOwner(workspaceId, targetUserId, 'demote');
    }

    const { data, error } = await this.supabase
      .from('workspace_members')
      .update({ role: dto.role })
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)
      .select(WORKSPACE_MEMBER_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update member');
    }
    return data as unknown as WorkspaceMemberRow;
  }

  /**
   * Remove a member, or leave the workspace when target === caller.
   */
  async removeMember(
    workspaceId: string,
    targetUserId: string,
    callerId: string,
  ): Promise<{ workspace_id: string; user_id: string }> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    const isSelf = targetUserId === callerId;
    if (!isSelf) {
      await this.assertCanManageWorkspace(
        workspace,
        callerId,
        'remove members',
      );
    } else {
      await this.assertCanRead(workspace, callerId);
    }

    const target = await this.findMembership(workspaceId, targetUserId);
    if (!target) throw new NotFoundException('Member not found');

    if (target.role === 'owner') {
      await this.assertNotLastOwner(workspaceId, targetUserId, 'remove');
    }

    const { error } = await this.supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId);
    if (error) throw new Error(error.message);
    return { workspace_id: workspaceId, user_id: targetUserId };
  }

  // ─── invites ─────────────────────────────────────────────────────────────

  /**
   * Invite by email. Mirrors TeamsService.inviteByEmail:
   *   - lookup profile by lowercased email
   *   - if already a member, 400
   *   - refresh the pending row in place, or insert
   *   - notify when the invitee already has a profile, and always email
   */
  async inviteByEmail(
    workspaceId: string,
    callerId: string,
    dto: InviteWorkspaceMemberDto,
  ): Promise<WorkspaceInviteRow & { email_delivery: SendMailResult }> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    await this.assertCanManageWorkspace(workspace, callerId, 'invite people');

    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');

    const { data: profileMatch } = await this.supabase
      .from('profiles')
      .select('id, email')
      .ilike('email', email)
      .maybeSingle();

    const matchedUserId = (profileMatch as { id?: string } | null)?.id ?? null;

    if (matchedUserId) {
      const existingMember = await this.findMembership(
        workspaceId,
        matchedUserId,
      );
      if (existingMember) {
        throw new BadRequestException(
          'This person is already a member of the workspace.',
        );
      }
    }

    const role: WorkspaceMemberRole = dto.role ?? 'member';
    const message = dto.message?.trim() || null;

    // Refresh an existing pending row in place if one exists, else insert.
    // Supabase upsert cannot target a partial unique index, so this is an
    // explicit select-then-update/insert.
    const existingQuery = this.supabase
      .from('workspace_invites')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending');
    const { data: existing } = matchedUserId
      ? await existingQuery.eq('invitee_id', matchedUserId).maybeSingle()
      : await existingQuery.eq('invitee_email', email).maybeSingle();

    let row: Record<string, unknown>;
    if (existing) {
      const { data, error } = await this.supabase
        .from('workspace_invites')
        .update({
          invited_by: callerId,
          invitee_id: matchedUserId,
          invitee_email: email,
          role,
          message,
          status: 'pending',
          responded_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id)
        .select(WORKSPACE_INVITE_SELECT)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to refresh invite');
      }
      row = data as Record<string, unknown>;
    } else {
      const { data, error } = await this.supabase
        .from('workspace_invites')
        .insert({
          workspace_id: workspaceId,
          invited_by: callerId,
          invitee_id: matchedUserId,
          invitee_email: email,
          role,
          message,
          status: 'pending',
        })
        .select(WORKSPACE_INVITE_SELECT)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create invite');
      }
      row = data as Record<string, unknown>;
    }

    const inviterName = await this.getDisplayName(callerId);
    const workspaceName = workspace.name || 'a workspace';

    if (matchedUserId) {
      const roleText = role !== 'member' ? ` as ${role}` : '';
      const noteText = message ? ` Note: ${message}` : '';
      const inviteMessage = `${inviterName || 'Someone'} invited you to join ${workspaceName}${roleText}.${noteText}`;

      try {
        await this.notifications.createNotification({
          user_id: matchedUserId,
          project_id: undefined,
          type_name: 'workspace_invite_received',
          actor_id: callerId,
          content: {
            invite_id: row.id,
            workspace_id: workspaceId,
            workspace_name: workspaceName,
            invited_role: role,
            inviter_name: inviterName,
            message: inviteMessage,
            note: message,
          },
          link_url: WORKSPACE_INVITES_PATH,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue workspace_invite_received notification: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Everyone gets the email, with or without an account. For someone with no
    // profile this is the ONLY signal they receive — the notification above
    // cannot fire, because there is no user to attach it to.
    //
    // No outbox row is involved: `workspace_invite_received` stays
    // `email_eligible = false`, so this direct send is the only email. Flipping
    // that flag would produce a second one.
    const emailDelivery = await this.sendWorkspaceInviteEmail({
      to: email,
      inviterName: inviterName || 'A workspace admin',
      workspaceName,
      role,
      inviteMessage: message,
      inviteId: (row.id as string | undefined) ?? null,
    });

    return {
      ...(row as unknown as WorkspaceInviteRow),
      email_delivery: emailDelivery,
    };
  }

  /**
   * Email a workspace invitation. Best-effort: the invite row is already
   * committed, so a mail failure is reported, never thrown.
   */
  private async sendWorkspaceInviteEmail(payload: {
    to: string;
    inviterName: string;
    workspaceName: string;
    role?: string | null;
    inviteMessage?: string | null;
    inviteId?: string | null;
  }): Promise<SendMailResult> {
    // Suppression stops the EMAIL, not the INVITATION. Someone who unsubscribed
    // has still been deliberately invited by a person, and the invite waits for
    // them in-app; what they opted out of is being mailed about it.
    if (await isEmailSuppressed(this.supabase, payload.to)) {
      this.logger.log(
        `workspace invite email suppressed for ${payload.to}: address is on the suppression list`,
      );
      return {
        sent: false,
        reason:
          'the recipient has unsubscribed from Proyekto emails — share the invite link with them directly',
      };
    }

    // APP_URL first, then CLIENT_URL — never a bare localhost default, which
    // once put a dead link in every production invite because APP_URL is not
    // set on Cloud Run.
    const appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('CLIENT_URL', 'http://localhost:3000');

    const { subject, html, text } = buildWorkspaceInviteEmail({
      inviterName: payload.inviterName,
      workspaceName: payload.workspaceName,
      inviteLink: payload.inviteId
        ? `${appUrl}${WORKSPACE_INVITES_PATH}?inviteId=${encodeURIComponent(payload.inviteId)}`
        : `${appUrl}${WORKSPACE_INVITES_PATH}`,
      role: payload.role,
      inviteMessage: payload.inviteMessage,
    });

    const unsubscribe = this.config.get<string>('MAIL_FROM_SUPPORT')?.trim();
    return this.mailer.send({
      to: payload.to,
      sender: 'noreply',
      subject,
      html,
      text,
      headers: unsubscribe
        ? { 'List-Unsubscribe': `<mailto:${unsubscribe}?subject=unsubscribe>` }
        : undefined,
    });
  }

  async listInvitesForWorkspace(
    workspaceId: string,
    callerId: string,
  ): Promise<WorkspaceInviteRow[]> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    await this.assertCanRead(workspace, callerId);
    const { data, error } = await this.supabase
      .from('workspace_invites')
      .select(WORKSPACE_INVITE_SELECT)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as WorkspaceInviteRow[];
  }

  async listInvitesForMe(userId: string): Promise<WorkspaceInviteRow[]> {
    const { data, error } = await this.supabase
      .from('workspace_invites')
      .select(WORKSPACE_INVITE_SELECT)
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as WorkspaceInviteRow[];
  }

  async cancelInvite(
    workspaceId: string,
    inviteId: string,
    callerId: string,
  ): Promise<WorkspaceInviteRow> {
    const workspace = await this.fetchWorkspaceOrThrow(workspaceId);
    await this.assertCanManageWorkspace(
      workspace,
      callerId,
      'cancel invitations',
    );
    const { data, error } = await this.supabase
      .from('workspace_invites')
      .update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .select(WORKSPACE_INVITE_SELECT)
      .single();
    if (error || !data) {
      throw new NotFoundException('Pending invite not found');
    }
    return data as unknown as WorkspaceInviteRow;
  }

  async respondInvite(
    inviteId: string,
    userId: string,
    dto: RespondWorkspaceInviteDto,
  ): Promise<WorkspaceInviteRow> {
    // Fetch as-is (service-role bypasses RLS) and authorize here: only the
    // matched invitee may respond.
    const { data: invite, error: fetchErr } = await this.supabase
      .from('workspace_invites')
      .select('*')
      .eq('id', inviteId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.invitee_id !== userId) {
      throw new ForbiddenException(
        'Only the invitee can respond to this invite',
      );
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException(
        `Invite is already ${invite.status}; cannot respond again.`,
      );
    }

    if (dto.status === 'accepted') {
      // Tolerate the unique-violation race where the user was added between
      // fetch and insert.
      const { error: insertErr } = await this.supabase
        .from('workspace_members')
        .insert({
          workspace_id: invite.workspace_id,
          user_id: userId,
          role: invite.role ?? 'member',
        });
      if (insertErr && insertErr.code !== '23505') {
        throw new Error(insertErr.message);
      }
    }

    const { data: updated, error: updateErr } = await this.supabase
      .from('workspace_invites')
      .update({
        status: dto.status,
        responded_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .select(WORKSPACE_INVITE_SELECT)
      .single();
    if (updateErr || !updated) {
      throw new Error(updateErr?.message ?? 'Failed to update invite');
    }
    return updated as unknown as WorkspaceInviteRow;
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  async fetchWorkspaceOrThrow(workspaceId: string): Promise<WorkspaceRow> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Workspace not found');
    return data as WorkspaceRow;
  }

  private async findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: WorkspaceMemberRole } | null> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { role: WorkspaceMemberRole } | null) ?? null;
  }

  /**
   * The caller's standing in this workspace, or null when they have none.
   *
   * Unlike teams, there is no owner_id column to consult: ownership lives in
   * workspace_members.role, so this single lookup is the whole answer.
   */
  async resolveViewerRole(
    workspace: WorkspaceRow,
    userId: string,
  ): Promise<WorkspaceMemberRole | null> {
    const membership = await this.findMembership(workspace.id, userId);
    return membership?.role ?? null;
  }

  /** Any standing at all. Returns the role so callers can reuse it. */
  async assertCanRead(
    workspace: WorkspaceRow,
    userId: string,
  ): Promise<WorkspaceMemberRole> {
    const role = await this.resolveViewerRole(workspace, userId);
    if (!role) {
      throw new ForbiddenException('You do not have access to this workspace');
    }
    return role;
  }

  async assertCanManageWorkspace(
    workspace: WorkspaceRow,
    userId: string,
    action = 'manage members',
  ): Promise<'owner' | 'admin'> {
    const role = await this.resolveViewerRole(workspace, userId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException(
        `Only the workspace owner or workspace admins can ${action}`,
      );
    }
    return role;
  }

  async assertOwner(
    workspace: WorkspaceRow,
    userId: string,
    action = 'do this',
  ): Promise<void> {
    const role = await this.resolveViewerRole(workspace, userId);
    if (role !== 'owner') {
      throw new ForbiddenException(`Only the workspace owner can ${action}`);
    }
  }

  /**
   * A workspace with no owner is unadministrable: nobody could invite, rename,
   * or delete it, and it would still be billed. Blocking the last owner's exit
   * is cheaper than a recovery path.
   */
  private async assertNotLastOwner(
    workspaceId: string,
    targetUserId: string,
    action: 'demote' | 'remove',
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner');
    if (error) throw new Error(error.message);
    const owners = (data ?? []) as Array<{ user_id: string }>;
    const others = owners.filter((row) => row.user_id !== targetUserId);
    if (others.length === 0) {
      throw new BadRequestException(
        action === 'demote'
          ? 'A workspace must keep at least one owner. Promote someone else first.'
          : 'A workspace must keep at least one owner. Transfer ownership before leaving.',
      );
    }
  }

  private async getDisplayName(userId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', userId)
      .maybeSingle();
    if (!data) return null;
    const composed = [data.first_name, data.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return data.display_name || composed || data.email || null;
  }
}
