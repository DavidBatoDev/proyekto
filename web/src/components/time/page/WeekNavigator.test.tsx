/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { WEEK_NAV_COPY, WeekNavigator } from "./WeekNavigator";

const WEEK = { start: "2026-09-28", end: "2026-10-04" };

function renderNav(over: Partial<Parameters<typeof WeekNavigator>[0]> = {}) {
	const handlers = {
		onPrevious: vi.fn(),
		onNext: vi.fn(),
		onThisWeek: vi.fn(),
	};
	const view = render(
		<WeekNavigator week={WEEK} isCurrentWeek={false} {...handlers} {...over} />,
	);
	return { ...view, ...handlers };
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("WeekNavigator", () => {
	it("shows the week with its year and steps with ‹ › and This week", () => {
		const { onPrevious, onNext, onThisWeek } = renderNav();
		expect(screen.getByTestId("time-week-range").textContent).toBe(
			"Sep 28 – Oct 4, 2026",
		);
		fireEvent.click(
			screen.getByRole("button", { name: WEEK_NAV_COPY.previous }),
		);
		fireEvent.click(screen.getByRole("button", { name: WEEK_NAV_COPY.next }));
		fireEvent.click(screen.getByRole("button", { name: "This week" }));
		expect(onPrevious).toHaveBeenCalledTimes(1);
		expect(onNext).toHaveBeenCalledTimes(1);
		expect(onThisWeek).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("navigation", { name: "Week" })).toBeTruthy();
	});

	it("disables This week on the current week", () => {
		renderNav({ isCurrentWeek: true });
		expect(
			(screen.getByRole("button", { name: "This week" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("shows the zone label with the ⓘ sentence, and the settings slot", () => {
		renderNav({
			zoneText: "Your time (Asia/Manila)",
			settings: <button type="button">Your time settings</button>,
		});
		const label = screen.getByTestId("time-zone-label");
		expect(label.textContent).toContain("Your time (Asia/Manila)");
		expect(label.textContent).toContain(
			"Timesheets count days in their own timezone.",
		);
		expect(
			screen.getByRole("button", { name: "Your time settings" }),
		).toBeTruthy();
	});

	it("hides the zone label when there is none", () => {
		renderNav({ zoneText: null });
		expect(screen.queryByTestId("time-zone-label")).toBeNull();
	});

	it("moves with j (next), k (previous) and t (this week)", () => {
		const { onPrevious, onNext, onThisWeek } = renderNav();
		fireEvent.keyDown(window, { key: "j" });
		fireEvent.keyDown(window, { key: "k" });
		fireEvent.keyDown(window, { key: "t" });
		expect(onNext).toHaveBeenCalledTimes(1);
		expect(onPrevious).toHaveBeenCalledTimes(1);
		expect(onThisWeek).toHaveBeenCalledTimes(1);
	});

	it("ignores the keys while typing, with a modifier, or under a dialog", () => {
		const { onNext } = renderNav();
		const input = document.createElement("input");
		document.body.appendChild(input);
		fireEvent.keyDown(input, { key: "j" });
		fireEvent.keyDown(window, { key: "j", ctrlKey: true });
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.appendChild(dialog);
		fireEvent.keyDown(window, { key: "j" });
		expect(onNext).not.toHaveBeenCalled();
		dialog.remove();
		input.remove();
		fireEvent.keyDown(window, { key: "j" });
		expect(onNext).toHaveBeenCalledTimes(1);
	});

	it("still moves while closed overlays stay mounted (the app's nav drawer)", () => {
		const { onNext } = renderNav();
		// MobileNavDrawer: always in the DOM, `inert` while closed.
		const drawer = document.createElement("div");
		drawer.setAttribute("role", "dialog");
		drawer.setAttribute("inert", "");
		const hiddenMenu = document.createElement("div");
		hiddenMenu.setAttribute("role", "menu");
		hiddenMenu.setAttribute("hidden", "");
		const wrapper = document.createElement("div");
		wrapper.setAttribute("aria-hidden", "true");
		const wrapped = document.createElement("div");
		wrapped.setAttribute("role", "dialog");
		wrapper.appendChild(wrapped);
		document.body.append(drawer, hiddenMenu, wrapper);
		fireEvent.keyDown(window, { key: "j" });
		expect(onNext).toHaveBeenCalledTimes(1);
		// Opening the drawer hands the keys to it.
		drawer.removeAttribute("inert");
		fireEvent.keyDown(window, { key: "j" });
		expect(onNext).toHaveBeenCalledTimes(1);
		drawer.remove();
		hiddenMenu.remove();
		wrapper.remove();
	});

	it("turns the keys off when asked", () => {
		const { onNext } = renderNav({ shortcuts: false });
		fireEvent.keyDown(window, { key: "j" });
		expect(onNext).not.toHaveBeenCalled();
	});
});
