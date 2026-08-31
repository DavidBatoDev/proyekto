import apiClient from "@/api/axios";
import type { DevicePlatform } from "./deviceTokens.service";

export type AppUpdateStatus = "ok" | "optional" | "required";

export interface AppUpdateRequirement {
	status: AppUpdateStatus;
	latestVersion: string | null;
	latestBuild: number | null;
	storeUrl: string | null;
	message: string | null;
}

/** Fail-open answer, mirroring the backend's NO_UPDATE_REQUIRED. */
const NO_UPDATE: AppUpdateRequirement = {
	status: "ok",
	latestVersion: null,
	latestBuild: null,
	storeUrl: null,
	message: null,
};

/**
 * Asks the backend whether the running NATIVE shell is too old.
 *
 * Distinct from the Capgo OTA check: that decides which web bundle a device may
 * download, this decides whether the shell itself needs a trip to the store.
 * The endpoint is public — the gate has to work for a signed-out app.
 *
 * Never throws. The whole point of the gate is a blocking dialog, so a network
 * blip must not be able to produce one.
 */
export async function fetchAppUpdateRequirement(
	platform: DevicePlatform,
	build: number,
): Promise<AppUpdateRequirement> {
	try {
		const { data } = await apiClient.get("/api/mobile-updates/requirements", {
			params: { platform, build },
		});
		const payload = (data?.data ?? data) as AppUpdateRequirement | undefined;
		if (!payload || typeof payload.status !== "string") return NO_UPDATE;
		return payload;
	} catch {
		return NO_UPDATE;
	}
}
