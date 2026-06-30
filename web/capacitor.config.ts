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
  },
};

export default config;
