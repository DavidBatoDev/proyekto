// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateRequirement } from "@/services/appUpdate.service";

const state = vi.hoisted(() => ({
	requirement: null as AppUpdateRequirement | null,
	snooze: vi.fn(),
}));

vi.mock("@/hooks/useAppUpdateGate", () => ({
	useAppUpdateGate: () => {
		const status = state.requirement?.status ?? "ok";
		return {
			requirement: state.requirement,
			isBlocking: status === "required",
			isNudging: status === "optional",
			snooze: state.snooze,
		};
	},
}));

import { AppUpdateGate } from "./AppUpdateGate";

const STORE_URL =
	"https://play.google.com/store/apps/details?id=tech.proyekto.app";

const requirement = (
	over: Partial<AppUpdateRequirement>,
): AppUpdateRequirement => ({
	status: "ok",
	latestVersion: "2.0.0",
	latestBuild: 2000,
	storeUrl: STORE_URL,
	message: null,
	...over,
});

beforeEach(() => {
	state.requirement = null;
	state.snooze.mockClear();
	vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("AppUpdateGate", () => {
	it("renders nothing when the app is up to date", () => {
		state.requirement = requirement({ status: "ok" });
		const { container } = render(<AppUpdateGate />);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing without a store URL to send anyone to", () => {
		state.requirement = requirement({ status: "required", storeUrl: null });
		const { container } = render(<AppUpdateGate />);
		expect(container.innerHTML).toBe("");
	});

	it("blocks on a required update, with no way to dismiss", () => {
		state.requirement = requirement({ status: "required" });
		render(<AppUpdateGate />);

		expect(screen.getByText("Update required")).toBeTruthy();
		// The escape hatches a normal dialog offers must all be absent.
		expect(screen.queryByRole("button", { name: /not now/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.getByText("Update required")).toBeTruthy();
	});

	it("sends a blocked user to the store", () => {
		state.requirement = requirement({ status: "required" });
		render(<AppUpdateGate />);

		fireEvent.click(screen.getByRole("button", { name: "Update now" }));
		expect(window.open).toHaveBeenCalledWith(STORE_URL, "_system");
	});

	it("offers a dismissible nudge for an optional update", () => {
		state.requirement = requirement({ status: "optional" });
		render(<AppUpdateGate />);

		expect(screen.getByText("Update available")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Not now" }));
		expect(state.snooze).toHaveBeenCalledTimes(1);
	});

	it("prefers the server's copy over the default", () => {
		state.requirement = requirement({
			status: "required",
			message: "Scheduled maintenance requires the latest app.",
		});
		render(<AppUpdateGate />);

		expect(
			screen.getByText("Scheduled maintenance requires the latest app."),
		).toBeTruthy();
		expect(screen.queryByText(/can no longer receive updates/)).toBeNull();
	});

	it("shows the target version", () => {
		state.requirement = requirement({ status: "optional" });
		render(<AppUpdateGate />);
		expect(screen.getByText("Version 2.0.0")).toBeTruthy();
	});
});
