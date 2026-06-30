import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { DevicePlatform, RegisterDeviceTokenDto } from './dto/device-token.dto';

export interface DeviceTokenRow {
  token: string;
  platform: DevicePlatform;
}

/**
 * Owns the `device_tokens` table. Registration goes through the authenticated
 * backend endpoint (service-role writes), so a token row's `user_id` is always
 * a real profile id. A token is globally UNIQUE; upserting on conflict reassigns
 * a re-used device to the current user and refreshes `last_seen_at`, which both
 * prevents duplicate rows and keeps multi-device support (many rows per user).
 */
@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async register(
    userId: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<{ registered: boolean }> {
    const { error } = await this.supabase.from('device_tokens').upsert(
      {
        user_id: userId,
        token: dto.token,
        platform: dto.platform,
        device_id: dto.device_id ?? null,
        app_version: dto.app_version ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { registered: true };
  }

  async unregister(
    userId: string,
    token: string,
  ): Promise<{ unregistered: boolean }> {
    const { error } = await this.supabase
      .from('device_tokens')
      .delete()
      .eq('token', token)
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { unregistered: true };
  }

  /**
   * Tokens for a user. Best-effort: returns [] on error so the push path never
   * throws into the notification-creation request.
   */
  async getTokensForUser(userId: string): Promise<DeviceTokenRow[]> {
    const { data, error } = await this.supabase
      .from('device_tokens')
      .select('token, platform')
      .eq('user_id', userId);

    if (error) {
      this.logger.warn(`getTokensForUser failed: ${error.message}`);
      return [];
    }

    return (data ?? []) as DeviceTokenRow[];
  }

  /** Remove tokens FCM reported as dead. Best-effort. */
  async pruneTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    const { error } = await this.supabase
      .from('device_tokens')
      .delete()
      .in('token', tokens);

    if (error) {
      this.logger.warn(`pruneTokens failed: ${error.message}`);
    }
  }
}
