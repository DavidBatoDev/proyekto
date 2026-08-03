import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../projects/authorization/project-authorization.service';
import { ProjectsService } from '../../projects/projects.service';
import { extractMentionedEmails } from '../utils/mention-parser';

/** Mentions per author per rolling day. */
const MAX_INVITES_PER_ACTOR_PER_DAY = 20;

/**
 * First-bake safety valve: while non-empty, only these recipient domains are
 * reachable. A constant rather than an env var deliberately — it is meant to be
 * DELETED in a follow-up once the feature is trusted, not configured forever.
 */
const RECIPIENT_DOMAIN_ALLOWLIST: readonly string[] = ['devcon.ph'];

/**
 * How long the email waits. Much shorter than the 10 minutes a normal
 * notification waits, because that delay exists so someone who reads the thing
 * in-app never gets mail — and a stranger cannot read anything in-app. What is
 * left is a grace window for the author noticing a typo and deleting the
 * comment.
 */
const SEND_DELAY_MINUTES = 2;

export interface MentionInviteInput {
  html: string;
  authorId: string;
  projectId: string | null;
  roadmapId: string | null;
  sourceType: 'task_comment' | 'epic_comment' | 'feature_comment';
  sourceId: string | null;
  entityId: string;
  linkUrl: string | null;
  /** Task/epic/feature title, for "mentioned you in <title>". */
  entityTitle: string | null;
  actorName: string | null;
  excerpt: string | null;
}

/**
 * Inviting someone who has no Proyekto account by @mentioning their email
 * address in a roadmap comment.
 *
 * Read the abuse model before changing anything here: an admin can cause
 * Proyekto to send mail, from Proyekto's domain, to any address they type,
 * about a project the recipient cannot see. Every gate below exists because of
 * that sentence, and the order matters — the cheapest and most protective
 * checks run first so a rejected address never reaches the point of creating
 * rows.
 *
 * Best-effort throughout: the comment is already committed by the time this
 * runs, so nothing here throws.
 */
