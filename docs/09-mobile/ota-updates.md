# OTA Updates

> **Last updated:** 2026-07-09 · **Status:** current

Because the mobile app is a web bundle in a native shell, almost all changes can ship
**over-the-air** — no app-store review. OTA is self-hosted: `@capgo/capacitor-updater`
points at the backend `mobile-updates` module, with bundles stored in **R2**. The one
rule to internalize is **native compatibility**: OTA may only ship web-only changes.

> Self-hosted, no paid SaaS. CI builds `dist/`, uploads a zip to R2, and registers it;
> the app checks on foreground and applies the newest compatible bundle on next cold
> start, auto-rolling-back a bundle that fails to boot.

## The flow

```
merge to main (web/**) ─► mobile-ota-deploy.yml: build dist/, zip, sha256,
                          presign R2, PUT zip, POST /api/mobile-updates/bundles
app foreground ─► POST /api/mobile-updates/check ─► { version, url, checksum } | no-update
              ─► plugin downloads in background ─► applies on next cold start
              ─► notifyAppReady() confirms a good boot (else auto-rollback)
```

Bundles are registered in the `mobile_app_bundles` table (`mobile_bundle_platform`,
`mobile_bundle_status` = published \| rolled_back, channel). The check endpoint returns
the latest **published, native-compatible** bundle. `directUpdate: false` means updates
apply on the next cold start, not mid-session.

## Native compatibility

> **⚠️ The rule.** Each bundle carries **`native_build_min`** (a native
> `versionCode`), and the check endpoint only serves a bundle to a shell whose build
> is `>= native_build_min`. So:
>
> - **Pure JS/HTML/CSS change** → keep the default `native_build_min` (currently `1`)
>   → OTA-only, no store release.
> - **Anything touching native** (new/upgraded Capacitor plugin, new permission,
>   `capacitor.config.ts`, icon/splash, Capacitor version bump) → **requires a store
>   release**: bump the native build, publish to the store, then run the OTA workflow
>   with `native_build_min` = the new build (via `workflow_dispatch`).
>
> Shipping a web bundle that calls a missing native API to an old shell crashes at
> runtime. This is the single most important OTA rule.

## Enabling (ship-dark)

1. Generate a strong `OTA_PUBLISH_TOKEN`; add it to `backend/.env`, GCP Secret
   Manager (`OTA_PUBLISH_TOKEN`), and GitHub repo secrets (so CI can publish).
2. Set the repo variable **`OTA_PUBLISH_ENABLED`** to any non-empty value — the deploy
   injects the secret into Cloud Run and the OTA workflow stops being a no-op.

## Publish & rollback

- **Manual publish** — `workflow_dispatch` the OTA workflow (optionally set
  `native_build_min`), or curl `presign → PUT zip → bundles` with
  `Authorization: Bearer $OTA_PUBLISH_TOKEN`.
- **Rollback** — mark the bad row `status='rolled_back'` (devices stop being offered
  it), then **re-run the OTA workflow on the last-good commit**. That publishes a *new
  higher* version, so devices roll **forward** to good code. Never re-serve an older
  row (a downgrade).

> First-time note: OTA only updates an already-installed shell that contains the Capgo
> plugin. The first such shell must ship via the store; after that, web changes flow
> over OTA. (A past bundle 1.2 shipped a localhost-baked build and was rolled back —
> the fix baked the correct production API URL; see
> [`web/.env.production`](../../web/.env.production).)

## Code locations

- **Backend:** [`backend/src/modules/mobile-updates/`](../../backend/src/modules/mobile-updates/)
- **CI:** [`.github/workflows/mobile-ota-deploy.yml`](../../.github/workflows/mobile-ota-deploy.yml)
- **Web:** `web/src/main.tsx` (`notifyAppReady`), Capgo plugin config
- **Full guide:** [`web/MOBILE.md`](../../web/MOBILE.md) §9

## See also

- [capacitor.md](./capacitor.md) — the two update layers.
- [Storage & Media](../08-storage-media/README.md) — where OTA bundles live (R2).
