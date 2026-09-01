// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
	native: true,
	platform: "android" as "android" | "ios" | "web",
	permission: "granted" as string,
	requestResult: "granted" as string,
	token: { ok: true, token: "fcm-token-abcdef" } as
		| { ok: true; token: string }
		| { ok: false; error: string },
	checkPermission: vi.fn(),
	requestPermission: vi.fn(),
	getToken: vi.fn(),
	register: vi.fn(),
}));

vi.mock("@/services/pushNotifications", () => ({
	isNativePlatform: () => push.native,
	getPlatform: () => push.platform,
	isPushSupported: async () => true,
	getAppVersion: async () => "0.3.1",
	getAppBuild: async () => "3001",
	checkPermission: push.checkPermission,
	requestPermission: push.requestPermission,
	getToken: push.getToken,
	ensureNotificationChannels: async () => {},
	listNotificationChannels: async () => ["General", "Chat messages"],
}));

vi.mock("@/services/deviceTokens.service", () => ({
	deviceTokensService: { register: push.register },
}));

import {
	resetPushRegistration,
	syncPushRegistration,
} from "./pushRegistration";
import { setPushStatus } from "./pushStatus";

beforeEach(() => {
	localStorage.clear();
	resetPushRegistration();
	push.native = true;
	push.platform = "android";
	push.permission = "granted";
	push.requestResult = "granted";
	push.token = { ok: true, token: "fcm-token-abcdef" };
	push.checkPermission
		.mockReset()
		.mockImplementation(async () => push.permission);
	push.requestPermission
		.mockReset()
		.mockImplementation(async () => push.requestResult);
	push.getToken.mockReset().mockImplementation(async () => push.token);
	push.register.mockReset().mockResolvedValue(undefined);
	setPushStatus({
		registered: false,
		tokenTail: null,
		lastError: null,
		permission: "prompt",
	});
});

describe("syncPushRegistration", () => {
	// The regression test. Registration used to sit behind a permission gate, so
	// a denied Android prompt meant the token was never sent — which is exactly
	// what kept device_tokens empty in production for two months.
	it("registers the token on Android even when the permission is denied", async () => {
		push.permission = "denied";

		const status = await syncPushRegistration({ trigger: "auth" });

		expect(push.getToken).toHaveBeenCalledTimes(1);
		expect(push.register).toHaveBeenCalledTimes(1);
		expect(status.registered).toBe(true);
		expect(status.permission).toBe("denied");
	});

	it("does not re-prompt on Android once the permission is denied", async () => {
		push.permission = "denied";

		await syncPushRegistration({ trigger: "auth" });
		await syncPushRegistration({ trigger: "resume" });

		expect(push.requestPermission).not.toHaveBeenCalled();
	});

	it("skips the token on iOS until notifications are authorized", async () => {
		push.platform = "ios";
		push.permission = "denied";

		const status = await syncPushRegistration({ trigger: "auth" });

		// APNs issues no token without authorization; asking would only churn.
		expect(push.getToken).not.toHaveBeenCalled();
		expect(push.register).not.toHaveBeenCalled();
		expect(status.registered).toBe(false);
		expect(status.lastError).toMatch(/iOS/);
	});

	it("prompts then registers on iOS when the user allows it", async () => {
		push.platform = "ios";
		push.permission = "prompt";
		push.requestResult = "granted";

		const status = await syncPushRegistration({
			trigger: "manual",
			allowPrompt: true,
		});

		expect(push.requestPermission).toHaveBeenCalledTimes(1);
		expect(push.register).toHaveBeenCalledTimes(1);
		expect(status.registered).toBe(true);
	});

	it("records a rejected POST verbatim instead of swallowing it", async () => {
		push.register.mockRejectedValue({
			response: { status: 401, data: { message: "Unauthorized" } },
		});

		const status = await syncPushRegistration({ trigger: "auth" });

		expect(status.registered).toBe(false);
		expect(status.lastError).toBe("HTTP 401: Unauthorized");
	});

	it("records why getToken failed", async () => {
		push.token = { ok: false, error: "SERVICE_NOT_AVAILABLE" };

		const status = await syncPushRegistration({ trigger: "auth" });

		expect(status.registered).toBe(false);
		expect(status.lastError).toBe("SERVICE_NOT_AVAILABLE");
	});

	it("throttles repeat runs but always honours a manual retry", async () => {
		await syncPushRegistration({ trigger: "auth" });
		expect(push.register).toHaveBeenCalledTimes(1);

		await syncPushRegistration({ trigger: "resume" });
		expect(push.register).toHaveBeenCalledTimes(1);

		await syncPushRegistration({ trigger: "manual" });
		expect(push.register).toHaveBeenCalledTimes(2);
	});

	it("re-registers when the token changes", async () => {
		await syncPushRegistration({ trigger: "auth" });
		push.token = { ok: true, token: "fcm-token-999999" };

		const status = await syncPushRegistration({ trigger: "token-refresh" });

		expect(push.register).toHaveBeenCalledTimes(2);
		expect(status.tokenTail).toBe("999999");
	});

	it("touches no plugin at all on the web", async () => {
		push.native = false;

		const status = await syncPushRegistration({ trigger: "auth" });

		expect(push.checkPermission).not.toHaveBeenCalled();
		expect(push.getToken).not.toHaveBeenCalled();
		expect(status.supported).toBe(false);
	});

	it("resolves rather than throwing when the plugin blows up", async () => {
		push.checkPermission.mockRejectedValue(new Error("bridge exploded"));

		const status = await syncPushRegistration({ trigger: "auth" });

		expect(status.lastError).toBe("bridge exploded");
	});
});
