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
 *   node scripts/gmail_auth.mjs --secrets <json> --env-only
 *                                               # print the two ID/secret lines
 *                                               # and stop — no consent flow, so
 *                                               # the existing refresh token
 *                                               # keeps working
 *   node scripts/gmail_auth.mjs --secrets <json> --env-only --write-env
 *                                               # same, but written straight into
 *                                               # backend/.env — the values never
 *                                               # reach the terminal
 *   node scripts/gmail_auth.mjs --secrets <json> --write-env
 *                                               # full consent flow, all three
 *                                               # values written to backend/.env
 *   node scripts/gmail_auth.mjs --check         # test what is in backend/.env
 *                                               # against Google; sends nothing
 *
 * `--env <path>` targets a different env file (default `backend/.env`). Every
 * write leaves a `<path>.bak` alongside it.
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

function flag(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * `.env` values are quoted: a client secret is base64-ish and a refresh token
 * can carry a `/`, neither of which every dotenv parser tolerates bare.
 */
function envLine(key, value) {
  return `${key}="${value}"`;
}

/** Never print a credential — say how long it was and move on. */
function masked(value) {
  return `<${value.length} chars>`;
}

/**
 * Rewrite keys in place in a `.env`, preserving comments, ordering and every
 * unrelated line. Existing keys are replaced; missing ones are appended.
 *
 * This exists so credentials can go from the downloaded JSON into `.env`
 * without ever passing through a terminal, a clipboard, or a transcript.
 */
function updateEnvFile(envPath, updates) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`${envPath} does not exist.`);
  }
  const original = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(`${envPath}.bak`, original);

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const written = [];

  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    const line = envLine(key, value);
    if (i === -1) lines.push(line);
    else lines[i] = line;
    written.push(`${key} ${masked(value)} ${i === -1 ? '(appended)' : `(line ${i + 1})`}`);
  }

  fs.writeFileSync(envPath, lines.join(eol));
  return written;
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

/**
 * Does what is currently in `.env` actually work? Refreshes the token and probes
 * the Gmail API read-only — it never sends a message, and never prints a value.
 */
async function check(envPath) {
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const clientId = env.GMAIL_CLIENT_ID ?? env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GMAIL_REFRESH_TOKEN ?? env.GOOGLE_REFRESH_TOKEN;

  console.log(`\n  Checking ${envPath}`);
  console.log(`    client_id     : ${clientId ? masked(clientId) : 'MISSING'}`);
  console.log(`    client_secret : ${clientSecret ? masked(clientSecret) : 'MISSING'}`);
  console.log(`    refresh_token : ${refreshToken ? masked(refreshToken) : 'MISSING'}`);
  if (!clientId || !clientSecret || !refreshToken) {
    console.log('\n  Incomplete credentials — nothing to test.\n');
    process.exitCode = 1;
    return;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    console.log(`\n  TOKEN REFRESH FAILED (${res.status})`);
    console.log('  ' + body.replace(/\n\s*/g, ' '));
    if (body.includes('invalid_client')) {
      console.log(
        '\n  => client_id and client_secret do not match. The secret was most\n' +
          '     likely rotated in Google Cloud Console. Re-download the client\n' +
          '     JSON and re-run with --secrets <file> --env-only --write-env.\n',
      );
    } else if (body.includes('invalid_grant')) {
      console.log(
        '\n  => the refresh token is expired or revoked. Re-run this script\n' +
          '     without --env-only to mint a new one.\n',
      );
    }
    process.exitCode = 1;
    return;
  }
  const tok = await res.json();
  console.log(`\n  token refresh : OK (expires_in=${tok.expires_in})`);
  console.log(`  granted scope : ${tok.scope}`);

  const probe = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { headers: { Authorization: `Bearer ${tok.access_token}` } },
  );
  if (probe.ok) {
    const p = await probe.json();
    console.log(`  gmail mailbox : ${p.emailAddress}`);
    console.log('\n  Credentials are healthy.\n');
  } else {
    // gmail.send alone cannot read the profile — a 403 here is expected and
    // is NOT a failure. Anything else is.
    const body = await probe.text();
    console.log(`  gmail probe   : ${probe.status}`);
    console.log(
      probe.status === 403
        ? '\n  Healthy — 403 on profile is expected with the gmail.send scope.\n'
        : `\n  Unexpected Gmail response: ${body.slice(0, 200)}\n`,
    );
    if (probe.status !== 403) process.exitCode = 1;
  }
}

async function main() {
  const writeEnv = flag('write-env');
  const envPath = arg('env') ?? 'backend/.env';

  if (flag('check')) {
    await check(envPath);
    return;
  }

  const { clientId, clientSecret, projectId, redirectUris } =
    loadCredentials();

  if (flag('env-only')) {
    if (writeEnv) {
      const written = updateEnvFile(envPath, {
        GMAIL_CLIENT_ID: clientId,
        GMAIL_CLIENT_SECRET: clientSecret,
      });
      console.log(`\n  Wrote to ${envPath} (backup at ${envPath}.bak):`);
      for (const w of written) console.log('    ' + w);
      console.log('\n  GMAIL_REFRESH_TOKEN left untouched.');
      console.log('  Verify with:  node scripts/gmail_auth.mjs --check\n');
      return;
    }
    console.log('\n  Paste into backend/.env (GMAIL_REFRESH_TOKEN unchanged):\n');
    console.log('  ' + envLine('GMAIL_CLIENT_ID', clientId));
    console.log('  ' + envLine('GMAIL_CLIENT_SECRET', clientSecret));
    console.log(
      '\n  These belong to a different OAuth client than the one that issued your\n' +
        '  current refresh token? Then re-run without --env-only to mint a matching\n' +
        '  one — a mismatched pair fails with invalid_client.\n',
    );
    return;
  }

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

  if (writeEnv) {
    const written = updateEnvFile(envPath, {
      GMAIL_CLIENT_ID: clientId,
      GMAIL_CLIENT_SECRET: clientSecret,
      GMAIL_REFRESH_TOKEN: token.refresh_token,
    });
    console.log(`\n  Wrote to ${envPath} (backup at ${envPath}.bak):`);
    for (const w of written) console.log('    ' + w);
    console.log('\n  Verify with:  node scripts/gmail_auth.mjs --check');
    console.log('\n  Next:');
    console.log('    1. Done — the three GMAIL_* lines are already updated.');
  } else {
    console.log('\n  Paste this whole block into backend/.env:\n');
    console.log('  ' + envLine('GMAIL_CLIENT_ID', clientId));
    console.log('  ' + envLine('GMAIL_CLIENT_SECRET', clientSecret));
    console.log('  ' + envLine('GMAIL_REFRESH_TOKEN', token.refresh_token));
    console.log('\n  Next:');
    console.log('    1. Replace the three GMAIL_* lines in backend/.env with the above.');
  }
  console.log(
    '    2. Update the matching GMAIL_* secrets in Secret Manager, in the',
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
