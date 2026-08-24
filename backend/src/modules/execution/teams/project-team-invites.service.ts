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
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { buildProjectTeamInviteEmail } from './project-team-invite-email.template';
import { ProjectTeamsService } from './project-teams.service';
import { TEAM_INVITES_PATH } from './team-invites-path';
import { TeamsService } from './teams.service';
import {
  InviteTeamToProjectDto,
  ProjectTeamDefaultRole,
  RespondProjectTeamInviteDto,
} from './dto/teams.dto';

export interface ProjectTeamInviteRow {
  id: string;
  project_id: string;
  invited_by: string | null;
  invitee_id: string | null;
  invitee_email: string | null;
  team_id: string | null;
  team_name_hint: string | null;
  member_role: ProjectTeamDefaultRole;
  make_primary: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  message: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  project?: {
    id: string;
    title: string | null;
    banner_url: string | null;
  } | null;
  team?: { id: string; name: string; avatar_url: string | null } | null;
  invited_by_profile?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
  invitee?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
}

const PROJECT_TEAM_INVITE_SELECT = `
  *,
  project:projects!project_team_invites_project_id_fkey(id, title, banner_url),
  team:teams!project_team_invites_team_id_fkey(id, name, avatar_url),
  invited_by_profile:profiles!project_team_invites_invited_by_fkey(id, display_name, avatar_url, email),
  invitee:profiles!project_team_invites_invitee_id_fkey(id, display_name, avatar_url, email)
`;

/**
 * "Invite a team" — ask someone to bring one of THEIR teams onto your project.
 *
 * Why this exists next to `ProjectTeamsService.attach`: attaching requires
 * listing the team first, and `GET /api/teams` only returns teams the caller
 * is on. A project owner had no way to bring in an outside team, and an
 * outside team had no way to consent to being brought in. This service is
 * that missing handshake.
 *
 * The invite names a PERSON, never a team id — see the migration comment in
 * 20260825120000_project_team_invites.sql for why teams are not searchable
 * across tenants. The team is chosen by the invitee at accept time.
 */
@Injectable()
export class ProjectTeamInvitesService {
  private readonly logger = new Logger(ProjectTeamInvitesService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly notifications: NotificationsService,
    // MailModule is @Global(), so TeamsModule needs no import for these.
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly projectTeams: ProjectTeamsService,
    private readonly teams: TeamsService,
  ) {}

  // ─── inviter side ───────────────────────────────────────────────────────

  /**
   * Send (or refresh) an invitation. Mirrors `TeamsService.inviteByEmail`:
   * resolve the email to a profile if we can, refresh any pending row in
   * place, notify a resolved invitee, and always email.
   */
  async invite(
    projectId: string,
    callerId: string,
    dto: InviteTeamToProjectDto,
  ): Promise<ProjectTeamInviteRow & { email_delivery: SendMailResult }> {
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'teams.manage',
    );

    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');

    const project = await this.fetchProjectOrThrow(projectId);

    const { data: profileMatch } = await this.supabase
      .from('profiles')
      .select('id, email')
      .ilike('email', email)
      .maybeSingle();
    const matchedUserId = (profileMatch as { id?: string } | null)?.id ?? null;

    // Inviting yourself is a no-op with a confusing outcome: you would end up
    // approving your own request, and you can already attach any team you are
    // on from the same page.
    if (matchedUserId && matchedUserId === callerId) {
      throw new BadRequestException(
        'That is your own address. Use “Attach team” for teams you are already on.',
      );
    }

    const memberRole: ProjectTeamDefaultRole = dto.member_role ?? 'editor';
    const teamNameHint = dto.team_name_hint?.trim() || null;
    const message = dto.message?.trim() || null;
    const makePrimary = dto.make_primary ?? false;

