# Runbook: Google OAuth Email

> **Last updated:** 2026-07-09 · **Status:** current

Transactional signup / password-reset emails are sent by two Supabase **edge
functions** (`send-signup-email`, `send-password-reset-email`) that authenticate to
Gmail with a long-lived OAuth **refresh token**. This runbook is about keeping that
token healthy and recovering fast from `invalid_grant` (`EMAIL_AUTH_INVALID`).

> The failure mode is a dead refresh token → signup/reset emails stop. Recovery is:
> mint a new refresh token, update the Supabase secret, redeploy both functions.

## Keep the token long-lived

1. **Publish the OAuth consent screen to production** (Google Cloud Console → APIs &
   Services → OAuth consent screen). Testing-mode refresh tokens expire in ~7 days.
2. **Use the minimal scope** `https://www.googleapis.com/auth/gmail.send`.
3. **Use a dedicated sender mailbox** with current recovery info and no frequent
   password resets (those revoke tokens).

## Generate the refresh token (once)

Mint `GOOGLE_REFRESH_TOKEN` via a standard Google OAuth **consent flow** for a
client configured with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and the
`gmail.send` scope (e.g. the OAuth Playground or a one-off local script).

> **⚠️ Stale reference:** older copies of this runbook pointed at
> `api/scripts/gmail-auth.js` / `npm run gmail:auth`. That directory and script are
> **not in the repo** — there is no `api/` folder and no committed helper. Generate
> the token with any standard consent flow; don't rely on the missing script. Don't
> regenerate tokens repeatedly (each rotation invalidates the last).

## Store the secret & deploy

Set the three secrets on the Supabase project (dashboard or CLI):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Then redeploy:

```bash
supabase functions deploy send-signup-email
supabase functions deploy send-password-reset-email
```

## Alerting

The functions emit structured errors — `errorCode: "EMAIL_AUTH_INVALID"` with a
stage (`refresh_access_token` / `send_gmail_message`). Alert on
`"errorCode":"EMAIL_AUTH_INVALID"` appearing in edge logs within a 5–10 min window.

## Recovery procedure

When emails start failing with `EMAIL_AUTH_INVALID`:

1. Confirm the failure in edge-function logs.
2. Mint a fresh refresh token (consent flow, forcing consent for rotation).
3. Update the `GOOGLE_REFRESH_TOKEN` Supabase secret.
4. Redeploy both functions.
5. Run one signup + one forgot-password test; confirm `200` + email delivery and no
   new `EMAIL_AUTH_INVALID`.

## Code locations

- **Edge functions:** [`supabase/functions/send-signup-email/`](../../supabase/functions/send-signup-email/), [`supabase/functions/send-password-reset-email/`](../../supabase/functions/send-password-reset-email/)
- **Backend Gmail env:** `GMAIL_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` — see [Backend → configuration](../03-backend/configuration.md)
