import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { DeviceTokensService } from './device-tokens.service';

export interface PushMessage {
  title: string;
  body: string;
  /** FCM data must be string -> string; carries type, ids, and deep-link. */
  data?: Record<string, string>;
}

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

  /**
   * Fan a push out to all of a user's registered devices. Best-effort: any
   * failure is logged, never thrown. Dead tokens are pruned.
   */
  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    const app = this.getApp();
    if (!app) return;

    const rows = await this.deviceTokens.getTokensForUser(userId);
    const tokens = rows.map((r) => r.token);
    if (tokens.length === 0) return;

    const response = await admin.messaging(app).sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data ?? {},
      android: {
        priority: 'high',
        notification: { sound: 'default', defaultSound: true },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    });

    if (response.failureCount === 0) return;

    const dead: string[] = [];
    response.responses.forEach((resp, i) => {
      if (resp.success) return;
      const code = resp.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        dead.push(tokens[i]);
      } else {
        this.logger.warn(
          `push to ${userId} token #${i} failed: ${code ?? 'unknown'}`,
        );
      }
    });

    await this.deviceTokens.pruneTokens(dead);
  }
}
