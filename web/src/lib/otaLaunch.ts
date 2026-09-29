import type { BundleInfo, CurrentBundleResult } from "@capgo/capacitor-updater";

/**
 * Apply a downloaded OTA bundle at launch.
 *
 * With `directUpdate: false` the updater installs a downloaded bundle only when
 * it sees the app move to the background. On Android 14+ that signal comes from
 * ProcessLifecycleOwner, which fires ~700 ms after the last activity stops, so
 * swiping the app away from recents kills the process first and the bundle is
 * never installed; a cold start just re-queues it. A user who always closes the
 * app that way stays on the old bundle forever (seen in the ota-stat logs:
 * `set_next` repeated, never `set`).
 *
 * So at launch, if a bundle is already waiting, apply it now: `reload()` installs
 * the pending bundle before reloading (both platforms). Launch is the only safe
 * moment — reloading on a mid-session pause would kill the Google/Apple sign-in
 * sheet, the file picker and the camera, which all background the WebView.
 *
 * Once per bundle id per WebView session, so a bundle that fails to apply can't
 * loop the app; a bundle the updater already marked failed is skipped.
 */

export interface OtaUpdater {
	current(): Promise<CurrentBundleResult>;
	getNextBundle(): Promise<BundleInfo | null>;
	reload(): Promise<void>;
}

export const OTA_LAUNCH_ATTEMPT_KEY = "proyekto.ota.launchApply";

const APPLICABLE: ReadonlySet<BundleInfo["status"]> = new Set([
	"pending",
	"success",
]);

export async function applyPendingBundleOnLaunch(
	updater: OtaUpdater,
	storage: Pick<Storage, "getItem" | "setItem"> | null,
): Promise<boolean> {
	try {
		const next = await updater.getNextBundle();
		if (!next || !APPLICABLE.has(next.status)) return false;

		const { bundle: current } = await updater.current();
		if (next.id === current.id) return false;

		try {
			if (storage?.getItem(OTA_LAUNCH_ATTEMPT_KEY) === next.id) return false;
			storage?.setItem(OTA_LAUNCH_ATTEMPT_KEY, next.id);
		} catch {
			// Storage blocked: still apply once; the updater's own error status
			// stops a broken bundle from being retried.
		}

		await updater.reload();
		return true;
	} catch {
		return false;
	}
}
