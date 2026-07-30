#!/usr/bin/env node
/**
 * Mint a Gmail `refresh_token` for the backend mailer.
 *
 * The runbook used to point at `api/scripts/gmail-auth.js`, which has never
 * existed in this repo. This is that script.
 *
 * Usage — from the repo root:
 *
 *   node scripts/gmail_auth.mjs --secrets ~/Downloads/client_secret_*.json
 *   node scripts/gmail_auth.mjs                 # reads GMAIL_CLIENT_ID/_SECRET
 *
 * It opens the Google consent screen, catches the redirect on
 * http://localhost:8765 (which must be an Authorized redirect URI on the OAuth
 * client), exchanges the code, and prints the refresh token.
 *
 * Notes that matter:
 *  - `access_type=offline` + `prompt=consent` are both required. Without the
 *    second, Google returns no refresh_token on a re-authorisation.
 *  - Each mint invalidates the previous refresh token for this client. Run it
 *    once, then paste the result into backend/.env AND Secret Manager.
 *  - Scope is `gmail.send` only. Verifying "Send mail as" aliases is a Gmail
 *    UI action, not an API call, so no broader scope is needed.
 *  - Sign in as the SENDER mailbox, not your personal account.
 */
import { createServer } from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const REDIRECT_URI = 'http://localhost:8765';
const PORT = 8765;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function loadCredentials() {
  const secretsPath = arg('secrets');
  if (secretsPath) {
    const raw = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const block = raw.web ?? raw.installed;
    if (!block?.client_id || !block?.client_secret) {
      throw new Error(
        `${secretsPath} is not a Google OAuth client JSON (no .web/.installed block).`,
      );
    }
    return {
      clientId: block.client_id,
      clientSecret: block.client_secret,
      projectId: block.project_id,
      redirectUris: block.redirect_uris ?? [],
    };
  }

  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Pass --secrets <client_secret.json>, or set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.',
    );
  }
  return { clientId, clientSecret, redirectUris: [] };
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Non-fatal: the URL is printed below either way.
  }
}

async function main() {
  const { clientId, clientSecret, projectId, redirectUris } =
    loadCredentials();

  if (redirectUris.length && !redirectUris.includes(REDIRECT_URI)) {
    console.error(
      `\n  This client's redirect URIs are: ${redirectUris.join(', ')}\n` +
        `  This script listens on ${REDIRECT_URI}. Add it to the OAuth client\n` +
        `  (Google Auth Platform → Clients → Authorized redirect URIs) first.\n`,
    );
    process.exit(1);
  }

  const state = Math.random().toString(36).slice(2);
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();

  console.log('\nGmail refresh-token minting');
  if (projectId) console.log(`  GCP project : ${projectId}`);
  console.log(`  Client      : ${clientId}`);
  console.log(`  Scope       : ${SCOPE}`);
  console.log(
    '\n  Sign in as the SENDER mailbox — the account whose "Send mail as"\n' +
      '  aliases the From addresses are verified against.\n',
  );
  console.log(`  Opening:\n  ${authUrl}\n`);

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const got = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">` +
          (err || !got
            ? `<h2>Authorisation failed</h2><p>${err ?? 'No code returned.'}</p>`
            : `<h2>Done</h2><p>You can close this tab and return to the terminal.</p>`) +
          `</body>`,
      );

      server.close();
      if (err) reject(new Error(`Google returned: ${err}`));
      else if (!got) reject(new Error('No authorisation code in the redirect.'));
      else if (gotState !== state)
        reject(new Error('State mismatch — aborting.'));
      else resolve(got);
    });
    server.on('error', (e) =>
      reject(
        e.code === 'EADDRINUSE'
          ? new Error(`Port ${PORT} is in use. Free it and re-run.`)
          : e,
      ),
    );
    server.listen(PORT, () => openBrowser(authUrl));
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }

  const token = await res.json();
  if (!token.refresh_token) {
    throw new Error(
      'Google returned no refresh_token. That happens when the app was already\n' +
        'authorised without prompt=consent — revoke access at\n' +
        'https://myaccount.google.com/permissions and run this again.',
    );
  }

  console.log('\n  GMAIL_REFRESH_TOKEN=' + token.refresh_token + '\n');
  console.log('  Next:');
  console.log('    1. Put it in backend/.env (quoted).');
  console.log(
    '    2. Update the GMAIL_REFRESH_TOKEN secret in Secret Manager, in the',
  );
  console.log('       project Cloud Run deploys from, then redeploy the backend.');
  console.log('    3. Check GET /api/health/mail reports token.ok = true.');
  console.log(
    '    4. Delete the downloaded client_secret*.json — it holds the secret.\n',
  );
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
