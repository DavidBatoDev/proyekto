/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ActionMenuItem, RowActionsMenu } from "./RowActionsMenu";

const PALETTE =
	/\b(?:bg|text|border|hover:bg)-(?:slate|gray|white|emerald|indigo|amber|rose|red|green|blue)\b/;

function Harness({
	items,
	ariaLabel,
}: {
	items: ActionMenuItem[];
	ariaLabel?: string;
}) {
	const [open, setOpen] = useState<string | null>(null);
	return (
		<RowActionsMenu
			rowId="e1"
			openMenuRowId={open}
			onSetOpenMenuRowId={setOpen}
			items={items}
			ariaLabel={ariaLabel}
		/>
	);
}

const items = (onSelect = vi.fn()): ActionMenuItem[] => [
	{ id: "edit", label: "Edit", icon: null, onSelect },
	{ id: "approve", label: "Approve", icon: null, onSelect, tone: "success" },
	{ id: "flag", label: "Flag", icon: null, onSelect, tone: "warning" },
	{ id: "view", label: "View", icon: null, onSelect, tone: "info" },
	{ id: "delete", label: "Delete", icon: null, onSelect, tone: "danger" },
];

afterEach(() => {
	cleanup();
});

describe("RowActionsMenu", () => {
	it("names the trigger 'Entry actions', never 'log' as a noun", () => {
		render(<Harness items={items()} />);
		const trigger = screen.getByRole("button", { name: "Entry actions" });
		expect(trigger.getAttribute("title")).toBe("Entry actions");
		expect(screen.queryByRole("button", { name: /log/i })).toBeNull();
	});

	it("takes another accessible name when a host passes one", () => {
		render(<Harness items={items()} ariaLabel="Payout actions" />);
		expect(screen.getByRole("button", { name: "Payout actions" })).toBeTruthy();
	});

	it("uses theme tokens on the trigger, the panel and every tone", () => {
		const onSelect = vi.fn();
		render(<Harness items={items(onSelect)} />);
		const trigger = screen.getByRole("button", { name: "Entry actions" });
		expect(trigger.className).toContain("bg-card");
		expect(trigger.className).toContain("border-border");
		expect(trigger.className).not.toMatch(PALETTE);

		fireEvent.click(trigger);
		const panel = document.querySelector('div[class*="min-w-[200px]"]');
		expect(panel?.className).toContain("bg-popover");
		expect(panel?.className).toContain("text-popover-foreground");
		expect(panel?.className).not.toMatch(PALETTE);

		const tone = (name: string) =>
			screen.getByRole("button", { name }).className;
		expect(tone("Edit")).toContain("text-foreground");
		expect(tone("Approve")).toContain("text-success-foreground");
		expect(tone("Flag")).toContain("text-warning-foreground");
		expect(tone("View")).toContain("text-info-foreground");
		expect(tone("Delete")).toContain("text-destructive");
		for (const name of ["Edit", "Approve", "Flag", "View", "Delete"]) {
			expect(tone(name)).not.toMatch(PALETTE);
		}

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(document.querySelector('div[class*="min-w-[200px]"]')).toBeNull();
	});

	it("closes on Escape", () => {
		render(<Harness items={items()} />);
		fireEvent.click(screen.getByRole("button", { name: "Entry actions" }));
		expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
	});
});
