import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AppUpdateRequirement,
	fetchAppUpdateRequirement,
} from "@/services/appUpdate.service";
import { getPlatform, isNativePlatform } from "@/services/pushNotifications";

const SNOOZE_KEY = "proyekto.appUpdate.snoozedUntil";
const SNOOZE_DAYS = 7;

function readSnoozedUntil(): number {
	try {
		return Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0) || 0;
	} catch {
		return 0;
	}
}

function writeSnooze(): void {
	try {
		const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
		window.localStorage.setItem(SNOOZE_KEY, String(until));
	} catch {
		// Private mode / blocked storage: the nudge just reappears next resume.
	}
}

export interface AppUpdateGateState {
	requirement: AppUpdateRequirement | null;
	/** True once a `required` result has come back — the caller must block. */
	isBlocking: boolean;
	/** True for an `optional` result the user has not snoozed. */
	isNudging: boolean;
	snooze: () => void;
}

/**
 * Decides whether to prompt the user to update the native app.
 *
 * Native-only: on web there is no shell to update, so this never fires and the
 * gate renders nothing. It re-checks on resume — the same moment the Capgo
 * plugin checks for a new web bundle — because that is when a device that has
 * just been cut off from OTA will first notice.
 *
 * `required` cannot be snoozed. Those shells are below `min_supported_build`,
 * which means `resolveUpdate` has stopped serving them OTA bundles: they can no
 * longer be fixed remotely, so a dismissible prompt would strand them silently.
 */
export function useAppUpdateGate(): AppUpdateGateState {
	const [requirement, setRequirement] = useState<AppUpdateRequirement | null>(
		null,
	);
	const [snoozedUntil, setSnoozedUntil] = useState<number>(() =>
		typeof window === "undefined" ? 0 : readSnoozedUntil(),
	);
	// Guards against overlapping checks when resume fires repeatedly.
	const inFlightRef = useRef(false);

	const check = useCallback(async () => {
		if (!isNativePlatform() || inFlightRef.current) return;
		inFlightRef.current = true;
		try {
			const { App } = await import("@capacitor/app");
			const info = await App.getInfo();
			const build = Number.parseInt(info.build, 10);
			if (Number.isNaN(build)) return;
			setRequirement(await fetchAppUpdateRequirement(getPlatform(), build));
		} catch {
			// getInfo is unavailable on some embedded webviews; stay silent.
		} finally {
			inFlightRef.current = false;
		}
	}, []);

	useEffect(() => {
		if (!isNativePlatform()) return;
		void check();

		let cancelled = false;
		let detach: (() => void) | undefined;
		void (async () => {
			const { App } = await import("@capacitor/app");
			const handle = await App.addListener("resume", () => {
				void check();
			});
			// The dynamic import can resolve after unmount; without this the
			// listener is attached and never removed.
			if (cancelled) void handle.remove();
			else
				detach = () => {
					void handle.remove();
				};
		})();

		return () => {
			cancelled = true;
			detach?.();
		};
	}, [check]);

	const snooze = useCallback(() => {
		writeSnooze();
		setSnoozedUntil(readSnoozedUntil());
	}, []);

	const status = requirement?.status ?? "ok";
	return {
		requirement,
		isBlocking: status === "required",
		isNudging: status === "optional" && Date.now() >= snoozedUntil,
		snooze,
	};
}
