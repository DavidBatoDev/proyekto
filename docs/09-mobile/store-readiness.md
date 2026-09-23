# Store readiness — Google Play & App Store

> **Last updated:** 2026-09-23 · **Status:** audit — findings only, nothing here is built

What the two stores will want before Proyekto can ship, checked against the repo on
2026-09-23. The commerce/marketplace gate is **done** (see
[Routing & Access → What the installed app carries](../04-web/routing-and-access.md#what-the-installed-app-carries));
everything below is still open.

## The business model, and why it is allowed

The app is **free to download** and contains no purchase surface at all. Plans are bought on
the web; the app reads the workspace's entitlements from
`GET /api/workspaces/:id/usage` and renders accordingly. That is the Linear/Slack shape and
is what both stores' rules are written around — the risk is never "a paid SaaS has a free
app", it is *a purchase flow, or a link to one, inside the app*. As of 2026-09-23 the app has
neither:

- `/pricing`, the workspace Billing page and the Usage page are unreachable natively, as is
  the whole `/admin` staff console.
- The plan-limit toast and the inline `PlanLimitNotice` render no upgrade button, and use
  local copy rather than the server's `plan_limit` message.
- `WorkspaceBillingPage.go()` — the one call that would send a WebView to hosted checkout —
  refuses on native as a second, independent lock.
- The blocked-surface screen states an absence and offers no outbound link.

## Open items

### 1. ~~`/terms` and `/privacy` are links to nothing~~ — **DONE 2026-09-23 (`fc1d63a9`)**
Both are real routes now, classified `app` so they render inside the installed app (Apple
wants a privacy policy in-app; signup links to both from every platform). They are scoped to
the SaaS and say plainly that the marketplace is not launched.

**Still needs a human:** these are drafts written from the code, not reviewed by a lawyer.
Before submission, confirm the operating entity name, the governing-law clause (currently the
Philippines), and that the subprocessor list is complete. The privacy page's "no analytics or
tracking SDKs" claim is true today — adding one means changing that page in the same commit.

### 2. In-app account deletion — **blocker, Google Play**
Play requires an app that lets people create an account to offer account deletion *in the
app* and at a publicly reachable web URL. Grepping `web/src` and `backend/src` finds no
delete-account path — the only "delete account" matches are unrelated (a workspace selection
sync and a marketplace service editor). This is net-new work across web, backend and the
Play Data Safety form.

### 3. iOS has never been built — **the long pole for the App Store**
`web/ios/` is scaffolded (`App.xcworkspace`, Podfile, Capacitor plugins) but §6 of
[`web/MOBILE.md`](../../web/MOBILE.md) lists the signing, Push Notifications and Background
Modes capabilities as **manual Xcode steps on a Mac**, and there is no iOS workflow in
`.github/workflows/` (Android only, `android-release.yml`). Needs: an Apple Developer
Program account, a Mac or a macOS runner, signing certificates, an App Store Connect API key,
and a first TestFlight build.

### 4. Sign in with Apple — assess before the iOS build
The app offers email/password **and** native Google sign-in
(`@capgo/capacitor-social-login`, `web/src/services/googleAuth.ts`). Apple's requirement
bites when a third-party login is the *only* option; an equivalent first-party email/password
path normally satisfies it. Worth confirming against the current guideline text before
submitting rather than after a rejection.

### 5. Publishing is still dark
Both switches ship off, by design:
- `PLAY_PUBLISH_ENABLED` gates the Play upload step in `android-release.yml` (`track:
  internal`, `status: draft`), and needs `PLAY_SERVICE_ACCOUNT_JSON`.
- **Play will not accept the first upload over the API** — one AAB must be uploaded by hand
  in the Play Console before the Publishing API will take a track. Already noted in the
  workflow's comments.
- `OTA_PUBLISH_ENABLED` gates the OTA bundle publish.

### 6. Data Safety / App Privacy declarations
Needs an inventory of what leaves the device: FCM push tokens (`device_tokens`), the Capgo
OTA check/stats calls (`api.proyekto.tech/api/mobile-updates/*`, which report app version and
device id), Supabase auth, uploads to R2, and anything the AI agent receives.

## Residual leaks in the gate — accepted, and why

- **Price strings still ship inside the APK.** `lib/usageCopy.ts`, `lib/billingCopy.ts` and
  the lazily-loaded `/pricing` chunk are all in `dist/`, findable with `unzip` + `grep`.
  Reviewers tap through an app; neither store greps JS bundles for prices. Dropping
  `lib/pricing.ts` from the billing page was considered and rejected — that module supplies
  plan names, taglines and intervals as well as prices, so removing it is a data-model
  refactor of `/pricing`, not an import deletion.
- **Backend-authored notification bodies** are outside this gate. The *link* is caught by the
  route gate, but the words in an FCM payload or an inbox row are written server-side. Worth
  an audit of `plan_limit` and billing notification text if one is ever added.
- **Computed paths** (`` to={`/marketplace/${x}`} ``, the union in
  `components/finance/portfolio/financeSearch.ts`) are unreachable — the route gate catches
  them at navigation — but they are invisible to a static link check. All currently live in
  marketplace-only components, so they never render natively anyway.
- **No automated test runs in a real WebView.** Vitest and Playwright both see
  `isNativePlatform() === false`. The pre-submission check is a physical device; see the
  verification section of the implementation plan.

## See also
- [Capacitor setup](capacitor.md) · [OTA updates](ota-updates.md) · [Push (FCM)](push-fcm.md)
- [`web/MOBILE.md`](../../web/MOBILE.md) — the operational runbook
- [Routing & Access](../04-web/routing-and-access.md) — what the app carries and how the gate works
