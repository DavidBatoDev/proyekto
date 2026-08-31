// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";

// The view pulls dependencies over the network and toasts on save failures;
// neither is what these tests are about.
vi.mock("@/hooks/useFeatureDependencies", () => ({
	useFeatureDependenciesQuery: () => ({ data: [] }),
}));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import { MobileTimelineView } from "./MobileTimelineView";

afterEach(cleanup);

const roadmap = { id: "r1", name: "Launch" } as Roadmap;

const epics: RoadmapEpic[] = [
	{
		id: "e1",
		title: "Authentication",
		position: 0,
		start_date: "2026-03-02",
		end_date: "2026-03-27",
		features: [
			{
				id: "f1",
				epic_id: "e1",
				title: "Login flow",
				status: "in_progress",
				position: 0,
				start_date: "2026-03-02",
				end_date: "2026-03-13",
			},
			{
				id: "f2",
				epic_id: "e1",
				title: "OAuth",
				status: "not_started",
				position: 1,
				start_date: "2026-03-16",
				end_date: "2026-03-27",
			},
		],
	} as unknown as RoadmapEpic,
];

const noop = () => {};

/**
 * `DateField` is a custom calendar popover, not an `<input type="date">`, so a
 * date is set the way a user sets one: open the trigger, click the day.
 */
const pickDate = (fieldLabel: string, day: number) => {
	fireEvent.click(screen.getByLabelText(fieldLabel));
	const calendar = screen.getByRole("dialog", {
		name: `${fieldLabel} calendar`,
	});
	fireEvent.click(within(calendar).getByRole("button", { name: String(day) }));
};

const renderView = (overrides: Record<string, unknown> = {}) =>
	render(
		<MobileTimelineView
			roadmap={roadmap}
			milestones={[]}
			epics={epics}
			onAddMilestone={noop}
			onUpdateMilestone={noop}
			onDeleteMilestone={noop}
			onUpdateFeature={noop}
			canEditTimelineDates
			{...overrides}
		/>,
	);

describe("MobileTimelineView", () => {
	it("renders the chart rather than the old desktop-only placeholder", () => {
		renderView();

		expect(screen.queryByText(/best viewed on a larger screen/i)).toBeNull();
		expect(screen.getByText("Authentication")).toBeTruthy();
		expect(screen.getByText("Login flow")).toBeTruthy();
		// The mobile time-scale segmented control.
		for (const label of ["Day", "Week", "Month", "Year"]) {
			expect(screen.getByRole("button", { name: label })).toBeTruthy();
		}
	});

	it("leaves one-finger scrolling to the browser", () => {
		const { container } = renderView();
		const viewport = container.querySelector<HTMLElement>(
			".overscroll-contain",
		);

		// `none` here would mean we had taken the gesture and broken native
		// scrolling — the exact defect the mobile view exists to avoid.
		expect(viewport?.style.touchAction).toBe("pan-x pan-y");
	});

	it("opens the detail sheet on a single tap, not a double-click", () => {
		renderView();

		fireEvent.click(screen.getByText("Login flow"));

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Open feature/ })).toBeTruthy();
		expect(screen.getByLabelText("Start")).toBeTruthy();
		expect(screen.getByLabelText("End")).toBeTruthy();
	});

	it("saves a date edit through the existing update path", () => {
		const onUpdateFeature = vi.fn();
		renderView({ onUpdateFeature });

		fireEvent.click(screen.getByText("Login flow"));
		// Login flow runs Mar 2 - Mar 13; push the end out to Mar 20.
		pickDate("End", 20);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onUpdateFeature).toHaveBeenCalledTimes(1);
		expect(onUpdateFeature.mock.calls[0][0]).toMatchObject({
			id: "f1",
			start_date: "2026-03-02",
			end_date: "2026-03-20",
		});
	});

	it("refuses to save an inverted range", () => {
		const onUpdateFeature = vi.fn();
		renderView({ onUpdateFeature });

		fireEvent.click(screen.getByText("Login flow"));
		// Push the start past the Mar 13 end.
		pickDate("Start", 20);

		expect(
			screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
		).toBe(true);
		expect(onUpdateFeature).not.toHaveBeenCalled();
	});

	it("hides the date editors when the viewer cannot edit", () => {
		renderView({ canEditTimelineDates: false });

		fireEvent.click(screen.getByText("Login flow"));

		expect(screen.queryByLabelText("Start")).toBeNull();
		expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
		// Read-only viewers can still open the item.
		expect(screen.getByRole("button", { name: /Open feature/ })).toBeTruthy();
	});
});
