# Notifications & Push

> **Last updated:** 2026-08-04 · **Status:** current

In-app notifications with two fan-out channels: **mobile/web push** over FCM
(immediate) and **email** (deferred, for mentions and direct messages). The
`notifications` module owns
the in-app inbox and the email dispatcher; the `push` module owns device tokens and
FCM dispatch. Notifications are **best-effort** — a failed notification or email
never blocks the action that triggered it.

## In-app notifications

| Table | Holds |
| --- | --- |
| `notifications` | Per-user notification (category/priority, optionally project-scoped) |
| `notification_types` | Catalog of type definitions, plus the per-type email policy |

`NotificationsService.createNotification` is the single write path, called from ~18
sites across 15 modules (projects, teams, meetings, chat, roadmaps, marketplace,
invoices, payouts, team-time). It inserts the row and awaits a bounded FCM push in
the same method. Fan-out to multiple recipients is each caller's job — e.g.
`MeetingsService` has a private `notifyMany` helper that swallows per-recipient
errors so one bad address cannot break scheduling. There is no shared multi-recipient
helper on the service itself.

`content` is free-form jsonb with a loose convention: a human-readable `message`,
scalar ids the client can act on (`task_id`, `room_id`, `message_id`, …), and the
presentation keys the email renderer needs (`actor_name`, `context_title`,
`excerpt`). `notifications/notification-content.ts` owns that vocabulary —
presentation keys are deliberately kept OUT of the FCM `data` map, which is capped
at 4KB.

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

## Email channel

**Live since 2026-08-04** for the four mention types and for direct messages. Being
mentioned in a task, feature or epic comment or in chat, or receiving a DM, can
produce an email. Nothing else emails.

Delivery is **deferred and conditional**, the Trello/Slack model: the email is queued
with a delay and sent only if the recipient still has not seen the notification. Read
it in the app within the window and no mail is ever sent.

| Table | Holds |
| --- | --- |
| `notification_email_outbox` | Queued candidates: `send_after`, `status`, `attempts`, `skip_reason` |
| `notification_email_settings` | Per-user master switch + the unsubscribe token |
| `notification_preferences` | Sparse per-type overrides (absent row = the type default) |
| `email_suppressions` | Addresses never to mail (bounces/complaints) |

### The single gate

`notification_types.email_eligible` decides everything. There are **no env flags**:
the column is per-type, it is what the enqueue trigger reads, and flipping it takes
effect immediately with no deploy. Turning email off entirely is one statement:

```sql
UPDATE notification_types SET email_eligible = false;
```

Per-type policy also lives there: `email_delay_seconds` (600 for mentions, **1800 for
DMs** — threads are bursty and usually answered within minutes, so a ten-minute fuse
would mail people mid-conversation) and `email_default_enabled` (whether users are
opted in by default).

### How a mention becomes an email

```
  comment/message with an @mention
        │
        ▼
  NotificationsService.createNotification  ──►  notifications row  ──►  FCM push
                                                      │
                                    AFTER INSERT trigger (enqueue_notification_email)
                                    reads email_eligible + email_delay_seconds
                                                      │
                                                      ▼
                                          notification_email_outbox
                                          status=pending, send_after=now()+600s
                                                      │
                          Cloud Scheduler (*/5) ─► POST /api/notifications/cron/email-dispatch
                                                      │
                                    claim_notification_email_outbox()  (SKIP LOCKED)
                                                      │
                                       re-check, at send time, every gate:
                                       · notification still unread?
                                       · chat types: last_read_at < message time?
                                       · address suppressed?
                                       · all_email_enabled / per-type preference?
                                       · does a template exist for this type?
                                       · was this user mailed < 15 min ago?
                                                      │
                                        ┌─────────────┼──────────────┐
                                        ▼             ▼              ▼
                                     sent          skipped        deferred
                                                (skip_reason)  (send_after moved)
```

Enqueue is a database trigger rather than a call inside `createNotification`: it adds
no latency to a path that already awaits an FCM send, it cannot miss a row, and it
catches notifications inserted by SQL — the project-invite reconciliation trigger
writes `notifications` rows with no backend involvement. The trigger stays dumb (read
two columns, copy `content`); all policy is TypeScript in the worker.

Two behaviours worth knowing:

- A user mailed too recently is **deferred, not dropped** — `send_after` moves out, so
  a burst of mentions arrives spread out rather than vanishing.
- A type marked `email_eligible` with no template in
  `notification-email-registry.ts` sends **nothing**. The registry and the column are
  independent switches, and the answer when they disagree is silence, not a blank
  email. A guard test asserts the registry matches the intended set.

### Direct messages

A plain DM used to notify nobody: `sendDmMessage` published a realtime event and, with
no `@mention` in the message, `fireMentionNotifications` returned immediately. If your
app was not open you never learned the message existed.

`chat_dm_received` now fires from `ChatService.notifyDmRecipients`, with three rules:

- **Awaited, not detached.** Unlike the mention and realtime fan-outs beside it, this
  one is `await`ed (bounded by `DM_NOTIFY_DEADLINE_MS`, 2.5s). For a plain DM the
  notification row is the only delivery signal, and Cloud Run throttles CPU once the
  response flushes — a detached tail can be frozen, silently dropping the notification.
