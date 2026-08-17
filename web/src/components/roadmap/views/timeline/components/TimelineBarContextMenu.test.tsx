// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "../model/rows";
import { TimelineBarContextMenu } from "./TimelineBarContextMenu";

afterEach(cleanup);

const featureRow = {
	kind: "feature",
	id: "f1",
	rowKey: "feature:f1",
	depth: 1,
	epic: { id: "e1", title: "Epic" },
	feature: { id: "f1", title: "Feature", epic_id: "e1" },
	hasChildren: false,
	isExpanded: false,
} as unknown as TimelineRow;

const renderMenu = (
	overrides: Partial<Parameters<typeof TimelineBarContextMenu>[0]> = {},
) => {
	const props = {
		state: { row: featureRow, x: 100, y: 100 },
		canEditDates: true,
		onEdit: vi.fn(),
		onClearDates: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
	render(<TimelineBarContextMenu {...props} />);
	return props;
};

describe("TimelineBarContextMenu", () => {
	it("offers edit and remove-from-timeline", () => {
		renderMenu();
		expect(screen.getByText("Edit feature")).toBeTruthy();
		expect(screen.getByText("Remove from timeline")).toBeTruthy();
	});

	it("edits the row it was opened on, then closes", () => {
		const props = renderMenu();
		fireEvent.click(screen.getByText("Edit feature"));
		expect(props.onEdit).toHaveBeenCalledWith(featureRow);
		expect(props.onClose).toHaveBeenCalled();
	});

	it("clears the dates on remove, then closes", () => {
		const props = renderMenu();
		fireEvent.click(screen.getByText("Remove from timeline"));
		expect(props.onClearDates).toHaveBeenCalledWith(featureRow);
		expect(props.onClose).toHaveBeenCalled();
	});

	it("hides the destructive entry for read-only viewers", () => {
		renderMenu({ canEditDates: false });
		expect(screen.queryByText("Remove from timeline")).toBeNull();
		expect(screen.getByText("Edit feature")).toBeTruthy();
	});

	it("closes on Escape", () => {
		const props = renderMenu();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(props.onClose).toHaveBeenCalled();
	});

	it("clamps to the viewport instead of overflowing the right edge", () => {
		renderMenu({ state: { row: featureRow, x: 99_999, y: 99_999 } });
		const menu = screen.getByRole("menu") as HTMLElement;
		expect(Number.parseInt(menu.style.left, 10)).toBeLessThan(
			window.innerWidth,
		);
		expect(Number.parseInt(menu.style.top, 10)).toBeLessThan(
			window.innerHeight,
		);
	});
});
