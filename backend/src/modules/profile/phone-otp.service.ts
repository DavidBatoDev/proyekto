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
import { SMS_PROVIDER, type ISmsProvider } from './sms/sms.provider.interface';

const OTP_TTL_MINUTES = 10;
const OTP_CODE_LENGTH = 6;

@Injectable()
export class PhoneOtpService {
  private readonly logger = new Logger(PhoneOtpService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    @Inject(SMS_PROVIDER) private readonly smsProvider: ISmsProvider,
    private readonly config: ConfigService,
  ) {}

  async requestPhoneVerification(userId: string) {
    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('phone_number')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.phone_number) {
      throw new BadRequestException(
        'No phone number on file. Please add a phone number to your profile first.',
      );
    }

    const phone = profile.phone_number as string;
    const code = this.generateNumericCode(OTP_CODE_LENGTH);
    const salt = this.generateSalt();
    const codeHash = this.hashCode(salt, code);
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(
      Date.now() + OTP_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    // Consume any active codes for this user before issuing a new one
    await this.supabase
      .from('phone_verification_codes')
      .update({ consumed_at: nowIso })
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gt('expires_at', nowIso);

    const { error: insertError } = await this.supabase
      .from('phone_verification_codes')
      .insert({
        user_id: userId,
        phone_number: phone,
        code_hash: codeHash,
        salt,
        expires_at: expiresAtIso,
      });

    if (insertError) {
      this.logger.error(
        `Failed to persist phone verification code for user ${userId}: ${insertError.message}`,
      );
      throw new InternalServerErrorException(
        'Could not create verification code.',
      );
    }

    try {
      await this.smsProvider.sendSms(
        phone,
        `Your Proyekto verification code is: ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send SMS to ${phone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InternalServerErrorException('Failed to send verification SMS.');
    }

    const isNonProd = this.config.get<string>('NODE_ENV') !== 'production';
    return {
      success: true,
      message: 'Verification code sent.',
      ...(isNonProd && { debug_code: code }),
    };
  }

  async confirmPhoneVerification(userId: string, code: string) {
    const nowIso = new Date().toISOString();

    const { data: row, error: lookupError } = await this.supabase
      .from('phone_verification_codes')
      .select('id, code_hash, salt, expires_at, consumed_at')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      this.logger.error(
        `Verification lookup failed for user ${userId}: ${lookupError.message}`,
      );
      throw new InternalServerErrorException('Verification failed.');
    }

    if (!row) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    const submittedHash = this.hashCode(row.salt as string, code);
    if (submittedHash !== row.code_hash) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    const { error: consumeError } = await this.supabase
      .from('phone_verification_codes')
      .update({ consumed_at: nowIso })
      .eq('id', row.id);

    if (consumeError) {
      this.logger.error(
        `Failed to consume phone verification code ${row.id}: ${consumeError.message}`,
      );
      throw new InternalServerErrorException('Verification failed.');
    }

    // Upsert verified status into user_verifications
    const { error: upsertError } = await this.supabase
      .from('user_verifications')
      .upsert(
        {
          user_id: userId,
          type: 'phone',
          status: 'verified',
          verified_at: nowIso,
        },
        { onConflict: 'user_id,type' },
      );

    if (upsertError) {
      this.logger.error(
        `Failed to mark phone as verified for user ${userId}: ${upsertError.message}`,
      );
      throw new InternalServerErrorException('Verification failed.');
    }

    return { success: true, message: 'Phone number verified successfully.' };
  }

  private generateNumericCode(length: number): string {
    let code = '';
    while (code.length < length) {
      const byte = randomBytes(1)[0];
      if (byte < 250) {
        code += (byte % 10).toString();
      }
    }
    return code;
  }

  private generateSalt(): string {
    return randomBytes(16).toString('hex');
  }

  private hashCode(salt: string, code: string): string {
    return createHash('sha256').update(salt + code).digest('hex');
  }
}
