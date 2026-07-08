# Google OAuth Email Runbook (Long-Lived Refresh Token)

This runbook is for Supabase edge functions:

- `send-signup-email`
- `send-password-reset-email`

## Goal

Reduce `invalid_grant` incidents and recover quickly if they happen.

## 1) Move OAuth Consent Screen to Production

In Google Cloud Console:

1. Open **APIs & Services → OAuth consent screen**.
2. Ensure app is not in **Testing**.
3. Publish app to **In production**.
4. Verify support email, app domain/privacy links, and app details are complete.

Why: Testing-mode refresh tokens can expire quickly (commonly around 7 days).

## 2) Use Minimal Gmail Scope

Use only:

- `https://www.googleapis.com/auth/gmail.send`

Already enforced in [api/scripts/gmail-auth.js](api/scripts/gmail-auth.js).

## 3) Generate Refresh Token Once (Stable Mode)

From project root:

1. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `api/.env`.
2. Run token flow in normal mode:
   - `cd api`
   - `npm run gmail:auth`
3. Complete Google consent in browser.
4. Copy printed `GOOGLE_REFRESH_TOKEN`.

Important:

- Do not repeatedly regenerate refresh tokens unless required.
- For intentional rotation, run once with:
  - PowerShell: `$env:GOOGLE_OAUTH_FORCE_CONSENT="true"; npm run gmail:auth`

## 4) Store Secret in Supabase and Deploy

Set/update project secrets (Dashboard or CLI):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Then deploy both functions:

- `supabase functions deploy send-signup-email`
- `supabase functions deploy send-password-reset-email`

## 5) Use Dedicated Sender Mailbox

Use a dedicated mailbox/account for these automations to reduce user-driven revocation risks.

Recommended account hygiene:

- Keep recovery email/phone current.
- Avoid frequent password resets.
- Limit account sharing.

## 6) Alerting for `invalid_grant`

Functions now emit structured error codes (`EMAIL_AUTH_INVALID`) and stage (`refresh_access_token` / `send_gmail_message`).

Suggested alert rule:

- Trigger if edge logs contain `"errorCode":"EMAIL_AUTH_INVALID"` in the last 5–10 minutes.

## 7) Quick Re-Auth Recovery Procedure

When signup/reset email starts failing with `EMAIL_AUTH_INVALID`:

1. Confirm failure in edge function logs.
2. Rotate token once:
   - PowerShell: `$env:GOOGLE_OAUTH_FORCE_CONSENT="true"; npm run gmail:auth`
3. Update `GOOGLE_REFRESH_TOKEN` secret.
4. Redeploy both functions.
5. Run one signup + one forgot-password test.

## 8) Validation Checklist

- Signup function returns `200` and sends email.
- Forgot-password function returns `200` and sends email.
- No recent `EMAIL_AUTH_INVALID` in edge logs.
- Keep this runbook with on-call notes.
