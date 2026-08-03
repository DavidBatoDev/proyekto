# Runbook: Google OAuth Email

> **Last updated:** 2026-08-03 · **Status:** current

All outbound transactional email — signup verification, password reset, project
invites, invoices — is sent by the **backend**
(`backend/src/common/mail/mailer.service.ts`) over the Gmail API, authenticated with a
long-lived OAuth **refresh token**.

> Until 2026-08-03 this runbook described four Supabase edge functions. They were dead
> code — nothing invoked them — and have been deleted from the repo and undeployed.
> There is no email path outside the backend. Recover the sources from git history if
> a future function needs a starting point.

The failure mode is **silent**. `MailerService` is best-effort by design: the caller's
write is already committed by the time delivery is attempted, so it returns
`{ sent: false, reason }` and never throws. An invoice or invite reports success with
no mail sent. Only the OTP paths check `result.sent` and surface an error.

## Credentials

Three values, in `backend/.env` locally and in **GCP Secret Manager** for prod
(project `planar-rarity-494104-n4`):

| Key | Notes |
| --- | --- |
| `GMAIL_CLIENT_ID` | OAuth client; stable |
| `GMAIL_CLIENT_SECRET` | **rotatable in Google Cloud — the usual cause of an outage** |
| `GMAIL_REFRESH_TOKEN` | bound to the *client_id*; survives a secret rotation |

Cloud Run resolves `GMAIL_*:latest` when an instance starts, so a new secret version
reaches prod on the next deploy (or cold start). All three are already in the `SECRETS`
list in `.github/workflows/backend-deploy.yml` — deploys **full-replace** secrets, so
never drop them from that list.

## Diagnose

```bash
node scripts/gmail_auth.mjs --check          # tests backend/.env; sends nothing
```

It prints credential lengths (never values), refreshes the token, and probes Gmail.
A **403 on the profile probe is healthy** — `gmail.send` alone cannot read a profile.

Admins can also hit `GET /api/health/mail` (admin-guarded, `NO_STORE`), which reports
the same plus resolved sender addresses.

Read the error carefully — the two failures have completely different fixes:

| Error | Meaning | Fix |
| --- | --- | --- |
| `invalid_client` (401) | client_id and client_secret don't match; the secret was rotated or deleted in Google Cloud | **Secret only** — the refresh token is fine |
| `invalid_grant` (400) | the refresh token is expired or revoked | Mint a new token |

## Fix: rotated client secret (the common case)

No consent flow, no token rotation. Download the OAuth client JSON from Google Cloud
Console → APIs & Services → Credentials, then:

```bash
node scripts/gmail_auth.mjs --secrets <file.json> --env-only --write-env
node scripts/gmail_auth.mjs --check

# prod: add a new secret version, then redeploy the backend to pick it up
node -e "const fs=require('fs');process.stdout.write(JSON.parse(fs.readFileSync('<file.json>','utf8')).web.client_secret)" \
  | gcloud secrets versions add GMAIL_CLIENT_SECRET --data-file=- --project=planar-rarity-494104-n4
```

Delete the downloaded JSON afterwards — it holds the secret in plaintext.
`client_secret*.json`, `keys.json` and `credentials.json` are gitignored at the repo
root, but a rename outside those patterns is not.

## Fix: dead refresh token

**Minting invalidates the current refresh token.** Confirm it is genuinely dead
(`invalid_grant`, not `invalid_client`) before running this, or you will take down
working prod email to replace a token that was fine.

```bash
node scripts/gmail_auth.mjs --secrets <file.json> --write-env   # opens the consent screen
```

Sign in as the **sender mailbox**, not a personal account. The OAuth client needs
`http://localhost:8765` in its Authorized redirect URIs first. Then push the new token
to Secret Manager and redeploy.

## Keep the token long-lived

1. **Publish the OAuth consent screen to production** (Google Cloud Console → APIs &
   Services → OAuth consent screen). Testing-mode refresh tokens expire in ~7 days.
2. **Use the minimal scope** `https://www.googleapis.com/auth/gmail.send`.
3. **Use a dedicated sender mailbox** with current recovery info and no frequent
   password resets (those revoke tokens).
4. Every `MAIL_FROM_*` address must be verified under "Send mail as" on that mailbox,
   or Gmail rejects the message.

## Recovery procedure

1. `node scripts/gmail_auth.mjs --check` — identify `invalid_client` vs `invalid_grant`.
2. Apply the matching fix above.
3. Add the new Secret Manager version(s); leave the previous version enabled for rollback.
4. Redeploy the backend so running instances pick up `latest`.
5. Confirm `GET /api/health/mail` reports `token.ok = true`, then run one signup and one
   forgot-password end to end.

## Code locations

- **Mailer:** [`backend/src/common/mail/mailer.service.ts`](../../backend/src/common/mail/mailer.service.ts) · senders in [`mail-senders.ts`](../../backend/src/common/mail/mail-senders.ts) · health in [`mail-health.controller.ts`](../../backend/src/common/mail/mail-health.controller.ts)
- **Callers:** [`auth/email-otp.service.ts`](../../backend/src/modules/auth/email-otp.service.ts) (verification + reset), [`projects.service.ts`](../../backend/src/modules/projects/projects.service.ts) (invites), [`invoices.service.ts`](../../backend/src/modules/invoices/invoices.service.ts)
- **Token tooling:** [`scripts/gmail_auth.mjs`](../../scripts/gmail_auth.mjs)
- **Backend Gmail env:** [Backend → configuration](../03-backend/configuration.md)
