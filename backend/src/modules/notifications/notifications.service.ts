import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { buildPushMessage } from '../push/notification-push';
import { PushService } from '../push/push.service';
import {
  CreateNotificationDto,
  MarkNotificationReadDto,
  NotificationsQueryDto,
} from './dto/notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  async listForUser(userId: string, query: NotificationsQueryDto) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    let dbQuery = this.supabase
      .from('notifications')
      .select(
        'id, user_id, project_id, actor_id, content, is_read, read_at, link_url, created_at, updated_at, type:notification_types(id, name, category, priority)',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.project_id) {
      dbQuery = dbQuery.eq('project_id', query.project_id);
    }

    if (query.is_read !== undefined) {
      dbQuery = dbQuery.eq('is_read', query.is_read === 'true');
    }

    const { data, error } = await dbQuery;

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data || [];
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { unread: count ?? 0 };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
    payload?: MarkNotificationReadDto,
  ) {
    const isRead = payload?.is_read ? payload.is_read === 'true' : true;
    const readAt = isRead ? new Date().toISOString() : null;

    const { data, error } = await this.supabase
      .from('notifications')
      .update({ is_read: isRead, read_at: readAt })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select('id, is_read, read_at, updated_at')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Notification not found.',
      );
    }

    return data;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { updated: data?.length || 0 };
  }

  async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<{ deleted: boolean }> {
    const { error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { deleted: true };
  }

  async createNotification(payload: CreateNotificationDto) {
    const { data: type, error: typeError } = await this.supabase
      .from('notification_types')
      .select('id')
      .eq('name', payload.type_name)
      .single();

    if (typeError || !type) {
      throw new BadRequestException(
        typeError?.message || `Unknown notification type: ${payload.type_name}`,
      );
    }

    const { data, error } = await this.supabase
      .from('notifications')
      .insert({
        user_id: payload.user_id,
        project_id: payload.project_id || null,
        type_id: (type as { id: string }).id,
        actor_id: payload.actor_id || null,
        content: payload.content || {},
        link_url: payload.link_url || null,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Failed to create notification.',
      );
    }

    // Best-effort FCM push to the recipient's devices. The in-app row above is
    // the source of truth; push is fired with a bounded timeout and never
    // rethrows, so a delivery failure can't block or break the action that
    // created the notification. (Bounded await rather than a detached promise
    // because Cloud Run may freeze instance CPU once the response is sent.)
    await this.sendPush(payload, data.id as string);

    return data;
  }

  private async sendPush(
    payload: CreateNotificationDto,
    notificationId: string,
  ): Promise<void> {
    const timeoutMs = this.config.get<number>('PUSH_SEND_TIMEOUT_MS', 1500);
    const message = buildPushMessage({
      notificationId,
      typeName: payload.type_name,
      content: payload.content,
      linkUrl: payload.link_url,
      projectId: payload.project_id,
    });

    try {
      await Promise.race([
        this.push.sendToUser(payload.user_id, message),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } catch (err) {
      this.logger.warn(`push send failed: ${(err as Error)?.message}`);
    }
  }
}
