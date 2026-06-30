// Request bodies sent by the @capgo/capacitor-updater plugin to the self-hosted
// update server. These are plain interfaces (not validated DTO classes) on
// purpose: the plugin sends ~15 fields and may add more across versions, so we
// let the global ValidationPipe skip them (Object metatype) and parse
// defensively in the service. Never 400 the hot path.

export interface CapgoCheckBody {
  platform?: string; // 'android' | 'ios'
  device_id?: string;
  app_id?: string;
  custom_id?: string;
  version_build?: string; // native build (versionCode / CFBundleVersion), e.g. "1"
  version_code?: string;
  version_os?: string;
  version_name?: string; // currently-active bundle version (or native versionName)
  plugin_version?: string;
  is_emulator?: boolean;
  is_prod?: boolean;
  install_source?: string;
  defaultChannel?: string;
}

export interface CapgoStatsBody {
  platform?: string;
  device_id?: string;
  app_id?: string;
  version_name?: string;
  action?: string;
  version?: string;
}

/** No-update sentinel the plugin understands. */
export interface NoUpdateResult {
  error: string;
  message: string;
}

/** Update-available response the plugin downloads + applies. */
export interface UpdateResult {
  version: string;
  url: string;
  checksum: string;
}

export type CheckResult = UpdateResult | NoUpdateResult;
