import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { EMAILABLE_NOTIFICATION_TYPES } from './notification-email-registry';
import type { UpdateNotificationPreferencesDto } from '../dto/notification-email.dto';

export interface NotificationPreferencesView {
  all_email_enabled: boolean;
  types: { type_name: string; email_enabled: boolean }[];
}

/**
 * Per-user email preferences and the unsubscribe capability.
 *
 * Reads and writes go through the service-role client rather than the user's
 * own session: `notification_email_settings` holds the unsubscribe token, and a
 * SELECT policy broad enough for the client to manage its own row would also
 * expose that token to anything holding the session.
 */
@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async getForUser(userId: string): Promise<NotificationPreferencesView> {
    const settings = await this.ensureSettings(userId);

    const { data: types } = await this.db
      .from('notification_types')
      .select('id, name, email_default_enabled')
      .in('name', [...EMAILABLE_NOTIFICATION_TYPES]);

    const { data: prefs } = await this.db
      .from('notification_preferences')
      .select('type_id, email_enabled')
      .eq('user_id', userId);

    const overrides = new Map(
      ((prefs ?? []) as { type_id: string; email_enabled: boolean }[]).map(
        (row) => [row.type_id, row.email_enabled],
      ),
    );

    return {
      all_email_enabled: settings?.all_email_enabled ?? true,
      types: (
        (types ?? []) as {
          id: string;
          name: string;
          email_default_enabled: boolean;
        }[]
      ).map((type) => ({
        type_name: type.name,
        // Absent override means "use the type default" — the same resolution
        // the worker applies, kept in one shape so the settings screen cannot
        // disagree with what actually gets sent.
        email_enabled: overrides.get(type.id) ?? type.email_default_enabled,
      })),
    };
  }

  async updateForUser(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesView> {
    await this.ensureSettings(userId);

    if (dto.all_email_enabled !== undefined) {
      await this.db
        .from('notification_email_settings')
        .update({
          all_email_enabled: dto.all_email_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    for (const entry of dto.types ?? []) {
      const typeId = await this.typeIdFor(entry.type_name);
      // Ignore unknown names rather than 400: a stale settings screen naming a
      // removed type should not block the rest of the update.
      if (!typeId) continue;

      await this.db.from('notification_preferences').upsert(
        {
          user_id: userId,
          type_id: typeId,
          email_enabled: entry.email_enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,type_id' },
      );
    }

    return this.getForUser(userId);
  }

  /**
   * Apply an unsubscribe token.
   *
   * Always resolves, even for an unknown token: the caller returns 200
   * regardless, so a token probe cannot distinguish valid from invalid.
   */
  async unsubscribeByToken(token: string, scope?: string): Promise<void> {
    // A recipient with no account cannot have a settings row, so their token
    // lives on the pending-mention record and its only meaningful action is to
    // suppress the address outright. Checked first: these are the people with
    // the least patience for an opt-out that does not work.
    if (scope === 'address') {
      const { data: pending } = await this.db
        .from('pending_mention_invites')
        .select('invitee_email')
        .eq('unsubscribe_token', token)
        .maybeSingle();

      const email = (pending as { invitee_email?: string } | null)
        ?.invitee_email;
      if (!email) return;

      await this.db.from('email_suppressions').upsert(
        {
          email: email.toLowerCase(),
          reason: 'manual',
          detail: 'unsubscribed from a mention invite',
        },
        { onConflict: 'email' },
      );
      return;
    }

    const { data } = await this.db
      .from('notification_email_settings')
      .select('user_id')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    const userId = (data as { user_id?: string } | null)?.user_id;
    if (!userId) return;

    const wantsAll = !scope || scope === 'all';
    if (wantsAll) {
      await this.db
        .from('notification_email_settings')
        .update({
          all_email_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      return;
    }

    const typeId = await this.typeIdFor(scope);
    if (!typeId) return;

    await this.db.from('notification_preferences').upsert(
      {
        user_id: userId,
        type_id: typeId,
        email_enabled: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,type_id' },
    );
  }

  private async typeIdFor(typeName: string): Promise<string | null> {
    const { data } = await this.db
      .from('notification_types')
      .select('id')
      .eq('name', typeName)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  }

  /** Settings row, created on first read so the token always exists. */
  private async ensureSettings(
    userId: string,
  ): Promise<{ all_email_enabled: boolean } | null> {
    const { data: existing } = await this.db
      .from('notification_email_settings')
      .select('all_email_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) return existing as { all_email_enabled: boolean };

    const { data: created, error } = await this.db
      .from('notification_email_settings')
      .insert({ user_id: userId })
      .select('all_email_enabled')
      .maybeSingle();

    if (error) {
      this.logger.warn(
        `could not create notification_email_settings for ${userId}: ${error.message}`,
      );
      return null;
    }
    return created as { all_email_enabled: boolean } | null;
  }
}
