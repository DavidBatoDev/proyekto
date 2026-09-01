import { useCallback, useSyncExternalStore } from "react";
import {
	canOpenSystemNotificationSettings,
	openSystemNotificationSettings,
} from "@/services/pushNotifications";
import {
	refreshPushStatus,
	syncPushRegistration,
} from "@/services/pushRegistration";
import {
	getPushStatus,
	type PushStatus,
	subscribePushStatus,
} from "@/services/pushStatus";

export interface UsePushStatus {
	status: PushStatus;
	/** Permission is granted AND the backend has this device's token. */
	isWorking: boolean;
	/** Android will not ask again; only system settings can undo this. */
	isBlocked: boolean;
	canOpenSettings: boolean;
	/** Prompt for permission and register. For a deliberate user action. */
	enable: () => Promise<PushStatus>;
	/** Re-run registration without prompting. */
	retry: () => Promise<PushStatus>;
	refresh: () => Promise<PushStatus>;
	openSettings: () => Promise<boolean>;
}

/**
 * Live view of native push registration, for the Settings screen.
 *
 * `getPushStatus` returns the store's cached object, which stays referentially
 * stable between writes — `useSyncExternalStore` re-renders forever if the
 * snapshot is a fresh object each call.
 */
export function usePushStatus(): UsePushStatus {
	const status = useSyncExternalStore(
		subscribePushStatus,
		getPushStatus,
		getPushStatus,
	);

	const enable = useCallback(
		() => syncPushRegistration({ trigger: "manual", allowPrompt: true }),
		[],
	);
	const retry = useCallback(
		() => syncPushRegistration({ trigger: "manual" }),
		[],
	);
	const refresh = useCallback(() => refreshPushStatus(), []);
	const openSettings = useCallback(() => openSystemNotificationSettings(), []);

	return {
		status,
		isWorking: status.permission === "granted" && status.registered,
		isBlocked: status.permission === "denied",
		canOpenSettings: canOpenSystemNotificationSettings(),
		enable,
		retry,
		refresh,
		openSettings,
	};
}
