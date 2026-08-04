import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { MailerService } from '../../../common/mail/mailer.service';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { isEmailSuppressed } from './email-suppression';
import { renderNotificationEmail } from './notification-email-registry';

/** Keep a run comfortably inside the platform request timeout. */
const RUN_SOFT_DEADLINE_MS = 20_000;
const CLAIM_BATCH_SIZE = 25;

/**
 * Minimum gap between two emails to the same person. A row inside the window is
 * DEFERRED, never dropped, so a burst of mentions arrives spread out.
 */
const MIN_INTERVAL_MINUTES = 15;

/**
 * Hard ceiling per run. Gmail's daily quota is shared with OTP and invoice mail,
 * so a bug here must not be able to burn it in one pass.
 */
const MAX_PER_RUN = 200;

/** Types whose "seen" signal is the chat room, not the notification bell. */
const CHAT_SOURCED_TYPES = new Set(['chat_mention', 'chat_dm_received']);

export interface DispatchRunResult {
  claimed: number;
  sent: number;
  skippedRows: number;
  deferred: number;
  failed: number;
}

interface OutboxRow {
  id: number;
  notification_id: string | null;
  user_id: string | null;
  type_name: string;
  to_email: string | null;
  payload: {
    content?: Record<string, unknown>;
    link_url?: string | null;
    project_id?: string | null;
    actor_id?: string | null;
    /**
     * Only on rows addressed to someone with no account. Their opt-out cannot
     * live in notification_email_settings, which is keyed on user_id.
     */
    unsubscribe_token?: string;
  } | null;
}

/**
 * Turns due outbox rows into email.
 *
 * The governing rule is that an outbox row is a CANDIDATE, not a promise. Every
 * gate below is re-evaluated here, at send time, rather than trusted from
 * enqueue time — between the two sits the whole delay window, during which the
 * recipient may have read the thing, opted out, or been suppressed.
 *
 * Mirrors KnowledgeIngestService: claim in batches via a SKIP LOCKED RPC, honour
 * a soft deadline, record failures in place, and let attempts dead-letter a row
 * that keeps failing.
 */
