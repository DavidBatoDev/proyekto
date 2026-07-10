# Push (FCM)

> **Last updated:** 2026-07-09 · **Status:** current

Mobile push uses **Firebase Cloud Messaging** and reuses the existing in-app
notifications domain: when a notification row is created, the backend also pushes it
to the recipient's registered devices. It's **best-effort** (a push failure never
blocks the triggering action) and **ships dark** until enabled.

> Firebase project `tech-proyekto-app`. Browser/PWA web push is intentionally not
> wired — only native Android/iOS receive FCM. Leaving all Firebase env unset makes
> push a safe no-op (good for CI/local).

## The flow

```
login ─► usePushNotifications: request permission, get FCM token
      ─► POST /api/push/tokens ─► device_tokens (UNIQUE token, many per user)

notification created ─► NotificationsService.createNotification()
      ├─ insert in-app row
      └─ FCM push (bounded timeout, errors swallowed) ─► device_tokens ─► device
```

1. On login, the app requests permission, gets an FCM token, and upserts it into
   `device_tokens` (unique per token, many rows per user → multi-device).
2. Any `createNotification()` inserts the in-app row and fires an FCM push with a
   bounded `Promise.race` timeout; failures are swallowed.
3. The payload carries both `notification` (title/body) and `data` (`type`,
   `notification_id`, `link_url`, ids) so a background/cold-start tap keeps the
   deep-link.
4. Tapping routes to `data.link_url` (default `/notifications`); foreground receipt
   refreshes the notification queries (bell badge + lists).
5. On logout the device token is deleted; tokens FCM reports as unregistered are
   pruned on the next send.

## Backend credentials

The backend sends via `firebase-admin`. Two auth modes — pick one:

**(A) Keyless — recommended** (and required if org policy blocks key downloads):

```bash
FIREBASE_PROJECT_ID=tech-proyekto-app
FIREBASE_USE_ADC=true
```

- **Local:** `gcloud auth application-default login` once (your account needs FCM
  send access).
- **Cloud Run:** the runtime service account is used automatically — grant it
  `roles/firebasecloudmessaging.admin` on the Firebase project once.

**(B) Service-account key** — only if key downloads are allowed:
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (single line,
literal `\n`). If both modes are set, the key wins.

Always include `capacitor://localhost,http://localhost,https://localhost` in
`CORS_ORIGINS` so the WebView can call the API.

## Enabling in production (ship-dark)

The deploy uses the **keyless** path. To turn it on:

1. Grant the Cloud Run runtime SA `roles/firebasecloudmessaging.admin` on
   `tech-proyekto-app`.
2. Set the repo variable **`FCM_PUSH_ENABLED`** to any non-empty value — the deploy
   then injects `FIREBASE_PROJECT_ID` + `FIREBASE_USE_ADC=true`.
3. Ensure `CORS_ORIGINS` includes the three `localhost` origins.

Until `FCM_PUSH_ENABLED` is set, Firebase env isn't injected and deploys stay green.

## iOS extra step

iOS needs an **APNs Auth Key (.p8)** uploaded to Firebase (Project Settings → Cloud
Messaging), plus the Push Notifications + Background Modes capabilities in Xcode.
Without the APNs key, iOS devices never get an FCM token. Test on a **real device**
(the simulator can't receive remote push).

## Code locations

- **Backend:** [`backend/src/modules/push/`](../../backend/src/modules/push/), [`backend/src/modules/notifications/`](../../backend/src/modules/notifications/)
- **Web:** `web/src/services/pushNotifications.ts`, `web/src/services/deviceTokens.service.ts`, `web/src/hooks/usePushNotifications.ts`
- **Full guide:** [`web/MOBILE.md`](../../web/MOBILE.md) §5, §7

## See also

- [Feature Domains → notifications & push](../11-domains/notifications-and-push.md) — the in-app side.
