import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import {
  EmailVerificationConfirmDto,
  EmailVerificationPurpose,
  EmailVerificationRequestDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/email-auth.dto';

const OTP_TTL_MINUTES = 10;
const OTP_CODE_LENGTH = 6;

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
  ) {}

  async requestEmailVerification(dto: EmailVerificationRequestDto) {
    const email = this.normalizeEmail(dto.email);
    const code = this.generateNumericCode(OTP_CODE_LENGTH);
    const salt = this.generateSalt();
    const codeHash = this.hashCode(salt, code);
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(
      Date.now() + OTP_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    await this.consumeActiveVerificationCodes(email, dto.purpose, nowIso);

    const { error: insertError } = await this.supabase
      .from('email_verification_codes')
      .insert({
        email,
        code_hash: codeHash,
        salt,
        purpose: dto.purpose,
        expires_at: expiresAtIso,
      });

    if (insertError) {
      this.logger.error(
        `Failed to persist email verification code for ${email}: ${insertError.message}`,
      );
      throw new InternalServerErrorException(
        'Could not create verification code.',
      );
    }

    try {
      await this.sendGmailHtml({
        to: email,
        subject: `Verify Your Email - Code: ${code}`,
        html: this.buildVerificationHtml(dto.firstName, code),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InternalServerErrorException(
        'Failed to send verification email.',
      );
    }

    return { success: true, message: 'Verification code sent.' };
  }

  async confirmEmailVerification(dto: EmailVerificationConfirmDto) {
    const email = this.normalizeEmail(dto.email);
    const nowIso = new Date().toISOString();

    const { data: row, error: lookupError } = await this.supabase
      .from('email_verification_codes')
      .select('id, code_hash, salt, expires_at, consumed_at')
      .eq('email', email)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      this.logger.error(
        `Verification lookup failed for ${email}: ${lookupError.message}`,
      );
      throw new InternalServerErrorException('Verification failed.');
    }

    if (!row) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    const submittedHash = this.hashCode(row.salt, dto.code);
    if (submittedHash !== row.code_hash) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    const { error: consumeError } = await this.supabase
      .from('email_verification_codes')
      .update({ consumed_at: nowIso })
      .eq('id', row.id);

    if (consumeError) {
      this.logger.error(
        `Failed to consume verification code ${row.id}: ${consumeError.message}`,
      );
      throw new InternalServerErrorException('Verification failed.');
    }

    const { data: profileRow, error: profileLookupError } = await this.supabase
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (profileLookupError || !profileRow?.id) {
      throw new BadRequestException('Account not found for this email.');
    }

    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ is_email_verified: true })
      .eq('id', profileRow.id);

    if (updateError) {
      this.logger.error(
        `Failed to update is_email_verified for ${email}: ${updateError.message}`,
      );
      throw new InternalServerErrorException('Verification failed.');
    }

    return { success: true, message: 'Email verified successfully.' };
  }

  async requestPasswordReset(dto: PasswordResetRequestDto) {
    const email = this.normalizeEmail(dto.email);
    const nowIso = new Date().toISOString();
    const userId = await this.resolveUserIdByEmail(email);

    // Do not reveal account existence to callers.
    if (!userId) {
      return {
        success: true,
        message: 'If an account exists, a reset code has been sent.',
      };
    }

    const code = this.generateNumericCode(OTP_CODE_LENGTH);
    const salt = this.generateSalt();
    const codeHash = this.hashCode(salt, code);

    const { error: consumeError } = await this.supabase
      .from('password_resets')
      .update({ consumed_at: nowIso })
      .eq('email', email)
      .is('consumed_at', null)
      .gt('expires_at', nowIso);

    if (consumeError) {
      this.logger.warn(
        `Failed to consume previous password reset rows for ${email}: ${consumeError.message}`,
      );
    }

    const { error: insertError } = await this.supabase
      .from('password_resets')
      .insert({
        email,
        user_id: userId,
        code_hash: codeHash,
        salt,
      });

    if (insertError) {
      this.logger.error(
        `Failed to persist password reset code for ${email}: ${insertError.message}`,
      );
      throw new InternalServerErrorException('Could not create reset code.');
    }

    try {
      await this.sendGmailHtml({
        to: email,
        subject: `Reset Your Password - Code: ${code}`,
        html: this.buildPasswordResetHtml(code),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InternalServerErrorException('Failed to send reset code.');
    }

    return {
      success: true,
      message: 'If an account exists, a reset code has been sent.',
    };
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto) {
    const email = this.normalizeEmail(dto.email);
    const nowIso = new Date().toISOString();

    const { data: resetRow, error: lookupError } = await this.supabase
      .from('password_resets')
      .select('id, user_id, code_hash, salt, expires_at')
      .eq('email', email)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      this.logger.error(
        `Password reset lookup failed for ${email}: ${lookupError.message}`,
      );
      throw new InternalServerErrorException('Reset failed.');
    }

    if (!resetRow) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    const submittedHash = this.hashCode(resetRow.salt, dto.code);
    if (submittedHash !== resetRow.code_hash) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    const userId = resetRow.user_id || (await this.resolveUserIdByEmail(email));
    if (!userId) {
      throw new BadRequestException('Account not found for this email.');
    }

    const { error: updatePasswordError } =
      await this.supabase.auth.admin.updateUserById(userId, {
        password: dto.newPassword,
      });

    if (updatePasswordError) {
      this.logger.error(
        `Failed to update password for ${email}: ${updatePasswordError.message}`,
      );
      throw new BadRequestException(updatePasswordError.message);
    }

    const { error: consumeError } = await this.supabase
      .from('password_resets')
      .update({ consumed_at: nowIso })
      .eq('id', resetRow.id);

    if (consumeError) {
      this.logger.error(
        `Failed to consume password reset row ${resetRow.id}: ${consumeError.message}`,
      );
      throw new InternalServerErrorException('Reset failed.');
    }

    return { success: true, message: 'Password updated successfully.' };
  }

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private generateSalt() {
    return randomBytes(16).toString('hex');
  }

  private generateNumericCode(length: number) {
    const max = 10 ** length;
    const min = 10 ** (length - 1);
    return Math.floor(min + Math.random() * (max - min)).toString();
  }

  private hashCode(salt: string, code: string) {
    return createHash('sha256').update(`${salt}|${code}`).digest('hex');
  }

  private async consumeActiveVerificationCodes(
    email: string,
    purpose: EmailVerificationPurpose,
    consumedAtIso: string,
  ) {
    const { error } = await this.supabase
      .from('email_verification_codes')
      .update({ consumed_at: consumedAtIso })
      .eq('email', email)
      .eq('purpose', purpose)
      .is('consumed_at', null)
      .gt('expires_at', consumedAtIso);

    if (error) {
      this.logger.warn(
        `Failed to consume previous verification rows for ${email}: ${error.message}`,
      );
    }
  }

  private async resolveUserIdByEmail(email: string): Promise<string | null> {
    const { data: profileRow, error: profileError } = await this.supabase
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (!profileError && profileRow?.id) {
      return profileRow.id as string;
    }

    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseUrl = this.config.get<string>('SUPABASE_URL') ?? '';
    if (!serviceRoleKey || !supabaseUrl) {
      return null;
    }

    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      },
    );

    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as
      | { users?: Array<{ id?: string }> }
      | Array<{ id?: string }>
      | null;

    const users = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.users)
        ? payload.users
        : [];
    const firstId = users[0]?.id;
    return typeof firstId === 'string' && firstId.length > 0 ? firstId : null;
  }

  private async fetchGmailAccessToken(): Promise<string> {
    const clientId = this.config.getOrThrow<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.config.getOrThrow<string>('GMAIL_REFRESH_TOKEN');

    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Failed to exchange Gmail refresh token (status ${response.status}): ${text}`,
      );
    }

    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error('Gmail token response missing access_token');
    }

    return json.access_token;
  }

  private async sendGmailHtml(params: {
    to: string;
    subject: string;
    html: string;
  }) {
    const accessToken = await this.fetchGmailAccessToken();
    const fromEmail = this.config.get<string>('GMAIL_FROM_EMAIL')?.trim();

    const headers = [
      fromEmail ? `From: Proyekto <${fromEmail}>` : null,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
    ]
      .filter(Boolean)
      .join('\r\n');

    const mime = `${headers}\r\n\r\n${params.html}`;
    const raw = Buffer.from(mime)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Gmail API send failed (status ${response.status}): ${text}`,
      );
    }
  }

  private buildVerificationHtml(firstName: string, code: string) {
    const safeFirstName = firstName?.trim() || 'there';
    return `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
        <h2 style="margin:0 0 16px;">Verify Your Email</h2>
        <p style="margin:0 0 12px;">Hi ${safeFirstName},</p>
        <p style="margin:0 0 16px;">Use this 6-digit code to verify your Proyekto account:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px;margin:0 0 16px;">${code}</p>
        <p style="margin:0;color:#6B7280;">This code expires in ${OTP_TTL_MINUTES} minutes.</p>
      </div>
    `;
  }

  private buildPasswordResetHtml(code: string) {
    return `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
        <h2 style="margin:0 0 16px;">Reset Your Password</h2>
        <p style="margin:0 0 16px;">Use this 6-digit code to reset your Proyekto password:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px;margin:0 0 16px;">${code}</p>
        <p style="margin:0;color:#6B7280;">This code expires in ${OTP_TTL_MINUTES} minutes.</p>
      </div>
    `;
  }
}
