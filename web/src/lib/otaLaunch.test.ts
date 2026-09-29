import type { BundleInfo } from "@capgo/capacitor-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyPendingBundleOnLaunch,
	OTA_LAUNCH_ATTEMPT_KEY,
	type OtaUpdater,
} from "./otaLaunch";

const bundle = (
	id: string,
	status: BundleInfo["status"] = "success",
): BundleInfo => ({
	id,
	version: `7000.${id}`,
	downloaded: "",
	checksum: "",
	status,
});

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
	};
}

describe("applyPendingBundleOnLaunch", () => {
	let next: BundleInfo | null;
	let updater: OtaUpdater & { reload: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		next = bundle("213", "pending");
		updater = {
			current: vi.fn(async () => ({ bundle: bundle("212"), native: "0.7.2" })),
			getNextBundle: vi.fn(async () => next),
			reload: vi.fn(async () => {}),
		};
	});

	it("applies a bundle that is waiting from the last session", async () => {
		expect(await applyPendingBundleOnLaunch(updater, memoryStorage())).toBe(
			true,
		);
		expect(updater.reload).toHaveBeenCalledTimes(1);
	});

	it("does nothing when no bundle is waiting", async () => {
		next = null;
		expect(await applyPendingBundleOnLaunch(updater, memoryStorage())).toBe(
			false,
		);
		expect(updater.reload).not.toHaveBeenCalled();
	});

	it("skips a bundle that is still downloading or already failed", async () => {
		for (const status of ["downloading", "error", "deleting"] as const) {
			next = bundle("213", status);
			await applyPendingBundleOnLaunch(updater, memoryStorage());
		}
		expect(updater.reload).not.toHaveBeenCalled();
	});

	it("does nothing when the waiting bundle is already running", async () => {
		next = bundle("212", "pending");
		await applyPendingBundleOnLaunch(updater, memoryStorage());
		expect(updater.reload).not.toHaveBeenCalled();
	});

	it("tries each bundle once per session, so a bad bundle cannot loop", async () => {
		const storage = memoryStorage();
		await applyPendingBundleOnLaunch(updater, storage);
		await applyPendingBundleOnLaunch(updater, storage);
		expect(updater.reload).toHaveBeenCalledTimes(1);
		expect(storage.getItem(OTA_LAUNCH_ATTEMPT_KEY)).toBe("213");

		next = bundle("217", "pending");
		await applyPendingBundleOnLaunch(updater, storage);
		expect(updater.reload).toHaveBeenCalledTimes(2);
	});

	it("still applies when storage is unavailable", async () => {
		expect(await applyPendingBundleOnLaunch(updater, null)).toBe(true);
	});

	it("swallows plugin errors (web build has no native bridge)", async () => {
		updater.getNextBundle = vi.fn(async () => {
			throw new Error("not implemented on web");
		});
		expect(await applyPendingBundleOnLaunch(updater, memoryStorage())).toBe(
			false,
		);
	});
});
