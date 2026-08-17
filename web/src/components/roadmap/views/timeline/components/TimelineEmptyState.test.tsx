// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CalendarSearch } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineEmptyState } from "./TimelineEmptyState";

afterEach(cleanup);

describe("TimelineEmptyState", () => {
	it("renders the title on its own", () => {
		render(<TimelineEmptyState icon={CalendarSearch} title="Nothing here" />);
		expect(screen.getByText("Nothing here")).toBeTruthy();
	});

	it("renders an optional description and actions", () => {
		const onClick = vi.fn();
		render(
			<TimelineEmptyState
				icon={CalendarSearch}
				title="No work matches your filters"
				description="Try widening the filters."
			>
				<button type="button" onClick={onClick}>
					Clear filters
				</button>
			</TimelineEmptyState>,
		);

		expect(screen.getByText("Try widening the filters.")).toBeTruthy();
		fireEvent.click(screen.getByText("Clear filters"));
		expect(onClick).toHaveBeenCalled();
	});

	it("omits the description block when none is given", () => {
		const { container } = render(
			<TimelineEmptyState icon={CalendarSearch} title="Nothing here" />,
		);
		// Title only — no second paragraph.
		expect(container.querySelectorAll("p")).toHaveLength(1);
	});

	it("hides the icon from assistive tech, since the title carries the meaning", () => {
		const { container } = render(
			<TimelineEmptyState icon={CalendarSearch} title="Nothing here" />,
		);
		expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});
});
