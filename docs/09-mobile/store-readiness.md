# Store readiness — Google Play & App Store

> **Last updated:** 2026-09-28 · **Status:** partly built — items 1-3 are done, 4-7 are open

What the two stores will want before Proyekto can ship, checked against the repo on
2026-09-28. Four things are now **done**: the commerce/marketplace gate (see
[Routing & Access → What the installed app carries](../04-web/routing-and-access.md#what-the-installed-app-carries)),
the legal pages (item 1), in-app account deletion (item 2), and the Android API 36 target
(item 3). Items 4-7 are open, and item 4 (iOS) is the long pole.

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

### 2. ~~In-app account deletion~~ — **DONE 2026-09-23**
Play requires both an in-app path and a publicly reachable web URL. Both exist now:

- **In app:** `/settings/delete-account`, reachable from a danger band on the settings
  overview and from a row in the settings rail on every settings page. Classified `app` by
  inheriting the `/settings` rule in `web/src/lib/platformSurfaces.ts`.
- **Public URL for the Data safety form:**
  `https://proyekto.tech/docs/account-and-apps/deleting-your-account` — unauthenticated,
  names the app, and explains the whole flow.

The deletion is one `delete_account()` transaction
(`supabase/migrations/20260923090200_delete_account.sql`). It does **not** delete the
`profiles` row: that row is the parent of ~166 foreign keys, 14 of them `RESTRICT` (which
would abort) and many `CASCADE` on shared containers (which would destroy other people's
projects). Instead the row is tombstoned — every PII column scrubbed, `display_name` set to
"Deleted user", email rotated to an unroutable `.invalid` address, the `auth.users` row
scrubbed and banned, and every `auth.identities` row deleted so Google sign-in cannot
resurrect it.

**Still needs a human before submission:**
- The **Data safety form** deletion questions, using the URL above.
- The retention period in `/privacy` is currently **ten years** for contracts, invoices and
  payout records, chosen to match Philippine tax retention. Confirm it with whoever owns the
  legal pages — Play requires the disclosure to be accurate, not merely present.

**Residual, accepted:** a deleted user's access token stays cryptographically valid until it
expires (`jwt_expiry = 3600`), because `SupabaseAuthGuard` verifies JWTs locally with no
database round-trip. A Redis deny-list (`RevokedUsersService`) closes this to ≤60s per
instance; the structural fix is lowering `jwt_expiry`, which is a project-config change.

### 3. ~~Android targeted API 35, Play requires 36~~ — **DONE 2026-09-28**
Google Play, since 31 Aug 2026: *"New apps and app updates must target Android 16 (API
level 36) or higher to be submitted to Google Play."* The project was on `targetSdkVersion
= 35`, so a new-app submission would have been rejected outright.

Fixed by the **Capacitor 7 → 8** upgrade, which is what carries Android 16:

| | was | now |
|---|---|---|
| `@capacitor/*` and all 6 plugins | 7.x | 8.x |
| `minSdk` / `compileSdk` / `targetSdk` | 23 / 35 / 35 | 24 / 36 / 36 |
| Android Gradle Plugin | 8.7.2 | 8.13.0 |
| Gradle | 8.11.1 | 8.14.3 |
| `com.google.gms:google-services` | 4.4.2 | 4.4.4 |
| iOS deployment target (Capacitor 8 floor) | 14.0 | 15.0 |
| `firebase` JS SDK (peer of the messaging plugin) | 11.x | 12.x |

Verified by a real local build: `assembleDebug` succeeds and the APK reports
`targetSdkVersion='36'`, `compileSdkVersion='36'`, `platformBuildVersionName='16'`.

Two follow-ons worth knowing:

- The `androidx.browser:browser:1.4.0` **resolution force in `android/build.gradle` is
  gone.** Its own comment said to revisit once AGP was upgraded — 1.9.0 needed AGP 8.9.1 +
  compileSdk 36, which we now have, and it resolves cleanly.
- **`native_build_min` in `mobile-ota-deploy.yml` went from `1` to `7000`.** A Capacitor 8
  web bundle must not be served over the air to a Capacitor 7 shell. See the comment at the
  top of that workflow; it also means the first Capacitor 8 store release has to be
  **≥ v0.7.0**.

### 4. iOS has never been built — **the long pole for the App Store**
`web/ios/` is scaffolded (`App.xcworkspace`, Podfile, Capacitor plugins, and
`GoogleService-Info.plist` is present) but nothing has ever been compiled. There is no iOS
workflow in `.github/workflows/` — Android only.

Needs a Mac: Apple requires, since 28 Apr 2026, that *"Apps uploaded to App Store Connect
must be built with Xcode 26 or later using an SDK for iOS 26."* Plus an Apple Developer
Program account, signing certificates, an App Store Connect API key, and a first TestFlight
build.

**The repo-side configuration is now done (2026-09-28)** — it needed no Mac, and the audit
that produced it found six problems, not the four first listed:

| Was | Now |
|---|---|
| No privacy manifest → submission refused since 12 Nov 2024 | `App/PrivacyInfo.xcprivacy`, in Copy Bundle Resources |
| No `.entitlements` at all → no push entitlement, no `aps-environment` | `App/App.entitlements`, wired via `CODE_SIGN_ENTITLEMENTS` on both configs |
| No `UIBackgroundModes` → no background push | `remote-notification` declared |
| No `ITSAppUsesNonExemptEncryption` → every upload re-asks export compliance | declared `false` |
| `AppDelegate` never forwarded the APNs token | the three methods `@capacitor-firebase/messaging` requires |
| **`GoogleService-Info.plist` was not in the Xcode target at all** | added to Copy Bundle Resources |
| `MARKETING_VERSION 1.0` / `CURRENT_PROJECT_VERSION 1` | `0.7.0` / `7000`, matching the Android `versionCode` scheme |

The `GoogleService-Info.plist` one is worth noting: the file sat on disk but had no
`PBXFileReference`, so it would never have reached the bundle and Firebase would have failed
to initialise at runtime. `web/MOBILE.md` §3 says "add to the Xcode target"; that had not been
done.

`npx cap sync ios` parses the rewritten project cleanly, and all four plists validate as XML.
None of it is compile-verified — that needs the Mac.

**Two things still block Google sign-in on iOS, and both are console work:**

1. **There is no iOS OAuth client.** The committed `GoogleService-Info.plist` has only the
   messaging keys — no `CLIENT_ID`, no `REVERSED_CLIENT_ID`. Create an iOS OAuth client for
   `tech.proyekto.app` in the Google Cloud console; that regenerates the file with both.
2. Then set **`VITE_GOOGLE_IOS_CLIENT_ID`** (the code reads it already — see `IOS_CLIENT_ID`
   in `web/src/services/googleAuth.ts`) and add the URL scheme to `ios/App/App/Info.plist`:

   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array><string>PASTE_REVERSED_CLIENT_ID_HERE</string></array>
     </dict>
   </array>
   ```

   No placeholder was committed on purpose: a wrong URL scheme fails exactly like a missing
   one, and a committed placeholder is easy to ship by accident.
   `isNativeGoogleAuthAvailable()` returns false on iOS until the env var is set, so today the
   button correctly falls back to the web redirect flow rather than opening a sheet that
   cannot complete.

### 5. Sign in with Apple — assess before the iOS build
The app offers email/password **and** native Google sign-in
(`@capgo/capacitor-social-login`, `web/src/services/googleAuth.ts`). Apple's requirement
bites when a third-party login is the *only* option; an equivalent first-party email/password
path normally satisfies it. Worth confirming against the current guideline text before
submitting rather than after a rejection.

### 6. Publishing is still dark
Both switches ship off, by design:
- `PLAY_PUBLISH_ENABLED` gates the Play upload step in `android-release.yml` (`track:
  internal`, `status: draft`), and needs `PLAY_SERVICE_ACCOUNT_JSON`.
- **Play will not accept the first upload over the API** — one AAB must be uploaded by hand
  in the Play Console before the Publishing API will take a track. Already noted in the
  workflow's comments.
- `OTA_PUBLISH_ENABLED` gates the OTA bundle publish.

### 7. Data Safety / App Privacy declarations
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