    // Refresh a pending row in place if one exists, else insert. Supabase
    // upsert cannot target a partial unique index, so this is an explicit
    // select-then-update/insert — the same shape team_invites uses.
    const existingQuery = this.supabase
      .from('project_team_invites')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'pending');
    const { data: existing } = matchedUserId
      ? await existingQuery.eq('invitee_id', matchedUserId).maybeSingle()
      : await existingQuery.eq('invitee_email', email).maybeSingle();

    const payload = {
      invited_by: callerId,
      invitee_id: matchedUserId,
      invitee_email: email,
      team_name_hint: teamNameHint,
      member_role: memberRole,
      make_primary: makePrimary,
      message,
      status: 'pending' as const,
    };

    let row: Record<string, unknown>;
    if (existing) {
      const { data, error } = await this.supabase
        .from('project_team_invites')
        .update({ ...payload, responded_at: null })
        .eq('id', (existing as { id: string }).id)
        .select(PROJECT_TEAM_INVITE_SELECT)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to refresh invite');
      }
      row = data as Record<string, unknown>;
    } else {
      const { data, error } = await this.supabase
        .from('project_team_invites')
        .insert({ project_id: projectId, ...payload })
        .select(PROJECT_TEAM_INVITE_SELECT)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create invite');
      }
      row = data as Record<string, unknown>;
    }

    const inviterName = await this.getDisplayName(callerId);
    const projectName = project.title || 'a project';

    if (matchedUserId) {
      const teamText = teamNameHint ? ` with ${teamNameHint}` : '';
      const noteText = message ? ` Note: ${message}` : '';
      try {
        await this.notifications.createNotification({
          user_id: matchedUserId,
          // Deliberately carried: the recipient has no access to this project
          // yet, and the notification list tolerates a project_id it cannot
          // resolve. It is what makes "which project?" answerable later.
          project_id: projectId,
          type_name: 'project_team_invite_received',
          actor_id: callerId,
          content: {
            invite_id: row.id,
            project_id: projectId,
            project_name: projectName,
            team_name_hint: teamNameHint,
            member_role: memberRole,
            make_primary: makePrimary,
            inviter_name: inviterName,
            message: `${inviterName || 'A project admin'} invited your team to work on ${projectName}${teamText}.${noteText}`,
            note: message,
          },
          // Deep-linked like the email is, so someone holding several
          // invitations is not left to work out which one the bell meant.
          link_url: `${TEAM_INVITES_PATH}?inviteId=${encodeURIComponent(String(row.id))}`,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue project_team_invite_received notification: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Everyone gets the email, account or not — for someone with no profile
    // it is the only signal that exists, since the notification above cannot
    // fire without a user to attach it to. Same reasoning, and the same
    // `email_eligible = false` caveat, as the team invite: this direct send is
    // the only email, and flipping that flag would produce a second one.
    const emailDelivery = await this.sendInviteEmail({
      to: email,
      inviterName: inviterName || 'A project admin',
      projectName,
      teamNameHint,
      memberRole,
      makePrimary,
      inviteMessage: message,
      inviteId: (row.id as string | undefined) ?? null,
    });

    return {
      ...(row as unknown as ProjectTeamInviteRow),
      email_delivery: emailDelivery,
    };
  }

  async listForProject(
    projectId: string,
    callerId: string,
  ): Promise<ProjectTeamInviteRow[]> {
    await this.projectAuth.assertPermission(callerId, projectId, 'teams.view');
    const { data, error } = await this.supabase
      .from('project_team_invites')
      .select(PROJECT_TEAM_INVITE_SELECT)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProjectTeamInviteRow[];
  }

  async cancel(
    projectId: string,
    inviteId: string,
    callerId: string,
  ): Promise<ProjectTeamInviteRow> {
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'teams.manage',
    );
    const { data, error } = await this.supabase
      .from('project_team_invites')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', inviteId)
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .select(PROJECT_TEAM_INVITE_SELECT)
      .single();
    if (error || !data) {
      throw new NotFoundException('Pending invite not found');
    }
    return data as unknown as ProjectTeamInviteRow;
  }

  // ─── invitee side ───────────────────────────────────────────────────────

  async listForMe(userId: string): Promise<ProjectTeamInviteRow[]> {
    const { data, error } = await this.supabase
      .from('project_team_invites')
      .select(PROJECT_TEAM_INVITE_SELECT)
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProjectTeamInviteRow[];
  }

  /**
   * Accept or decline. On accept the chosen team is attached to the project
   * and the picked members are curated onto it.
   *
   * Two authority checks, both required and neither sufficient alone:
   *   - the invitation must be pending and addressed to this user (the
   *     project side consented to *this person* bringing a team);
   *   - the user must own or administer the team they named (the team side
   *     consented, and a bare member cannot volunteer their org's roster).
   *
   * The role members land on comes from the invitation, never from this
   * request — roles on the project belong to the project's owner.
   */
  async respond(
    inviteId: string,
    userId: string,
    dto: RespondProjectTeamInviteDto,
  ): Promise<ProjectTeamInviteRow> {
    const { data: invite, error: fetchErr } = await this.supabase
      .from('project_team_invites')
      .select('*')
      .eq('id', inviteId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!invite) throw new NotFoundException('Invite not found');

    const row = invite as unknown as ProjectTeamInviteRow;
    if (row.invitee_id !== userId) {
      throw new ForbiddenException(
        'Only the invitee can respond to this invite',
      );
    }
    if (row.status !== 'pending') {
      throw new BadRequestException(
        `Invite is already ${row.status}; cannot respond again.`,
      );
    }

    const patch: Record<string, unknown> = {
      status: dto.status,
      responded_at: new Date().toISOString(),
    };

    if (dto.status === 'accepted') {
      if (!dto.team_id) {
        throw new BadRequestException(
          'Pick which team you are bringing onto this project.',
        );
      }
      const team = await this.teams.fetchTeamOrThrow(dto.team_id);
      await this.teams.assertCanManageMembers(team, userId);

      const memberUserIds = await this.resolveCuratedMembers(
        dto.team_id,
        userId,
        dto.member_user_ids ?? [],
      );

      await this.projectTeams.attachFromInvite({
        projectId: row.project_id,
        teamId: dto.team_id,
        // The inviter authorized this team's presence on the project; if their
        // profile is gone, fall back to the accepter so the column is never
        // left null on an attachment that definitely had an author.
        attachedBy: row.invited_by ?? userId,
        curatedBy: userId,
        isPrimary: row.make_primary,
        memberRole: row.member_role,
        memberUserIds,
      });

      patch.team_id = dto.team_id;
    }

    const { data: updated, error: updateErr } = await this.supabase
      .from('project_team_invites')
      .update(patch)
      .eq('id', inviteId)
      // Guard the read-modify-write: if anything settled this invite between
      // the fetch above and here, the attach has happened but the row must not
      // be flipped twice.
      .eq('status', 'pending')
      .select(PROJECT_TEAM_INVITE_SELECT)
      .single();
    if (updateErr || !updated) {
      throw new Error(updateErr?.message ?? 'Failed to update invite');
    }

    await this.notifyInviter(row, userId, dto.status);

    return updated as unknown as ProjectTeamInviteRow;
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  /**
   * Which team members actually join. Requested ids are intersected with the
   * team's real roster (so a hand-rolled request cannot curate a stranger onto
   * the project), and the accepter is always included — a team attached with
   * nobody on it is not a state worth creating, and they are the one person we
   * know consented.
   */
  private async resolveCuratedMembers(
    teamId: string,
    accepterId: string,
    requested: string[],
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);

    const roster = new Set(
      ((data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id),
    );
    const picked = requested.filter((id) => roster.has(id));
    if (roster.has(accepterId)) picked.push(accepterId);
    return [...new Set(picked)];
  }

  private async notifyInviter(
    invite: ProjectTeamInviteRow,
    accepterId: string,
    status: 'accepted' | 'declined',
  ): Promise<void> {
    if (!invite.invited_by) return;
    const accepterName = await this.getDisplayName(accepterId);
    const verb = status === 'accepted' ? 'accepted' : 'declined';
    try {
      await this.notifications.createNotification({
        user_id: invite.invited_by,
        project_id: invite.project_id,
        type_name: 'project_team_invite_responded',
        actor_id: accepterId,
        content: {
          invite_id: invite.id,
          project_id: invite.project_id,
          status,
          message: `${accepterName || 'Someone'} ${verb} your invitation to bring their team onto the project.`,
        },
        link_url: `/project/${invite.project_id}/team/teams`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue project_team_invite_responded notification: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Best-effort mail. The invite row is already committed, so a failure is
   * reported back to the inviter, never thrown — including the suppression
   * case, where the invitation still stands and only the email is withheld.
   */
  private async sendInviteEmail(payload: {
    to: string;
    inviterName: string;
    projectName: string;
    teamNameHint: string | null;
    memberRole: string;
    makePrimary: boolean;
    inviteMessage: string | null;
    inviteId: string | null;
  }): Promise<SendMailResult> {
    if (await isEmailSuppressed(this.supabase, payload.to)) {
      this.logger.log(
        `project team invite email suppressed for ${payload.to}: address is on the suppression list`,
      );
      return {
        sent: false,
        reason:
          'the recipient has unsubscribed from Proyekto emails — share the invite link with them directly',
      };
    }

    // APP_URL first, then CLIENT_URL — never a bare localhost default, which
    // is what once put a dead link in every production invite.
    const appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('CLIENT_URL', 'http://localhost:3000');

    const { subject, html, text } = buildProjectTeamInviteEmail({
      inviterName: payload.inviterName,
      projectName: payload.projectName,
      inviteLink: payload.inviteId
        ? `${appUrl}${TEAM_INVITES_PATH}?inviteId=${encodeURIComponent(payload.inviteId)}`
        : `${appUrl}${TEAM_INVITES_PATH}`,
      teamNameHint: payload.teamNameHint,
      memberRole: payload.memberRole,
      makePrimary: payload.makePrimary,
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

  private async fetchProjectOrThrow(
    projectId: string,
  ): Promise<{ id: string; title: string | null }> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('id, title')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Project not found');
    return data as { id: string; title: string | null };
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
