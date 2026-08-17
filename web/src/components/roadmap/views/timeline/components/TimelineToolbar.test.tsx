// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_TIMELINE_FILTERS } from "./TimelineFilterMenu";
import { TimelineToolbar } from "./TimelineToolbar";

const noop = () => {};

afterEach(cleanup);

const renderToolbar = (canEditDates = true) =>
	render(
		<TimelineToolbar
			periodLabel="October 2022"
			query=""
			granularity="week"
			isDrawMode={false}
			canEditDates={canEditDates}
			matchCount={null}
			conflictCount={0}
			hiddenDependencyCount={0}
			filters={EMPTY_TIMELINE_FILTERS}
			assignees={[]}
			onFiltersChange={noop}
			onQueryChange={noop}
			onGranularityChange={noop}
			onToggleDrawMode={noop}
			onStepPeriod={noop}
			onToday={noop}
			onAddMilestone={noop}
		/>,
	);

describe("TimelineToolbar", () => {
	it("renders the full action cluster from the mock", () => {
		renderToolbar();

		expect(screen.getByPlaceholderText("Search")).toBeTruthy();
		expect(screen.getByText("October 2022")).toBeTruthy();
		expect(screen.getByLabelText("Previous period")).toBeTruthy();
		expect(screen.getByLabelText("Next period")).toBeTruthy();
		expect(screen.getByText("Today")).toBeTruthy();
		expect(screen.getByText("Draw timeline")).toBeTruthy();
		expect(screen.getByText("Filter")).toBeTruthy();
		expect(screen.getByText("Milestone")).toBeTruthy();
	});

	it("hides the editing actions for read-only viewers but keeps Filter", () => {
		renderToolbar(false);

		expect(screen.queryByText("Draw timeline")).toBeNull();
		expect(screen.queryByText("Milestone")).toBeNull();
		expect(screen.getByText("Filter")).toBeTruthy();
		expect(screen.getByText("Today")).toBeTruthy();
	});

	it("shows a conflict count only when there are conflicts", () => {
		renderToolbar();
		expect(screen.queryByTitle(/scheduled to start before/i)).toBeNull();
		cleanup();

		render(
			<TimelineToolbar
				periodLabel="October 2022"
				query=""
				granularity="week"
				isDrawMode={false}
				canEditDates
				matchCount={null}
				conflictCount={3}
				hiddenDependencyCount={2}
				filters={EMPTY_TIMELINE_FILTERS}
				assignees={[]}
				onFiltersChange={noop}
				onQueryChange={noop}
				onGranularityChange={noop}
				onToggleDrawMode={noop}
				onStepPeriod={noop}
				onToday={noop}
				onAddMilestone={noop}
			/>,
		);
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getByText("2 hidden")).toBeTruthy();
	});

	it("opens the filter menu with status, date and assignee groups", () => {
		render(
			<TimelineToolbar
				periodLabel="October 2022"
				query=""
				granularity="week"
				isDrawMode={false}
				canEditDates
				matchCount={null}
				conflictCount={0}
				hiddenDependencyCount={0}
				filters={EMPTY_TIMELINE_FILTERS}
				assignees={[{ id: "u1", display_name: "Ada" }]}
				onFiltersChange={noop}
				onQueryChange={noop}
				onGranularityChange={noop}
				onToggleDrawMode={noop}
				onStepPeriod={noop}
				onToday={noop}
				onAddMilestone={noop}
			/>,
		);

		fireEvent.click(screen.getByText("Filter"));

		expect(screen.getByText("Status")).toBeTruthy();
		expect(screen.getByText("Dates")).toBeTruthy();
		expect(screen.getByText("In progress")).toBeTruthy();
		expect(screen.getByText("Ada")).toBeTruthy();
	});
});
