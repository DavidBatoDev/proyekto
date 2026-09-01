// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushStatus } from "@/services/pushStatus";

const state = vi.hoisted(() => ({
	native: true,
	canOpenSettings: true,
	status: {} as PushStatus,
	enable: vi.fn(),
	retry: vi.fn(),
	openSettings: vi.fn(),
}));

vi.mock("@/services/pushNotifications", () => ({
	isNativePlatform: () => state.native,
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/hooks/usePushStatus", () => ({
	usePushStatus: () => ({
		status: state.status,
		isWorking: state.status.permission === "granted" && state.status.registered,
		isBlocked: state.status.permission === "denied",
		canOpenSettings: state.canOpenSettings,
		enable: state.enable,
		retry: state.retry,
		refresh: vi.fn().mockResolvedValue(state.status),
		openSettings: state.openSettings,
	}),
}));

import { PushNotificationsSection } from "./PushNotificationsSection";

const TOKEN_TAIL = "a91f3c";

const baseStatus = (overrides: Partial<PushStatus> = {}): PushStatus => ({
	checkedAt: new Date().toISOString(),
	trigger: "auth",
	platform: "android",
	appVersion: "0.3.1",
	appBuild: "3001",
	supported: true,
	permission: "granted",
	tokenTail: TOKEN_TAIL,
	registered: true,
	registeredAt: new Date().toISOString(),
	lastError: null,
	channels: ["General", "Chat messages"],
	...overrides,
});

const renderWith = (status: PushStatus, canOpenSettings = true) => {
	state.status = status;
	state.canOpenSettings = canOpenSettings;
	state.native = true;
	return render(<PushNotificationsSection />);
};

afterEach(cleanup);

describe("PushNotificationsSection", () => {
	it("confirms when push is actually working", () => {
		renderWith(baseStatus());

		expect(screen.getByText(/Push notifications are on/i)).toBeTruthy();
		expect(screen.getByText(/Registered ·+a91f3c/)).toBeTruthy();
	});

	it("offers the system-settings deep link when the permission is blocked", () => {
		renderWith(baseStatus({ permission: "denied", registered: false }));

		expect(screen.getByText(/Blocked in system settings/i)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /Open system settings/i }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Enable/i })).toBeNull();
	});

	// The OTA-compatibility case: this bundle also runs on build-3000 shells,
	// which have no NativeSettings plugin. The button must disappear and the
	// written route must take its place rather than the user being stuck.
	it("falls back to written instructions when the shell has no settings plugin", () => {
		renderWith(baseStatus({ permission: "denied", registered: false }), false);

		expect(
			screen.queryByRole("button", { name: /Open system settings/i }),
		).toBeNull();
		expect(
			screen.getByText(/Settings → Apps → Proyekto → Notifications/),
		).toBeTruthy();
	});

	it("offers Enable while the permission has not been asked for", () => {
		renderWith(baseStatus({ permission: "prompt", registered: false }));

		expect(
			screen.getByRole("button", { name: /Enable notifications/i }),
		).toBeTruthy();
	});

	it("shows the raw permission value and the verbatim error", () => {
		renderWith(
			baseStatus({
				permission: "prompt-with-rationale",
				registered: false,
				lastError: "HTTP 401: Unauthorized",
			}),
		);

		// The raw plugin value is deliberately on screen — a friendly summary is
		// what made this class of failure undiagnosable.
		expect(screen.getByText(/prompt-with-rationale/)).toBeTruthy();
		expect(screen.getByText("HTTP 401: Unauthorized")).toBeTruthy();
	});

	it("never renders the full token", () => {
		const { container } = renderWith(baseStatus());

		expect(container.textContent).not.toMatch(/fcm-token/);
		expect(container.textContent).toContain(TOKEN_TAIL);
	});

	it("renders an informational card with no actions on the web", () => {
		state.status = baseStatus();
		state.native = false;

		render(<PushNotificationsSection />);

		expect(
			screen.getByText(/delivered by the Proyekto mobile app/i),
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
