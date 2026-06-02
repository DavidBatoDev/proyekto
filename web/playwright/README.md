# Playwright Authenticated QA

This setup stores an authenticated browser state and reuses it for QA tests.

## 1) Set credentials

Add these to `web/.env` (or your shell environment):

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000
PLAYWRIGHT_AUTH_HEADED=0
PLAYWRIGHT_AUTH_SETUP_TIMEOUT_MS=600000

# Required: email/password account for QA
PLAYWRIGHT_EMAIL=you@example.com
PLAYWRIGHT_PASSWORD=your-password
```

## 2) Log in once and save auth state

```bash
npm run pw:auth
```

This writes `playwright/.auth/user.json` — a saved browser session that all tests reuse.

## 3) Run tests

```bash
npm run pw:test
```

Or run a specific test file:

```bash
npm run pw:qa:project-posting
```

## Install browser binaries (first-time only)

```bash
npm run pw:install
```
