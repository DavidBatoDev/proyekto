# Notifications & Push

> **Last updated:** 2026-07-09 · **Status:** current

In-app notifications with an optional **mobile/web push** fan-out over FCM. The
`notifications` module owns the in-app inbox; the `push` module owns device tokens
and dispatch. Notifications are **best-effort** — a failed notification never blocks
the action that triggered it.

## In-app notifications

| Table | Holds |
| --- | --- |
| `notifications` | Per-user notification (category/priority, optionally project-scoped) |
| `notification_types` | Catalog of type definitions |

The `NotificationsService` is imported by nearly every domain (projects, teams,
meetings, chat, marketplace, invoices, payouts) to create notifications; `notifyMany`
swallows per-recipient errors so a failed send never breaks scheduling/commenting/etc.

HTTP: `GET /notifications`, `GET /notifications/unread-count`,
`PATCH /notifications/read-all`, `PATCH /notifications/:id/read`,
`DELETE /notifications/:id` ([Backend → api reference](../03-backend/api-reference.md#notifications--notifications)).

## Push (FCM)

When a notification is created, `notifications` fans out to the `push` module, which
sends to a user's registered devices via **Firebase Cloud Messaging**.

| Table | Holds |
| --- | --- |
| `device_tokens` | Per-user push tokens (registered from the mobile/web client) |

- **Register/unregister:** `POST /push/tokens`, `DELETE /push/tokens`.
- **Config:** `FIREBASE_PROJECT_ID` (`tech-proyekto-app`), and either explicit
  credentials or **keyless ADC** (`FIREBASE_USE_ADC=true`) on Cloud Run;
  `PUSH_SEND_TIMEOUT_MS`. The whole path is gated behind the `FCM_PUSH_ENABLED`
  deploy variable.

The web/mobile client registers tokens via `web/src/services/pushNotifications.ts` /
`deviceTokens.service.ts`. See [Mobile → push](../09-mobile/README.md) for the
Capacitor/FCM wiring.

## Flow

```
domain event  ─►  NotificationsService.create(...)   ─►  notifications row
                        │  (best-effort)
                        └─►  PushModule  ─►  FCM  ─►  device_tokens  ─►  device
```

## Code locations

- **Backend:** [`backend/src/modules/notifications/`](../../backend/src/modules/notifications/), [`backend/src/modules/push/`](../../backend/src/modules/push/)
- **Web:** `web/src/services/notifications.service.ts`, `web/src/services/pushNotifications.ts`

## See also

- [Mobile](../09-mobile/README.md) — Capacitor + FCM setup.
- [Realtime](../06-realtime/README.md) — live in-app event push (distinct from FCM).
