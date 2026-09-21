import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
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
} from '../../../../common/mail/mailer.service';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { isEmailSuppressed } from '../../../shared/notifications/email/email-suppression';
import { FinanceBookAccessService } from './finance-book-access.service';
import type { FinanceBookRole } from './finance-book-permissions';

export interface FinanceInviteRow {
  id: string;
  book_id: string;
  email: string;
  finance_role: FinanceBookRole;
  capabilities: Record<string, unknown> | null;
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  invited_by: string | null;
  accepted_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceInvitePreview {
  invite: Pick<
    FinanceInviteRow,
    'id' | 'email' | 'finance_role' | 'status' | 'expires_at' | 'created_at'
  >;
  book: {
    id: string;
    kind: string;
    currency: string;
    status: string;
    team: { id: string; name: string; avatar_url: string | null } | null;
  };
  invited_by: { id: string; display_name: string | null } | null;
}

const INVITE_EXPIRY_DAYS = 14;

/**
 * Email invitations into a finance book, mirroring `project_team_invites`:
 * the invite row names an email, the TOKEN is the credential at accept time
 * (same precedent as contract signing links) — so an invitee whose account
 * email differs from the invited address can still accept.
 *
 * Runs on the service-role client; the `assertBookCapability` calls here are
 * the security boundary, and access misses read as NotFound.
 */
@Injectable()
export class FinanceInvitesService {
  private readonly logger = new Logger(FinanceInvitesService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: FinanceBookAccessService,
    // MailModule is @Global(), so FinanceModule needs no import for these.
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  // ─── inviter side ───────────────────────────────────────────────────────

  async create(
    callerId: string,
    bookId: string,
    input: {
      email: string;
      finance_role: FinanceBookRole;
      capabilities?: Record<string, unknown>;
    },
  ): Promise<
    FinanceInviteRow & { accept_url: string; email_delivery: SendMailResult }
  > {
    const access = await this.access.assertBookCapability(
      callerId,
      bookId,
      'manage_members',
    );
    const email = input.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    if ((input.finance_role as string) === 'owner') {
      throw new BadRequestException(
        'Ownership is implicit from the book — the owner role cannot be invited',
      );
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.supabase
      .from('finance_invites')
      .insert({
        book_id: bookId,
        email,
        finance_role: input.finance_role,
        capabilities: input.capabilities ?? {},
        token,
        invited_by: callerId,
        expires_at: expiresAt,
      })
      .select('*')
      .single<FinanceInviteRow>();
    if (error) throw new Error(error.message);

    const acceptUrl = `${this.appUrl()}/engagements/finance/invite/${token}`;
    const emailDelivery = await this.sendInviteEmail({
      to: email,
      role: input.finance_role,
      bookKind: access.book.kind,
      acceptUrl,
      inviterId: callerId,
    });

    return { ...data, accept_url: acceptUrl, email_delivery: emailDelivery };
  }

  async listForBook(
    callerId: string,
    bookId: string,
  ): Promise<FinanceInviteRow[]> {
    await this.access.assertBookCapability(callerId, bookId, 'manage_members');
    const { data, error } = await this.supabase
      .from('finance_invites')
      .select('*')
      .eq('book_id', bookId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as FinanceInviteRow[];
  }

  async cancel(
    callerId: string,
    bookId: string,
    inviteId: string,
  ): Promise<FinanceInviteRow> {
    await this.access.assertBookCapability(callerId, bookId, 'manage_members');
    const { data, error } = await this.supabase
      .from('finance_invites')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .eq('book_id', bookId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle<FinanceInviteRow>();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Pending invite not found');
    return data;
  }

  // ─── invitee side (token is the credential) ─────────────────────────────

  async preview(token: string): Promise<FinanceInvitePreview> {
    const invite = await this.fetchByToken(token);
    const status = await this.effectiveStatus(invite);

    const { data: book, error } = await this.supabase
      .from('finance_books')
      .select(
        'id, kind, currency, status, team:teams!finance_books_owner_team_id_fkey(id, name, avatar_url)',
      )
      .eq('id', invite.book_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!book) throw new NotFoundException('Invite not found');

    let invitedBy: { id: string; display_name: string | null } | null = null;
    if (invite.invited_by) {
      const { data } = await this.supabase
        .from('profiles')
        .select('id, display_name')
        .eq('id', invite.invited_by)
        .maybeSingle();
      invitedBy = (data as { id: string; display_name: string | null }) ?? null;
    }

    return {
      invite: {
        id: invite.id,
        email: invite.email,
        finance_role: invite.finance_role,
        status,
        expires_at: invite.expires_at,
        created_at: invite.created_at,
      },
      book: book as unknown as FinanceInvitePreview['book'],
      invited_by: invitedBy,
    };
  }

  /**
   * Accept: membership row for the caller + invite flip, guarded against
   * double-settling. The unique (book_id, user_id) index makes a repeat
   * accept (or an accept by an existing member) a no-op, not an error.
   */
  async accept(
    callerId: string,
    token: string,
  ): Promise<{ book_id: string; finance_role: FinanceBookRole }> {
    const invite = await this.fetchByToken(token);
    const status = await this.effectiveStatus(invite);
    if (status !== 'pending') {
      throw new BadRequestException(`Invite is already ${status}`);
    }

    const { error: memberError } = await this.supabase
      .from('finance_book_members')
      .insert({
        book_id: invite.book_id,
        user_id: callerId,
        invited_email: invite.email,
        finance_role: invite.finance_role,
        capabilities: invite.capabilities ?? {},
        granted_by: invite.invited_by,
      });
    if (memberError && memberError.code !== '23505') {
      throw new Error(memberError.message);
    }

    const { data, error } = await this.supabase
      .from('finance_invites')
      .update({
        status: 'accepted',
        accepted_by: callerId,
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id)
      // Guard the read-modify-write: never flip a settled invite twice.
      .eq('status', 'pending')
      .select('*')
      .maybeSingle<FinanceInviteRow>();
    if (error) throw new Error(error.message);
    if (!data) throw new BadRequestException('Invite was already settled');

    return { book_id: invite.book_id, finance_role: invite.finance_role };
  }

  async decline(token: string): Promise<{ declined: true }> {
    const invite = await this.fetchByToken(token);
    const status = await this.effectiveStatus(invite);
    if (status !== 'pending') {
      throw new BadRequestException(`Invite is already ${status}`);
    }
    const { data, error } = await this.supabase
      .from('finance_invites')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', invite.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new BadRequestException('Invite was already settled');
    return { declined: true };
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async fetchByToken(token: string): Promise<FinanceInviteRow> {
    const { data, error } = await this.supabase
      .from('finance_invites')
      .select('*')
      .eq('token', token)
      .maybeSingle<FinanceInviteRow>();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Invite not found');
    return data;
  }

  /** Lazily expire a pending invite past its expiry. */
  private async effectiveStatus(
    invite: FinanceInviteRow,
  ): Promise<FinanceInviteRow['status']> {
    if (invite.status !== 'pending') return invite.status;
    if (new Date(invite.expires_at).getTime() >= Date.now()) return 'pending';
    const { error } = await this.supabase
      .from('finance_invites')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', invite.id)
      .eq('status', 'pending');
    if (error) {
      this.logger.warn(`Failed to lazily expire invite: ${error.message}`);
    }
    return 'expired';
  }

  private appUrl(): string {
    // APP_URL first, then CLIENT_URL — never a bare localhost default in prod.
    return (
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('CLIENT_URL', 'http://localhost:3000')
    );
  }

  /**
   * Best-effort mail: the invite row is already committed, so a failure is
   * reported back to the inviter, never thrown — the accept URL still works.
   */
  private async sendInviteEmail(payload: {
    to: string;
    role: FinanceBookRole;
    bookKind: string;
    acceptUrl: string;
    inviterId: string;
  }): Promise<SendMailResult> {
    try {
      if (await isEmailSuppressed(this.supabase, payload.to)) {
        return {
          sent: false,
          reason:
            'the recipient has unsubscribed from Proyekto emails — share the invite link with them directly',
        };
      }
      const { data } = await this.supabase
        .from('profiles')
        .select('display_name, email')
        .eq('id', payload.inviterId)
        .maybeSingle();
      const inviterName =
        (data as { display_name?: string | null; email?: string | null } | null)
          ?.display_name ?? 'Someone on Proyekto';
      const roleLabel = payload.role.replace('_', ' ');
      const bookLabel =
        payload.bookKind === 'project' ? 'project finance' : 'team finance';
      const subject = `${inviterName} invited you to a Proyekto finance book`;
      const text = `${inviterName} invited you as ${roleLabel} on their ${bookLabel} book on Proyekto.\n\nAccept the invitation: ${payload.acceptUrl}\n\nThis link expires in ${INVITE_EXPIRY_DAYS} days.`;
      const html = `<p>${inviterName} invited you as <strong>${roleLabel}</strong> on their ${bookLabel} book on Proyekto.</p><p><a href="${payload.acceptUrl}">Accept the invitation</a></p><p>This link expires in ${INVITE_EXPIRY_DAYS} days.</p>`;
      const unsubscribe = this.config.get<string>('MAIL_FROM_SUPPORT')?.trim();
      return await this.mailer.send({
        to: payload.to,
        sender: 'noreply',
        subject,
        html,
        text,
        headers: unsubscribe
          ? {
              'List-Unsubscribe': `<mailto:${unsubscribe}?subject=unsubscribe>`,
            }
          : undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`finance invite email failed: ${reason}`);
      return { sent: false, reason };
    }
  }
}
