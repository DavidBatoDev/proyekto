import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANNEL_GENERAL } from "@/services/pushNotifications";

/**
 * Filesystem guard for the Android notification assets.
 *
 * These live outside the TypeScript build, so nothing else would notice them
 * disappearing — and `npx @capacitor/assets generate` REWRITES
 * AndroidManifest.xml, which silently strips the meta-data below and puts the
 * grey-square status-bar icon back. That is a plausible future accident, so it
 * fails here rather than in a store build nobody inspects.
 *
 * Regenerate the drawables with: node render-final-assets.mjs notification
 */
const RES = join(process.cwd(), "android/app/src/main/res");

const DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];

describe("android notification assets", () => {
	const manifest = readFileSync(
		join(process.cwd(), "android/app/src/main/AndroidManifest.xml"),
		"utf8",
	);

	it("points Firebase at the monochrome status-bar icon", () => {
		expect(manifest).toContain(
			"com.google.firebase.messaging.default_notification_icon",
		);
		expect(manifest).toContain("@drawable/ic_stat_proyekto");
	});

	it("sets the notification accent colour", () => {
		expect(manifest).toContain(
			"com.google.firebase.messaging.default_notification_color",
		);
		expect(manifest).toContain("@color/notification_accent");

		const colors = readFileSync(join(RES, "values/colors.xml"), "utf8");
		expect(colors).toMatch(/name="notification_accent"/);
	});

	it("names a default channel the app actually creates", () => {
		expect(manifest).toContain(
			"com.google.firebase.messaging.default_notification_channel_id",
		);
		// A channel id the app never creates makes Android fall back to Firebase's
		// own "Miscellaneous", which is the ungrouped tray we are trying to leave.
		expect(manifest).toContain(`android:value="${CHANNEL_GENERAL}"`);
	});

	it.each(DENSITIES)("ships a %s status-bar icon", (density) => {
		const file = join(RES, `drawable-${density}`, "ic_stat_proyekto.png");
		expect(existsSync(file)).toBe(true);
		expect(statSync(file).size).toBeGreaterThan(0);
	});
});
