# Notifications & Push

> **Last updated:** 2026-08-11 · **Status:** current

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
`DELETE /notifications/:id` ([Backend → api reference](../../03-backend/api-reference.md#notifications--notifications)).

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
`deviceTokens.service.ts`. See [Mobile → push](../../09-mobile/README.md) for the
Capacitor/FCM wiring.

## Email channel

## Outbound email delivery

Proyekto uses two delivery models. Action emails are sent synchronously while
the initiating request is still running; notification emails are queued so an
in-app read can prevent an unnecessary email.

| Email | Trigger | Delivery path | Expected send time |
| --- | --- | --- | --- |
| Verification code | Sign-up verification request | Direct `MailerService` call | During the request (normally seconds) |
| Password reset code | Reset request for an existing account | Direct `MailerService` call | During the request (normally seconds) |
| Project invite | A collaborator is invited to a project | Direct `MailerService` call | After the invite is created (normally seconds) |
| Team invite | A person is invited to a team | Direct `MailerService` call | After the invite is created (normally seconds) |
| Contract signing link | A signing link is created with email enabled | Direct `MailerService` call | During link creation (normally seconds) |
| Signing-link withdrawal | An active signing link is explicitly revoked | Direct `MailerService` call | During revocation (normally seconds) |
| Invoice | A consultant sends or re-sends an issued invoice | Direct `MailerService` call, with the PDF attached | During the send action (normally seconds) |
| Task, feature, epic, or chat mention | An existing member is @mentioned | Notification email outbox | 10-15 minutes |
| Direct message | A recipient has a new unread DM | Notification email outbox | 30-35 minutes |
| Mention invite (when enabled) | An admin @mentions an email address with no account | Notification email outbox | 2-7 minutes |

The notification dispatcher runs every five minutes. Its configured delay is
600 seconds for mentions, 1,800 seconds for direct messages, and two minutes
for account-less mention invites; the scheduler interval accounts for the
range shown above. Inbox arrival can still vary after the mail provider accepts
the message.

> **Read before send:** Notification emails are deliberately cancelled when
> their in-app notification is already read. At dispatch time, the worker
> re-loads the notification and marks the outbox entry `skipped` with the
> `already_read` reason instead of calling the mail provider.

**Live since 2026-08-04** for the four mention types and for direct messages. Being
mentioned in a task, feature or epic comment or in chat, or receiving a DM, can
produce an email. A fifth type, `roadmap_mention_invite`, exists for people with no
account and ships switched off — see [Mentioning someone with no account](#mentioning-someone-with-no-account).

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

- **Awaited, not detached** — as is the mention fan-out beside it. Both run through
  `runNotifyWork`, bounded at `NOTIFY_DEADLINE_MS` (2.5s). A notification row is the
  only delivery signal there is: no row means no bell entry, no push, and no email,
  since the outbox is fed by an insert trigger. Cloud Run throttles CPU once the
  response flushes and scales to zero, so a detached tail can be frozen and killed —
  which is what used to happen to channel mentions. Past the deadline both degrade to
  the old behaviour (message delivered, notification skipped) rather than hanging a send.
  `fanoutChat` stays detached on purpose: losing a realtime publish costs only live
  delivery, which the next refetch heals, and it fires on every message.
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

### Mentioning someone with no account

A project admin can type an email address into a roadmap comment's @mention picker.
That person is invited to the project and emailed once, and when they sign up the
mention is waiting for them in their bell.

`pending_mention_invites` holds the waiting mention: the address (stored lowercased so
the reconciler's lookup is a plain indexed equality), the project, the comment it came
from, a snapshotted actor name and excerpt, its own `unsubscribe_token`, and a 90-day
`expires_at`. It is a separate table from `project_invites` because that one allows a
single row per email per project — but a person may be named in five comments before
they ever sign up, and each is a separate thing to show them. RLS is on with **no
policies**: the rows say "this address was named in this private project", which is
precisely the disclosure the feature has to contain.

**The email carries no excerpt.** `buildMentionStyleEmail` would quote it and the
producer omits it deliberately: sending 280 characters of a private project thread to
an address that has proven nothing — and which may simply be a typo — is not worth a
slightly warmer email. The excerpt stays on the row and appears in the in-app
notification after signup, inside the trust boundary. A registry test pins this. The
CTA points at signup rather than the comment, because `project_access.user_id` is NOT
NULL so there is nothing to grant them yet and a deep link would hit a login wall.

**Reconciliation** is a third `AFTER INSERT ON profiles` trigger,
`handle_profile_mention_invites_reconciliation`. Unlike its two neighbours it has **no
freshness window** — a mention may be weeks old by the time someone signs up, which is
the entire point; `expires_at` is the bound instead. All three reconcilers are now
self-guarding: `handle_new_user` wraps the profile insert, the wallet and the
email-confirm in one PL/pgSQL block with its own handler, so anything a reconciler
threw used to roll all of it back and leave an auth user with no profile.

**What bounds abuse.** An admin can otherwise make Proyekto mail any address they type,
from our domain, with text they wrote — so: project-admin only, five addresses per
comment, twenty per author per rolling day, suppression checked at both enqueue and
send, per-address send spacing, and the per-run ceiling. There is also an empty
recipient-domain clamp in the service kept as an incident lever.

Their unsubscribe uses the `address` scope, which writes an `email_suppressions` row
rather than a settings row — a recipient with no account has no settings row to hold a
preference. The worker **refuses to send at all** to an account-less recipient it cannot
give an opt-out to.

**The switch.** `notification_types.email_eligible` for `roadmap_mention_invite` gates
both halves: `RoadmapMentionInviteService` reads it before creating anything, and
`ProjectsService.getMyPermissions` folds it into `mentions.invite_by_email` on the
permissions payload so the client affordance appears and disappears with it. One
UPDATE moves both, with no deploy.

That permission is computed from a **role comparison**, not from `members.manage` —
`ORIGIN_DELTAS` grants `members.manage` to consultant and client origins regardless of
role, so an editor-role consultant holds it while `assertRole('admin')` would refuse
them. Using it would have offered an affordance the server then declined.

### Watching it

There is no admin surface; these are the queries.

```sql
-- invites created, per author per day
select invited_by, date_trunc('day', created_at) as day, count(*)
  from pending_mention_invites group by 1, 2 order by 2 desc;

-- what the dispatcher decided
select status, skip_reason, count(*) from notification_email_outbox
 where type_name = 'roadmap_mention_invite' group by 1, 2;

-- did anyone actually arrive? if this stays 0, the feature does not work
select count(*) from pending_mention_invites where status = 'reconciled';
```

Rollback is the flag, but note it only stops NEW rows — anything already queued still
sends on the next dispatch run:

```sql
update notification_types set email_eligible = false
 where name = 'roadmap_mention_invite';

update notification_email_outbox set status = 'skipped',
       skip_reason = 'rolled_back', processed_at = now()
 where type_name = 'roadmap_mention_invite' and status = 'pending';
```

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
[Runbook → Google OAuth email](../../12-runbooks/google-oauth-email.md) for the ESP
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

- **Backend:** [`backend/src/modules/shared/notifications/`](../../../backend/src/modules/shared/notifications/), [`backend/src/modules/shared/push/`](../../../backend/src/modules/shared/push/)
- **Email:** [`notifications/email/`](../../../backend/src/modules/shared/notifications/email/) — worker, registry, preferences service
- **Templates:** [`backend/src/common/mail/templates/`](../../../backend/src/common/mail/templates/) — shared layout; delivery via [`transport/`](../../../backend/src/common/mail/transport/)
- **Migrations:** `supabase/migrations/20260804090000_notification_email_outbox.sql` (machinery), `20260804120000_activate_mention_email.sql` (activation)
- **Web:** `web/src/services/notifications.service.ts`, `web/src/services/pushNotifications.ts`

## See also

- [Mobile](../../09-mobile/README.md) — Capacitor + FCM setup.
- [Realtime](../../06-realtime/README.md) — live in-app event push (distinct from FCM).
- [Runbook → Google OAuth email](../../12-runbooks/google-oauth-email.md) — Gmail credentials, `invalid_client` vs `invalid_grant`.
