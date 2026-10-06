/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inheritedLine, OVERRIDE_ROW_COPY, OverrideRow } from "./OverrideRow";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function rowEl() {
	return screen.getByTestId("override-row");
}

function button(name: string) {
	return screen.queryByRole("button", { name }) as HTMLButtonElement | null;
}

describe("inheritedLine", () => {
	it("names the workspace and the inherited value (ux.md › Team Override)", () => {
		expect(
			inheritedLine("Prodigitality Workspace", "Weekly · Mon · Asia/Manila"),
		).toBe("Use Prodigitality Workspace's policy (Weekly · Mon · Asia/Manila)");
	});

	it("falls back to the short form without a workspace name", () => {
		expect(inheritedLine(null, "allowed")).toBe(
			"Use workspace policy (allowed)",
		);
		expect(inheritedLine("  ", "no limit")).toBe(
			"Use workspace policy (no limit)",
		);
	});

	it("drops the parentheses when the inherited value is unknown", () => {
		expect(inheritedLine("Acme", null)).toBe("Use Acme's policy");
	});
});

describe("OverrideRow", () => {
	it("an inherited row is muted, offers Override and hides the editor", () => {
		const onOverride = vi.fn();
		render(
			<OverrideRow
				id="team-rule-manual"
				label="Manual time"
				workspaceName="Acme"
				inheritedSummary="allowed"
				overridden={false}
				canEdit
				onOverride={onOverride}
			>
				<span>editor</span>
			</OverrideRow>,
		);
		expect(rowEl().getAttribute("data-state")).toBe("inherited");
		expect(screen.getByTestId("override-row-state").textContent).toBe(
			"Use Acme's policy (allowed)",
		);
		expect(screen.getByText("Manual time").className).toContain(
			"text-muted-foreground",
		);
		expect(screen.queryByText("editor")).toBeNull();
		fireEvent.click(button(OVERRIDE_ROW_COPY.override) as HTMLButtonElement);
		expect(onOverride).toHaveBeenCalledTimes(1);
	});

	it("a read-only inherited row has no Override button", () => {
		render(
			<OverrideRow
				id="r"
				label="Rounding"
				inheritedSummary="none"
				overridden={false}
				canEdit={false}
				onOverride={vi.fn()}
			/>,
		);
		expect(button(OVERRIDE_ROW_COPY.override)).toBeNull();
		expect(screen.getByTestId("override-row-state").textContent).toBe(
			"Use workspace policy (none)",
		);
	});

	it("editing shows the editor; a new override saves as is, Cancel backs out", () => {
		const onSave = vi.fn();
		const onCancel = vi.fn();
		render(
			<OverrideRow
				id="r"
				label="Manual time"
				inheritedSummary="allowed"
				overridden={false}
				editing
				canEdit
				onSave={onSave}
				onCancel={onCancel}
			>
				<span>editor</span>
			</OverrideRow>,
		);
		expect(rowEl().getAttribute("data-state")).toBe("editing");
		expect(screen.getByText("editor")).toBeTruthy();
		// Still reads as inherited until saved.
		expect(screen.getByTestId("override-row-state").textContent).toBe(
			"Use workspace policy (allowed)",
		);
		const save = button(OVERRIDE_ROW_COPY.save) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		fireEvent.click(save);
		fireEvent.click(button(OVERRIDE_ROW_COPY.cancel) as HTMLButtonElement);
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("an overridden row reads 'Override for this team' and resets to the workspace policy", () => {
		const onReset = vi.fn();
		render(
			<OverrideRow
				id="r"
				label="Timesheet period"
				workspaceName="Acme"
				inheritedSummary="Weekly · Mon · UTC"
				overridden
				canEdit
				onReset={onReset}
			>
				<span>editor</span>
			</OverrideRow>,
		);
		expect(rowEl().getAttribute("data-state")).toBe("overridden");
		expect(screen.getByTestId("override-row-state").textContent).toBe(
			"Override for this team",
		);
		expect(screen.getByText("editor")).toBeTruthy();
		// Nothing changed yet: no Save.
		expect(button(OVERRIDE_ROW_COPY.save)).toBeNull();
		fireEvent.click(
			button(OVERRIDE_ROW_COPY.useWorkspace) as HTMLButtonElement,
		);
		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it("a changed override offers Save and Cancel", () => {
		render(
			<OverrideRow id="r" label="Rounding" overridden canEdit dirty>
				<span>editor</span>
			</OverrideRow>,
		);
		expect(button(OVERRIDE_ROW_COPY.save)?.disabled).toBe(false);
		expect(button(OVERRIDE_ROW_COPY.cancel)).toBeTruthy();
	});

	it("a read-only override shows its value disabled, with no reset", () => {
		render(
			<OverrideRow id="r" label="Rounding" overridden canEdit={false}>
				<input aria-label="value" />
			</OverrideRow>,
		);
		expect(button(OVERRIDE_ROW_COPY.useWorkspace)).toBeNull();
		const group = screen.getByRole("group") as HTMLFieldSetElement;
		expect(group.disabled).toBe(true);
	});

	it("while saving, Save reads Saving… and the controls are locked", () => {
		render(
			<OverrideRow id="r" label="Rounding" overridden canEdit dirty pending>
				<input aria-label="value" />
			</OverrideRow>,
		);
		const saving = button(OVERRIDE_ROW_COPY.saving) as HTMLButtonElement;
		expect(saving.disabled).toBe(true);
		expect((screen.getByRole("group") as HTMLFieldSetElement).disabled).toBe(
			true,
		);
	});

	it("labels the editor group with the row label and shows the hint", () => {
		render(
			<OverrideRow
				id="team-rule-period"
				label="Timesheet period"
				overridden
				canEdit
				hint="Applies from Mon Oct 12. Open timesheets keep their dates."
			>
				<span>editor</span>
			</OverrideRow>,
		);
		expect(
			screen.getByRole("group", { name: "Timesheet period" }),
		).toBeTruthy();
		expect(screen.getByTestId("override-row-hint").textContent).toBe(
			"Applies from Mon Oct 12. Open timesheets keep their dates.",
		);
	});
});
