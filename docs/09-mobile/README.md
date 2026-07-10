# Mobile

> **Last updated:** 2026-07-09 · **Status:** current

The Android and iOS apps are the `web/` app wrapped with **Capacitor** — same
codebase, running in a native WebView. Push is **FCM**, and product changes ship
**over-the-air** as web bundles, with a store release only when something native
changes.

> If you only read one page, read [capacitor.md](./capacitor.md). The full in-repo
> setup guide is [`web/MOBILE.md`](../../web/MOBILE.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [capacitor.md](./capacitor.md) | The Capacitor wrapper, build/run, the two update layers, native releases |
| [push-fcm.md](./push-fcm.md) | FCM push — the flow, backend credentials (keyless ADC), enabling |
| [ota-updates.md](./ota-updates.md) | Self-hosted web-bundle OTA, the native-compatibility rule, publish/rollback |

## Glossary

| Term | Meaning |
| --- | --- |
| **Capacitor** | The native shell that runs the web build in a WebView. |
| **OTA / Live Update** | Shipping a new web bundle to installed apps without a store release. |
| **`native_build_min`** | The minimum native build a bundle is compatible with — the OTA safety rule. |
| **Keyless ADC** | FCM auth via Application Default Credentials — no stored key. |
| **Ship-dark** | Deployed but off until `FCM_PUSH_ENABLED` / `OTA_PUBLISH_ENABLED` are set. |

## Code locations

- **Native shells:** [`web/android/`](../../web/android/), [`web/ios/`](../../web/ios/), [`web/capacitor.config.ts`](../../web/capacitor.config.ts)
- **Backend:** [`backend/src/modules/push/`](../../backend/src/modules/push/), [`backend/src/modules/mobile-updates/`](../../backend/src/modules/mobile-updates/)
- **CI:** `android-release.yml`, `mobile-ota-deploy.yml` in [`.github/workflows/`](../../.github/workflows/)
- **Guide:** [`web/MOBILE.md`](../../web/MOBILE.md)
