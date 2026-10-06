/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { handleBackPress } from "@/lib/backStack";
import type { UnavailableOption } from "@/services/time.types";
import { WhyPersonalPopover, whyPersonalLines } from "./WhyPersonalPopover";

const PLAN_LINE =
	"Your workspace's plan doesn't include timesheets; this time is just for you.";

function unavailable(
	reason: UnavailableOption["reason"],
	label: string,
	kind: UnavailableOption["kind"] = "team",
): UnavailableOption {
	return { kind, id: `${kind}-${label}`, label, reason };
}

afterEach(() => {
	cleanup();
});

describe("whyPersonalLines", () => {
	it("plan: the P1b sentence, without repeating plan rows", () => {
		expect(
			whyPersonalLines("plan", [
				unavailable("plan", "Acme", "workspace"),
				unavailable("plan", "Design"),
			]),
		).toEqual([PLAN_LINE]);
	});

	it("no governed option: just you, then each ruled-out option once", () => {
		expect(
			whyPersonalLines(
				"no_governed_option",
				[
					unavailable("team_time_off", "Design"),
					unavailable("team_time_off", "Ops"),
					unavailable("engagement_inactive", "Acme Corp", "assignment"),
				],
				{ ownerName: "Prodigitality" },
			),
		).toEqual([
			"This time is just for you.",
			"Prodigitality has time tracking off for this team.",
			"Your agreement with Acme Corp has ended.",
		]);
	});

	it("a team row reads the workspace the server named on it (A-4), else ownerName", () => {
		const named = (
			reason: UnavailableOption["reason"],
			label: string,
			workspaceName: string,
		) => ({ ...unavailable(reason, label), workspace_name: workspaceName });
		expect(
			whyPersonalLines(
				"no_governed_option",
				[
					named("plan", "Design", "Prodigitality"),
					named("team_time_off", "Ops", "Pixel Studio"),
					unavailable("team_time_off", "QA"),
					unavailable("plan", "Acme", "workspace"),
				],
				{ ownerName: "Northwind" },
			),
		).toEqual([
			"This time is just for you.",
			"Prodigitality's plan doesn't include timesheets.",
			"Pixel Studio has time tracking off for this team.",
			"Northwind has time tracking off for this team.",
			// ownerName is a team's workspace: a workspace row keeps its own name.
			"Acme's plan doesn't include timesheets.",
		]);
	});

	it("an unknown reason reads as just you", () => {
		expect(whyPersonalLines(null)).toEqual(["This time is just for you."]);
	});
});

describe("WhyPersonalPopover", () => {
	it("opens from Why? and closes on Escape", async () => {
		render(<WhyPersonalPopover reason="plan" />);
		const trigger = screen.getByRole("button", { name: "Why?" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		const dialog = await screen.findByRole("dialog", { name: "Why Just me" });
		expect(dialog.textContent).toContain(PLAN_LINE);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("closes on the Android back button (every anchored popover does)", async () => {
		render(<WhyPersonalPopover reason="plan" />);
		fireEvent.click(screen.getByRole("button", { name: "Why?" }));
		await screen.findByRole("dialog", { name: "Why Just me" });
		let handled = false;
		act(() => {
			handled = handleBackPress();
		});
		expect(handled).toBe(true);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		// Nothing open any more: back belongs to the page again.
		expect(handleBackPress()).toBe(false);
	});

	it("takes a custom trigger label", () => {
		render(<WhyPersonalPopover reason={null} label="Why just me?" />);
		expect(screen.getByRole("button", { name: "Why just me?" })).toBeTruthy();
	});
});
