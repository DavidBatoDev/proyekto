// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPushStatus,
	setPushStatus,
	subscribePushStatus,
	tokenTail,
} from "./pushStatus";

beforeEach(() => {
	localStorage.clear();
	setPushStatus({ registered: false, tokenTail: null, lastError: null });
});

describe("pushStatus", () => {
	// useSyncExternalStore re-renders forever if the snapshot is a fresh object
	// on every call, so this is a load-bearing property, not a micro-optimisation.
	it("returns a referentially stable snapshot between writes", () => {
		const first = getPushStatus();

		expect(getPushStatus()).toBe(first);

		setPushStatus({ registered: true });
		expect(getPushStatus()).not.toBe(first);
	});

	it("notifies subscribers once per write and stops after unsubscribe", () => {
		const listener = vi.fn();
		const unsubscribe = subscribePushStatus(listener);

		setPushStatus({ registered: true });
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		setPushStatus({ registered: false });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("persists across a reload", async () => {
		setPushStatus({ tokenTail: "abc123", registered: true });

		vi.resetModules();
		const reloaded = await import("./pushStatus");

		expect(reloaded.getPushStatus().tokenTail).toBe("abc123");
		expect(reloaded.getPushStatus().registered).toBe(true);
	});

	it("survives corrupt storage rather than taking the app down with it", async () => {
		localStorage.setItem("proyekto.push.status", "{not json");

		vi.resetModules();
		const reloaded = await import("./pushStatus");

		expect(reloaded.getPushStatus().registered).toBe(false);
	});

	it("masks a token down to its tail", () => {
		// A full FCM token is a credential: anyone holding it can push to the
		// device, so it must never reach storage or the DOM.
		expect(tokenTail("fcm-token-abcdef")).toBe("abcdef");
	});
});
