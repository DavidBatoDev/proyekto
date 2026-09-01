import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { DevicePlatform, RegisterDeviceTokenDto } from './dto/device-token.dto';

export interface DeviceTokenRow {
  token: string;
  platform: DevicePlatform;
}

export interface OwnedDeviceTokenRow extends DeviceTokenRow {
  user_id: string;
}

/**
 * PostgREST puts `.in()` values in the query string, so a very large room would
 * build a URL long enough to be rejected. Chunk well below that.
 */
const USER_CHUNK = 200;

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

  /**
   * Tokens for many users in one round trip, grouped by user.
   *
   * The chat push path fans out to a whole room on every message, so calling
   * `getTokensForUser` per recipient would be an N+1 on an awaited request.
   * Best-effort like its sibling: a query failure yields an empty map rather
   * than throwing into the send that triggered it.
   */
  async getTokensForUsers(
    userIds: string[],
  ): Promise<Map<string, DeviceTokenRow[]>> {
    const grouped = new Map<string, DeviceTokenRow[]>();
    const unique = Array.from(new Set(userIds));
    if (unique.length === 0) return grouped;

    for (let i = 0; i < unique.length; i += USER_CHUNK) {
      const chunk = unique.slice(i, i + USER_CHUNK);
      const { data, error } = await this.supabase
        .from('device_tokens')
        .select('user_id, token, platform')
        .in('user_id', chunk);

      if (error) {
        this.logger.warn(`getTokensForUsers failed: ${error.message}`);
        continue;
      }

      for (const row of (data ?? []) as OwnedDeviceTokenRow[]) {
        const list = grouped.get(row.user_id);
        if (list) list.push({ token: row.token, platform: row.platform });
        else
          grouped.set(row.user_id, [
            { token: row.token, platform: row.platform },
          ]);
      }
    }

    return grouped;
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
