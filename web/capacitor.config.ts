import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tech.proyekto.app',
  appName: 'Proyekto',
  // The Vite build output. `npm run cap:sync` builds then copies dist/ into the
  // native projects, so the apps ship the exact same web app.
  webDir: 'dist',
  server: {
    // Android WebView served from https://localhost (add to backend CORS_ORIGINS,
    // alongside capacitor://localhost used by iOS).
    androidScheme: 'https',
  },
  plugins: {
    // Controls how notifications appear while the app is in the FOREGROUND on
    // iOS. Without this iOS shows nothing in foreground (Android shows the tray
    // notification regardless). We also handle foreground via the
    // notificationReceived listener (see usePushNotifications).
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // Self-hosted OTA live updates (@capgo/capacitor-updater). The plugin checks
    // updateUrl on foreground, downloads a new web bundle in the background, and
    // applies it on the next cold start (directUpdate: false). updateUrl is baked
    // into the native binary, so it must be the absolute prod API URL. See
    // backend mobile-updates module + .github/workflows/mobile-ota-deploy.yml.
    CapacitorUpdater: {
      autoUpdate: true,
      directUpdate: false,
      updateUrl: 'https://api.proyekto.tech/api/mobile-updates/check',
      statsUrl: 'https://api.proyekto.tech/api/mobile-updates/stats',
      channelUrl: '',
      defaultChannel: 'production',
      appReadyTimeout: 10000,
      responseTimeout: 20,
      resetWhenUpdate: true,
    },
    // Native Google sign-in (@capgo/capacitor-social-login). The web OAuth
    // redirect cannot work inside the WebView — window.location.origin there is
    // https://localhost, which Supabase will not accept as a redirect, and there
    // is no BROWSABLE intent-filter to come back through. So the app uses
    // Android's Credential Manager and trades the returned Google ID token for a
    // Supabase session (see src/services/googleAuth.ts).
    //
    // Facebook and Twitter are off: the plugin defaults every provider to true,
    // which pulls the Facebook SDK into the APK for a button we do not have.
    //
    // Apple stays ON despite also being unused. Turning it off does NOT build:
    // Apple contributes androidx.browser:browser:1.9.0, while Google's
    // androidbrowserhelper:2.5.0 pins {strictly 1.4.0}, and with Apple demoted to
    // compileOnly the compile and runtime classpaths disagree —
    // ":capgo-capacitor-social-login:extractDebugAnnotations" then fails with
    // "Cannot find a version of androidx.browser:browser that satisfies the
    // version constraints". Verified both ways locally. It costs no SDK, only the
    // browser artifact Google already needs.
    //
    // These flags are written into node_modules, not the repo, so CI reproduces
    // them from this file via `npx cap sync`. Changing one needs a re-sync.
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
    // Android 15 (targetSdk 35) enforces edge-to-edge; the Android WebView's
    // env(safe-area-inset-*) is unreliable on Capacitor 7, so this plugin applies
    // the system-bar insets to the WebView — content stops drawing under the status
    // bar / gesture nav. Android-only (no-op on iOS/web).
    EdgeToEdge: {
      // Single key in v7 — colors BOTH the status bar and navigation bar.
      backgroundColor: '#ffffff',
    },
  },
};

export default config;
