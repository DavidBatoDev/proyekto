# Playwright Authenticated QA

This setup stores authenticated browser states and reuses them for QA tests.

## 1) Set credentials

Add these to `web/.env` (or your shell environment):

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000
PLAYWRIGHT_AUTH_HEADED=0
PLAYWRIGHT_AUTH_ALLOW_PARTIAL=0
PLAYWRIGHT_AUTH_SETUP_TIMEOUT_MS=600000

# RBAC role accounts (recommended)
PLAYWRIGHT_CONSULTANT_EMAIL=consultant@example.com
PLAYWRIGHT_CONSULTANT_PASSWORD=your-consultant-password
PLAYWRIGHT_FREELANCER_EMAIL=freelancer@example.com
PLAYWRIGHT_FREELANCER_PASSWORD=your-freelancer-password

# Optional fallback single-user auth (legacy)
PLAYWRIGHT_EMAIL=
PLAYWRIGHT_PASSWORD=
```

If you want setup to continue and save whichever roles succeed (instead of failing the whole run), set:

```powershell
$env:PLAYWRIGHT_AUTH_ALLOW_PARTIAL='1'
```

## 2) Log in once and save auth states

```bash
npm run pw:auth
```

Generated files:

- `playwright/.auth/consultant.json` (if consultant creds set)
- `playwright/.auth/freelancer.json` (if freelancer creds set)
- `playwright/.auth/user.json` (only if role creds are absent and fallback creds are set)

## 3) Run role-specific authenticated QA

```bash
npm run pw:qa:project-posting:consultant
npm run pw:qa:project-posting:freelancer
```

Or run all configured projects:

```bash
npm run pw:test
```

## Optional: run real create flow

This creates a real project and asserts redirect to overview:

```bash
PLAYWRIGHT_RUN_CREATE_FLOW=1 npm run pw:qa:project-posting:consultant
```

## Install browser binaries (first-time only)

```bash
npm run pw:install
```
