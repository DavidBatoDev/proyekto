import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { MailerService } from '../../../common/mail/mailer.service';
import {
  renderCodeBlock,
  renderEmailLayout,
  renderParagraph,
} from '../../../common/mail/templates/layout';
import { renderTextEmail } from '../../../common/mail/templates/text';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';

const CODE_TTL_MINUTES = 10;
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;

/**
 * Proves the person driving an irreversible action is the account holder and
 * not a borrowed session.
 *
 * Two paths, because the product has two kinds of account:
 *
 *  - password accounts re-enter their password;
 *  - accounts created through Google have an empty
 *    `auth.users.encrypted_password`, so there is nothing to re-enter. They get
 *    a code mailed to the address on the account instead.
 *
 * The code path deliberately does NOT reuse `/api/auth/email-verification/*`.
 * All four of those routes are `@Public()` and take the address from the
 * request body, so anyone who knows an email could drive them with no session;
 * their CHECK allows only `purpose IN ('signup','login')`; and
 * `confirmEmailVerification` looks a code up with no purpose filter, which
 * would let a signup code confirm an account deletion. This uses its own
 * authenticated, user-id-keyed table.
 */
@Injectable()
export class AccountReauthService {
  private readonly logger = new Logger(AccountReauthService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Mail a fresh code. Returns when the mail has been handed to the transport;
   * `MailerService` never throws, so a dead transport surfaces as `sent: false`
   * and is logged rather than failing the request.
   */
  async issueChallenge(
    userId: string,
    email: string,
  ): Promise<{ sent: boolean; expires_at: string }> {
    const code = this.generateNumericCode(CODE_LENGTH);
    const salt = randomBytes(16).toString('hex');
    const expiresAt = new Date(
      Date.now() + CODE_TTL_MINUTES * 60_000,
    ).toISOString();

    // Retire any outstanding code first, so a second request invalidates the
    // first rather than leaving two live codes.
    await this.supabase
      .from('account_deletion_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('consumed_at', null);

    const { error } = await this.supabase
      .from('account_deletion_challenges')
      .insert({
        user_id: userId,
        code_hash: this.hashCode(salt, code),
        salt,
        expires_at: expiresAt,
      });
    if (error) throw new Error(error.message);

    const built = this.buildEmail(code);
    const result = await this.mailer.send({
      to: email,
      subject: 'Confirm you want to delete your Proyekto account',
      html: built.html,
      text: built.text,
      sender: 'accounts',
    });

    if (!result.sent) {
      this.logger.error(
        `Account-deletion code could not be delivered to ${email}: ${result.reason ?? 'unknown'}`,
      );
    }

    return { sent: result.sent, expires_at: expiresAt };
  }

  /**
   * Throws `UnauthorizedException` unless the supplied credential checks out.
   * Never reveals which of the two was wrong beyond what the user needs.
   */
  async verify(
    userId: string,
    email: string,
    input: { password?: string; code?: string },
  ): Promise<void> {
    const hasPassword = Boolean(input.password);
    const hasCode = Boolean(input.code);

    if (hasPassword === hasCode) {
      throw new UnauthorizedException(
        'Enter your password, or the code we emailed you, to continue.',
      );
    }

    if (hasPassword) {
      await this.verifyPassword(email, input.password as string);
      return;
    }
    await this.verifyCode(userId, input.code as string);
  }

  /**
   * A raw call against GoTrue rather than `signInWithPassword` on the injected
   * client: `SUPABASE_CLIENT` is a `@Global()` singleton with default session
   * persistence, so signing in on it would stamp this user's session onto every
   * other request in the process. Same raw-fetch idiom as
   * `email-otp.service.ts` uses for the admin users endpoint. The tokens that
   * come back are discarded -- the sessions they belong to are deleted minutes
   * later by `delete_account` anyway.
   */
  private async verifyPassword(email: string, password: string): Promise<void> {
    const url = this.config.get<string>('SUPABASE_URL') ?? '';
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY') ?? '';
    if (!url || !anonKey) {
      throw new Error('Supabase is not configured for password verification.');
    }

    let ok = false;
    try {
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      ok = response.ok;
    } catch (error) {
      this.logger.error(
        `Password re-check could not reach GoTrue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new Error('Could not verify your password. Try again.');
    }

    if (!ok) {
      throw new UnauthorizedException('That password does not match.');
    }
  }

  private async verifyCode(userId: string, code: string): Promise<void> {
    const nowIso = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('account_deletion_challenges')
      .select('id, code_hash, salt, attempts')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new UnauthorizedException(
        'That code has expired. Ask for a new one.',
      );
    }

    const row = data as {
      id: string;
      code_hash: string;
      salt: string;
      attempts: number;
    };

    if (row.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts. Ask for a new code.');
    }

    if (this.hashCode(row.salt, code) !== row.code_hash) {
      await this.supabase
        .from('account_deletion_challenges')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id);
      throw new UnauthorizedException('That code is not right.');
    }

    await this.supabase
      .from('account_deletion_challenges')
      .update({ consumed_at: nowIso })
      .eq('id', row.id);
  }

  private hashCode(salt: string, code: string): string {
    return createHash('sha256').update(`${salt}|${code}`).digest('hex');
  }

  private generateNumericCode(length: number): string {
    const max = 10 ** length;
    const min = 10 ** (length - 1);
    return Math.floor(min + Math.random() * (max - min)).toString();
  }

  private buildEmail(code: string) {
    return {
      html: renderEmailLayout({
        preheader: `Your Proyekto account deletion code is ${code}.`,
        title: 'Confirm account deletion',
        bodyHtml: [
          renderParagraph(
            'Someone asked to permanently delete your Proyekto account. Use this code to confirm:',
          ),
          renderCodeBlock(code),
          renderParagraph(
            `This code expires in ${CODE_TTL_MINUTES} minutes. Deleting an account cannot be undone. If this was not you, ignore this email and change your password — your account will not be touched.`,
          ),
        ].join('\n'),
        footerNote:
          'You received this email because someone asked to delete the Proyekto account registered to this address.',
      }),
      text: renderTextEmail([
        'Someone asked to permanently delete your Proyekto account.',
        '',
        'Use this code to confirm:',
        code,
        '',
        `This code expires in ${CODE_TTL_MINUTES} minutes.`,
        'Deleting an account cannot be undone.',
        'If this was not you, ignore this email and change your password.',
      ]),
    };
  }
}
