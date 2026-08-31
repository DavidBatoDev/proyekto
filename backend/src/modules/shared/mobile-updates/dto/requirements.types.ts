// The native-shell update gate. Distinct from the Capgo OTA check: that decides
// which *web bundle* a device may download, this decides whether the *native
// shell* itself is too old and the user should be sent to the store.

/**
 * - `ok`       — nothing to do.
 * - `optional` — a newer store build exists; prompt, but let it be dismissed.
 * - `required` — this shell is below `min_supported_build`. These are the
 *                devices `resolveUpdate` has stopped serving OTA bundles to, so
 *                they can no longer be fixed remotely; the prompt blocks.
 */
export type AppUpdateStatus = 'ok' | 'optional' | 'required';

export interface RequirementQuery {
  platform?: string; // 'android' | 'ios'
  build?: string; // versionCode / CFBundleVersion, as a query string
  channel?: string;
}

export interface RequirementResult {
  status: AppUpdateStatus;
  /** Marketing version of the newest store build, e.g. "1.0.0". Null when unknown. */
  latestVersion: string | null;
  latestBuild: number | null;
  storeUrl: string | null;
  /** Optional copy override, so the prompt can be reworded without a release. */
  message: string | null;
}

/**
 * The fail-open answer. Returned for unknown platforms, unparseable builds, a
 * missing row, or a query error — an outage must never lock users behind a
 * blocking dialog.
 */
export const NO_UPDATE_REQUIRED: RequirementResult = {
  status: 'ok',
  latestVersion: null,
  latestBuild: null,
  storeUrl: null,
  message: null,
};
