import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { DeviceTokensService } from './device-tokens.service';

export interface PushMessage {
  title: string;
  body: string;
  /** FCM data must be string -> string; carries type, ids, and deep-link. */
  data?: Record<string, string>;
  /**
   * Conversation key, used for GROUPING only — never collapsing.
   *
   * Deliberately not Android `tag` or `apns-collapse-id`: both REPLACE the
   * previous notification for the key, so a three-message burst would leave one
   * tray row and silently lose the first two unless the body carried an
   * "N new messages" count. Getting that count right means a per-recipient
   * unread query on the awaited send path. Stacking instead costs nothing,
   * loses nothing, and still groups: iOS bundles by `thread-id`, and Android
   * bundles same-app notifications on its own.
   */
  threadKey?: string;
  /**
   * Android notification channel id.
   *
   * A channel the shell has not created makes Android 8+ drop the notification
   * SILENTLY, so this is only ever set from configuration — never guessed.
   */
  channelId?: string;
  /** App icon badge. Omitted rather than zeroed when unknown. */
  badge?: number;
}

/** One recipient and the payload built for them (badges differ per person). */
export interface PushTarget {
  userId: string;
  message: PushMessage;
}

/** FCM caps a single sendEach batch. */
const FCM_BATCH_LIMIT = 500;

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Sends FCM push notifications via firebase-admin.
 *
 * The Admin app is initialised lazily from FIREBASE_* env. When those are unset
 * (local dev, CI, tests) every send is a silent no-op, so push can never break
 * notification creation and the rest of the backend runs unchanged.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private app: admin.app.App | null = null;
  private initAttempted = false;

  constructor(
    private readonly config: ConfigService,
    private readonly deviceTokens: DeviceTokensService,
  ) {}

  private getApp(): admin.app.App | null {
    if (this.initAttempted) return this.app;
    this.initAttempted = true;

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const rawKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');
    const useAdc = ['1', 'true', 'yes'].includes(
      (this.config.get<string>('FIREBASE_USE_ADC') ?? '').toLowerCase(),
    );

    let credential: admin.credential.Credential | null = null;
    let mode = '';

    if (clientEmail && rawKey) {
      // Service-account key. Secret managers / .env store the PEM as a single
      // line with literal "\n"; firebase-admin needs real newlines or it throws
      // "PEM routines".
      credential = admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: rawKey.replace(/\\n/g, '\n'),
      });
      mode = 'service-account key';
    } else if (useAdc && projectId) {
      // Keyless: Application Default Credentials — Workload Identity on Cloud Run
      // (attached runtime SA) or `gcloud auth application-default login` locally.
      // projectId targets the Firebase project even when the ADC identity belongs
      // to a different GCP project (cross-project send).
      try {
        credential = admin.credential.applicationDefault();
        mode = 'application default credentials';
      } catch (err) {
        this.logger.error(
          `FCM disabled: ADC unavailable (${(err as Error)?.message}). Run \`gcloud auth application-default login\` or attach a runtime SA.`,
        );
        return null;
      }
    }

    if (!credential || !projectId) {
      this.logger.warn(
        'FCM push disabled: set FIREBASE_PROJECT_ID plus either FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or FIREBASE_USE_ADC=true. Sends are a no-op.',
      );
      return null;
    }

    try {
      this.app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({ credential, projectId });
      this.logger.log(`FCM push enabled (${mode}).`);
    } catch (err) {
      this.logger.error(
        `FCM init failed; push disabled: ${(err as Error)?.message}`,
      );
      this.app = null;
    }

    return this.app;
  }

  /** Compose the platform payloads for one device. */
  private toMessage(
    token: string,
    message: PushMessage,
  ): admin.messaging.Message {
    const { threadKey, channelId, badge } = message;
    return {
      token,
      notification: { title: message.title, body: message.body },
      data: message.data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          defaultSound: true,
          ...(channelId ? { channelId } : {}),
          ...(badge !== undefined ? { notificationCount: badge } : {}),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            ...(threadKey ? { 'thread-id': threadKey } : {}),
            ...(badge !== undefined ? { badge } : {}),
          },
        },
      },
    };
  }

  /**
   * Fan a push out to all of a user's registered devices. Best-effort: any
   * failure is logged, never thrown. Dead tokens are pruned.
   */
  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    await this.sendToUsers([{ userId, message }]);
  }

  /**
   * Send a per-recipient payload to many users in one pass.
   *
   * One token query for the whole set, then a single `sendEach`. Note it cannot
   * be `sendEachForMulticast`: that broadcasts ONE identical payload, and the
   * badge and unread count differ per recipient.
   */
  async sendToUsers(targets: PushTarget[]): Promise<void> {
    const app = this.getApp();
    if (!app || targets.length === 0) return;

    const tokensByUser = await this.deviceTokens.getTokensForUsers(
      targets.map((t) => t.userId),
    );

    // Flat, index-aligned with the responses so pruning can map back.
    const messages: admin.messaging.Message[] = [];
    const tokens: string[] = [];
    for (const target of targets) {
      for (const row of tokensByUser.get(target.userId) ?? []) {
        messages.push(this.toMessage(row.token, target.message));
        tokens.push(row.token);
      }
    }
    if (messages.length === 0) return;

    const dead: string[] = [];
    for (let i = 0; i < messages.length; i += FCM_BATCH_LIMIT) {
      const slice = messages.slice(i, i + FCM_BATCH_LIMIT);
      let response: admin.messaging.BatchResponse;
      try {
        response = await admin.messaging(app).sendEach(slice);
      } catch (err) {
        this.logger.warn(`push batch failed: ${(err as Error)?.message}`);
        continue;
      }

      response.responses.forEach((resp, offset) => {
        if (resp.success) return;
        const code = resp.error?.code;
        if (code && DEAD_TOKEN_CODES.has(code)) dead.push(tokens[i + offset]);
        else this.logger.warn(`push failed: ${code ?? 'unknown'}`);
      });
    }

    await this.deviceTokens.pruneTokens(dead);
  }
}