- **Mention wins.** A recipient already being notified about the same message via
  `chat_mention` gets no second notification. Compared locally, which is exact for DMs:
  a DM room's members are permanently `{sender, recipient}`, so the membership filter
  the mention path applies is a no-op.
- **One live notification per (user, room).** A twenty-message burst produces one bell
  row, one push and one email candidate — not twenty.

That last rule needs care. "Live" means unread **and newer than the recipient's
`last_read_at` for the room**. The staleness half is what lets it RE-ARM: nothing marks
a notification read when you read the room, so without it a user who reads DMs in the
room but never opens the bell would be notified about a conversation exactly once, ever
— and that is the normal case, not an edge case. The probe is backed by
`idx_notifications_unread_by_room` and is deliberately type-free, since an unread
`chat_mention` for the same room has already told the user to look.

Consequence of insert-if-absent (required, because the outbox has
`UNIQUE (notification_id)` and is fed by an insert trigger — updating in place would
enqueue email once per room forever): the excerpt and `message_id` freeze at the first
unread message of a burst. Copy is count-agnostic for that reason, and the email quotes
the first unread message rather than the latest.

Known wart: reading a DM in the room does **not** clear its bell badge. The bell is a
deliberately independent inbox you clear yourself.

### Unsubscribe and preferences

- `POST /api/notifications/unsubscribe?token=…&scope=…` — one-click (RFC 8058),
  reached from the `List-Unsubscribe` header. Public, throttled, and **always 200**
  so it cannot be used as a token oracle. `scope` is a type name or `all`.
- `GET` / `PUT /api/notifications/preferences` — authenticated per-type toggles.

Every notification email carries both `List-Unsubscribe` (https + mailto) and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`; Gmail renders its native
unsubscribe button only when both are present.

> **Gotcha:** the unsubscribe route deliberately does **not** bind a request body.
> Mail clients POST `List-Unsubscribe=One-Click` as urlencoded form data, and the
> global `ValidationPipe`'s `forbidNonWhitelisted` would reject the undeclared field —
> 400-ing every real click. That failure is invisible outside a real inbox.

### Settings UI

- **`/settings/notifications`** (`web/src/routes/settings/notifications.tsx`) — a
  master email switch plus one toggle per emailable type, read from
  `GET /api/notifications/preferences` and saved with `PUT`. Toggles are optimistic
  with rollback. Turning the master switch off disables the per-type rows rather than
  hiding them, so the state stays legible.
- **`/unsubscribe`** (`web/src/routes/unsubscribe.tsx`) — the human-facing landing for
  footer-link clicks. Public and session-free, because it has to work from whatever
  device opened the mail. Distinct from the one-click header target, which mail clients
  POST silently and which renders nothing.
- Type labels live in `TYPE_COPY` on the settings page and fall back to the raw type
  name, so a type added server-side still renders rather than vanishing from the list.

### Operational notes

- **Cloud Scheduler:** job `notification-email-dispatch`, `*/5 * * * *`,
  `asia-southeast1`, authenticated with the shared `MEETINGS_CRON_SECRET` via the
  `x-cron-secret` header (no new secret was introduced).
- **Caps:** `MAX_PER_RUN` (200) and a 20s soft run deadline are constants in the
  worker, not env vars. Gmail's daily quota is shared with OTP and invoice mail, so
  the ceiling exists to stop a bug burning it in one pass.
- **Triage:** `notification_email_outbox.status` + `skip_reason` explain every
  decision; `last_error` and `attempts` cover failures. Rows at `attempts >= 5`
  dead-letter in place (stay pending, excluded from claims).
- **Deliverability:** Gmail exposes no bounce webhook or complaint feedback loop, so
  `email_suppressions` is never populated automatically today. See
  [Runbook → Google OAuth email](../12-runbooks/google-oauth-email.md) for the ESP
  triggers and credential recovery.

## Flow

```
domain event  ─►  NotificationsService.createNotification(...)  ─►  notifications row
                        │  (best-effort)
                        ├─►  PushModule  ─►  FCM  ─►  device_tokens  ─►  device
                        └─►  AFTER INSERT trigger  ─►  email outbox  ─►  cron  ─►  inbox
                                            (mentions + DMs, delayed)
```

## Code locations

- **Backend:** [`backend/src/modules/notifications/`](../../backend/src/modules/notifications/), [`backend/src/modules/push/`](../../backend/src/modules/push/)
- **Email:** [`notifications/email/`](../../backend/src/modules/notifications/email/) — worker, registry, preferences service
- **Templates:** [`backend/src/common/mail/templates/`](../../backend/src/common/mail/templates/) — shared layout; delivery via [`transport/`](../../backend/src/common/mail/transport/)
- **Migrations:** `supabase/migrations/20260804090000_notification_email_outbox.sql` (machinery), `20260804120000_activate_mention_email.sql` (activation)
- **Web:** `web/src/services/notifications.service.ts`, `web/src/services/pushNotifications.ts`

## See also

- [Mobile](../09-mobile/README.md) — Capacitor + FCM setup.
- [Realtime](../06-realtime/README.md) — live in-app event push (distinct from FCM).
- [Runbook → Google OAuth email](../12-runbooks/google-oauth-email.md) — Gmail credentials, `invalid_client` vs `invalid_grant`.