@Injectable()
export class NotificationEmailWorkerService {
  private readonly logger = new Logger(NotificationEmailWorkerService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * No env flag gates this on purpose. `notification_types.email_eligible` is
   * the single switch: it is per-type, it is the thing that decides whether a
   * row is ever enqueued, and flipping it takes effect immediately without a
   * deploy. A second flag here could only ever disagree with it.
   */
  async runDispatch(): Promise<DispatchRunResult> {
    const deadline = Date.now() + RUN_SOFT_DEADLINE_MS;
    const maxPerRun = MAX_PER_RUN;
    const totals: DispatchRunResult = {
      claimed: 0,
      sent: 0,
      skippedRows: 0,
      deferred: 0,
      failed: 0,
    };

    while (Date.now() < deadline && totals.sent < maxPerRun) {
      const { data, error } = (await this.db.rpc(
        'claim_notification_email_outbox',
        { p_batch: CLAIM_BATCH_SIZE },
      )) as { data: unknown; error: { message: string } | null };
      if (error) throw new Error(error.message);

      const rows = (Array.isArray(data) ? data : []) as OutboxRow[];
      if (rows.length === 0) break;
      totals.claimed += rows.length;

      for (const row of rows) {
        // Leave the rest of the claimed batch pending; the next run re-claims.
        if (Date.now() >= deadline || totals.sent >= maxPerRun) break;
        try {
          const outcome = await this.processRow(row);
          if (outcome === 'sent') totals.sent += 1;
          else if (outcome === 'deferred') totals.deferred += 1;
          else totals.skippedRows += 1;
        } catch (err) {
          totals.failed += 1;
          const message = (err as Error)?.message ?? 'unknown error';
          this.logger.warn(
            `notification_email failed row=${row.id} type=${row.type_name}: ${message}`,
          );
          await this.recordFailure(row.id, message);
        }
      }
    }

    if (totals.sent >= maxPerRun) {
      // Never silently truncate: a run that stops early looks identical to a
      // quiet run in the metrics unless it says so.
      this.logger.warn(
        `notification_email hit the per-run ceiling (${maxPerRun}); remaining rows stay pending`,
      );
    }

    return totals;
  }

  private async processRow(
    row: OutboxRow,
  ): Promise<'sent' | 'skipped' | 'deferred'> {
    // 1. Still unread? The whole point of the delay is that reading it in-app
    //    cancels the email.
    if (row.notification_id) {
      const { data: notification } = await this.db
        .from('notifications')
        .select('id, is_read, content, link_url, project_id, actor_id')
        .eq('id', row.notification_id)
        .maybeSingle();

      if (!notification)
        return this.resolve(row.id, 'skipped', 'notification_gone');
      if ((notification as { is_read?: boolean }).is_read) {
        return this.resolve(row.id, 'skipped', 'already_read');
      }
    }

    // 2. Chat has a better "seen" signal than the bell: the bell is not marked
    //    read on open, so is_read alone would mail someone who already read the
    //    message in the room.
    if (CHAT_SOURCED_TYPES.has(row.type_name) && row.user_id) {
      const roomId = row.payload?.content?.room_id;
      const messageId = row.payload?.content?.message_id;
      if (
        typeof roomId === 'string' &&
        (await this.hasReadRoom(
          roomId,
          row.user_id,
          typeof messageId === 'string' ? messageId : null,
        ))
      ) {
        return this.resolve(row.id, 'skipped', 'seen_in_app');
      }
    }

    // 3. Who are we mailing?
    const recipient = await this.resolveRecipient(row);
    if (!recipient) return this.resolve(row.id, 'skipped', 'no_address');

    // 4. Addresses we must not touch.
    if (await isEmailSuppressed(this.db, recipient.email)) {
      return this.resolve(row.id, 'skipped', 'suppressed');
    }

    // 5. Preferences. Absent rows mean "use the type default", so a user who
    //    never touched settings is governed by email_default_enabled.
    const settings = row.user_id
      ? await this.ensureSettings(row.user_id)
      : null;
    if (settings && !settings.all_email_enabled) {
      return this.resolve(row.id, 'skipped', 'opted_out_all');
    }
    if (
      row.user_id &&
      !(await this.typeEnabledFor(row.user_id, row.type_name))
    ) {
      return this.resolve(row.id, 'skipped', 'opted_out_type');
    }

    // 6. Can this build render it at all? Fail closed.
    const appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('CLIENT_URL') ??
      'http://localhost:3000';
    // A recipient with no account has no settings row to hold a token, so the
    // outbox row carries its own. Without this branch a stranger receives mail
    // with no unsubscribe link and no List-Unsubscribe header — the one case
    // where an opt-out is not optional.
    const unsubscribeUrl = settings
      ? this.unsubscribeUrl(settings.unsubscribe_token, row.type_name)
      : row.payload?.unsubscribe_token
        ? this.unsubscribeUrl(row.payload.unsubscribe_token, 'address')
        : null;

    if (!row.user_id && !unsubscribeUrl) {
      // Fail closed rather than mail someone who then cannot make it stop.
      return this.resolve(row.id, 'skipped', 'no_unsubscribe_token');
    }

    const email = renderNotificationEmail(row.type_name, {
      content: row.payload?.content ?? {},
      linkUrl: row.payload?.link_url ?? null,
      appUrl,
      unsubscribeUrl,
      recipientName: recipient.name,
    });
    if (!email) return this.resolve(row.id, 'skipped', 'no_template');

    // 7. Rate: one email per user per interval. Defer rather than drop, so a
    //    burst of mentions arrives spread out instead of vanishing.
    const deferUntil = await this.minIntervalDeferral(
      row.user_id,
      recipient.email,
    );
    if (deferUntil) {
      await this.db
        .from('notification_email_outbox')
        .update({ send_after: deferUntil.toISOString() })
        .eq('id', row.id);
      return 'deferred';
    }

    const result = await this.mailer.send({
      to: recipient.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      sender: 'noreply',
      headers: unsubscribeUrl
        ? {
            // RFC 8058: the https target must be paired with the Post header or
            // Gmail will not render its one-click button.
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined,
    });

    if (!result.sent) {
      // Leave it pending: attempts was already burned at claim time, so this
      // retries on later runs and dead-letters after p_max_attempts.
      await this.recordFailure(row.id, result.reason ?? 'send failed');
      throw new Error(result.reason ?? 'send failed');
    }

    await this.db
      .from('notification_email_outbox')
      .update({ status: 'sent', processed_at: new Date().toISOString() })
      .eq('id', row.id);
    return 'sent';
  }

  /**
   * Has this user read the room PAST the message that triggered the email?
   *
   * The comparison against the message timestamp is the whole point — merely
   * having opened the room once, months ago, must not suppress today's mention.
   */
  private async hasReadRoom(
    roomId: string,
    userId: string,
    messageId: string | null,
  ): Promise<boolean> {
    if (!messageId) return false;

    const [{ data: participant }, { data: message }] = await Promise.all([
      this.db
        .from('chat_room_participants')
        .select('last_read_at')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .maybeSingle(),
      this.db
        .from('chat_room_messages')
        .select('created_at')
        .eq('id', messageId)
        .maybeSingle(),
    ]);

    const lastRead = (participant as { last_read_at?: string | null })
      ?.last_read_at;
    const sentAt = (message as { created_at?: string | null })?.created_at;
    if (!lastRead || !sentAt) return false;

    return new Date(lastRead).getTime() >= new Date(sentAt).getTime();
  }

  private async resolveRecipient(
    row: OutboxRow,
  ): Promise<{ email: string; name: string | null } | null> {
    if (row.to_email) return { email: row.to_email, name: null };
    if (!row.user_id) return null;

    const { data } = await this.db
      .from('profiles')
      .select('email, display_name')
      .eq('id', row.user_id)
      .maybeSingle();

    const profile = data as {
      email?: string | null;
      display_name?: string | null;
    } | null;
    if (!profile?.email) return null;
    return { email: profile.email, name: profile.display_name ?? null };
  }

  /**
   * Settings row, created on first use. The token has to exist before the first
   * email goes out, and creating it lazily beats backfilling every profile.
   */
  private async ensureSettings(
    userId: string,
  ): Promise<{ all_email_enabled: boolean; unsubscribe_token: string } | null> {
    const { data: existing } = await this.db
      .from('notification_email_settings')
      .select('all_email_enabled, unsubscribe_token')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      return existing as {
        all_email_enabled: boolean;
        unsubscribe_token: string;
      };
    }

    const { data: created } = await this.db
      .from('notification_email_settings')
      .insert({ user_id: userId })
      .select('all_email_enabled, unsubscribe_token')
      .maybeSingle();
    return (
      (created as {
        all_email_enabled: boolean;
        unsubscribe_token: string;
      } | null) ?? null
    );
  }

  /** Per-type opt-in: an explicit row wins, otherwise the type's default. */
  private async typeEnabledFor(
    userId: string,
    typeName: string,
  ): Promise<boolean> {
    const { data: type } = await this.db
      .from('notification_types')
      .select('id, email_default_enabled')
      .eq('name', typeName)
      .maybeSingle();
    if (!type) return false;

    const typeRow = type as { id: string; email_default_enabled: boolean };
    const { data: pref } = await this.db
      .from('notification_preferences')
      .select('email_enabled')
      .eq('user_id', userId)
      .eq('type_id', typeRow.id)
      .maybeSingle();

    return pref
      ? Boolean((pref as { email_enabled: boolean }).email_enabled)
      : typeRow.email_default_enabled;
  }

  /**
   * When this recipient was mailed too recently, the timestamp to defer to;
   * null when it is fine to send now.
   *
   * Keyed on the user when there is one, and otherwise on the ADDRESS. Without
   * the address branch a recipient with no account gets no spacing at all — ten
   * mentions of the same stranger would send ten emails back to back, which is
   * precisely the person least able to tolerate it.
   */
  private async minIntervalDeferral(
    userId: string | null,
    toEmail: string | null,
  ): Promise<Date | null> {
    const minutes = MIN_INTERVAL_MINUTES;
    if (minutes <= 0) return null;
    if (!userId && !toEmail) return null;

    let query = this.db
      .from('notification_email_outbox')
      .select('processed_at')
      .eq('status', 'sent');

    query = userId
      ? query.eq('user_id', userId)
      : query.eq('to_email', (toEmail as string).toLowerCase());

    const { data } = await query
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const last = (data as { processed_at?: string | null })?.processed_at;
    if (!last) return null;

    const nextAllowed = new Date(new Date(last).getTime() + minutes * 60_000);
    return nextAllowed.getTime() > Date.now() ? nextAllowed : null;
  }

  private unsubscribeUrl(token: string, typeName: string): string {
    const apiUrl = (
      this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3001/api'
    ).replace(/\/+$/, '');
    const params = new URLSearchParams({ token, scope: typeName });
    return `${apiUrl}/notifications/unsubscribe?${params.toString()}`;
  }

  private async resolve(
    id: number,
    status: 'skipped',
    reason: string,
  ): Promise<'skipped'> {
    await this.db
      .from('notification_email_outbox')
      .update({
        status,
        skip_reason: reason,
        processed_at: new Date().toISOString(),
      })
      .eq('id', id);
    return 'skipped';
  }

  private async recordFailure(id: number, message: string): Promise<void> {
    await this.db
      .from('notification_email_outbox')
      .update({ last_error: message.slice(0, 500) })
      .eq('id', id);
  }
}