@Injectable()
export class RoadmapMentionInviteService {
  private readonly logger = new Logger(RoadmapMentionInviteService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
    private readonly projects: ProjectsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The activation switch, read per call.
   *
   * Reuses `notification_types.email_eligible` rather than introducing an env
   * flag: same column, same one-statement activation and rollback, no deploy.
   * It gates the INVITE, not merely the email — a dark deploy must not quietly
   * write `project_invites` rows either.
   */
  private async isEnabled(): Promise<boolean> {
    const { data } = await this.db
      .from('notification_types')
      .select('email_eligible')
      .eq('name', 'roadmap_mention_invite')
      .maybeSingle();

    return Boolean(
      (data as { email_eligible?: boolean } | null)?.email_eligible,
    );
  }

  /**
   * During the first bake, only our own domains are reachable. Removing this is
   * a deliberate follow-up, not a cleanup — it is the one control that makes
   * testing a stranger-mailing feature in production safe.
   */
  private allowedByDomainPolicy(email: string): boolean {
    if (RECIPIENT_DOMAIN_ALLOWLIST.length === 0) return true;
    const domain = email.split('@')[1] ?? '';
    return RECIPIENT_DOMAIN_ALLOWLIST.includes(domain);
  }

  async inviteMentionedEmails(input: MentionInviteInput): Promise<void> {
    const { html, authorId, projectId, roadmapId } = input;

    // Fail closed on unknown scope, exactly as the user-id mention path does.
    if (!projectId || !roadmapId || !input.sourceId) return;

    const emails = extractMentionedEmails(html);
    if (emails.length === 0) return;

    if (!(await this.isEnabled())) return;

    // Only people who could invite through the Team page may invite through a
    // comment. Same predicate `assertCanManageMembers` reduces to.
    try {
      await this.authorization.assertRole(authorId, projectId, 'admin');
    } catch {
      this.logger.warn(
        `mention invite refused: ${authorId} is not an admin of project ${projectId}`,
      );
      return;
    }

    for (const email of emails) {
      try {
        await this.inviteOne(email, input);
      } catch (err) {
        // One bad address must not stop the rest.
        this.logger.warn(
          `mention invite failed for ${email}: ${(err as Error)?.message ?? 'unknown'}`,
        );
      }
    }
  }

  private async inviteOne(
    email: string,
    input: MentionInviteInput,
  ): Promise<void> {
    const { authorId, projectId, roadmapId } = input;

    if (!this.allowedByDomainPolicy(email)) return;

    // Already a member of Proyekto? Then this is not an invite at all — the
    // normal mention path should have caught them, and re-inviting an existing
    // user by email would be noise.
    const { data: existingProfile } = await this.db
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existingProfile) return;

    // Suppressed addresses are checked here as well as at send time, so we
    // never create rows we would only skip later.
    const { data: suppressed } = await this.db
      .from('email_suppressions')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (suppressed) return;

    if (await this.overActorCap(authorId)) {
      this.logger.warn(
        `mention invite cap reached for actor ${authorId}; skipping ${email}`,
      );
      return;
    }

    // Existing invite state decides whether we may touch project_invites at
    // all. The shared upsert resets status and responded_at and overwrites the
    // position/message/role, so calling it blindly would both resurrect a
    // DECLINED invite — a harassment vector — and clobber a carefully filled-in
    // pending one.
    const { data: existingInvite } = await this.db
      .from('project_invites')
      .select('id, status')
      .eq('project_id', projectId as string)
      .eq('invitee_email', email)
      .maybeSingle();

    const inviteStatus = (existingInvite as { status?: string } | null)?.status;
    if (inviteStatus === 'declined') return;

    let projectInviteId =
      (existingInvite as { id?: string } | null)?.id ?? null;

    if (!existingInvite) {
      const created = (await this.projects.inviteByEmail(
        projectId as string,
        authorId,
        { email, role: 'member' } as never,
        { sendEmail: false },
      )) as { id?: string } | null;
      projectInviteId = created?.id ?? null;
    }

    // The pending record. ON CONFLICT keeps a re-submitted or edited comment
    // from stacking duplicates for the same person and comment.
    const { data: pending } = await this.db
      .from('pending_mention_invites')
      .upsert(
        {
          invitee_email: email,
          project_id: projectId,
          roadmap_id: roadmapId,
          source_type: input.sourceType,
          source_id: input.sourceId,
          entity_id: input.entityId,
          invited_by: authorId,
          actor_name: input.actorName,
          // Snapshotted for the IN-APP notification after signup. It must not
          // reach the pre-signup email; see the registry entry.
          excerpt: input.excerpt,
          link_url: input.linkUrl ?? '/freelancer/invites',
          project_invite_id: projectInviteId,
        },
        {
          onConflict: 'invitee_email,source_type,source_id',
          ignoreDuplicates: true,
        },
      )
      .select('id, unsubscribe_token')
      .maybeSingle();

    // A duplicate returns no row — the person was already told about this exact
    // comment, so there is nothing new to send.
    if (!pending) return;

    const token = (pending as { unsubscribe_token?: string }).unsubscribe_token;
    if (!token) return;

    await this.db.from('notification_email_outbox').insert({
      notification_id: null,
      user_id: null,
      to_email: email,
      type_name: 'roadmap_mention_invite',
      send_after: new Date(
        Date.now() + SEND_DELAY_MINUTES * 60_000,
      ).toISOString(),
      payload: {
        // Signup, not the comment: they have no project access yet, so a deep
        // link would land on a login wall. `redirect` also lights up the
        // existing "You've been invited" banner on the signup form.
        link_url: `/auth/signup?redirect=%2Ffreelancer%2Finvites&email=${encodeURIComponent(email)}`,
        content: {
          actor_name: input.actorName,
          context_title: input.entityTitle,
          // Deliberately NO excerpt.
        },
        unsubscribe_token: token,
      },
    });

    this.logger.log(
      `mention invite queued for ${email} on project ${projectId} by ${authorId}`,
    );
  }

  private async overActorCap(authorId: string): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await this.db
      .from('pending_mention_invites')
      .select('id', { count: 'exact', head: true })
      .eq('invited_by', authorId)
      .gte('created_at', since);

    return (count ?? 0) >= MAX_INVITES_PER_ACTOR_PER_DAY;
  }
}
