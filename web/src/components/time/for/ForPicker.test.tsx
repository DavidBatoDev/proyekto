/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { LoggingForResult, LoggingOption } from "@/services/time.types";
import { ForPicker, ForPickerPanel } from "./ForPicker";

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
	over: Partial<LoggingOption> = {},
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "workspace", ref: "w" },
		rate_source: "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
		...over,
	};
}

const team = option("team", "t1", "Prodigitality Services Inc. Team", {
	approver_hint: "team",
	workspace_tag: "Prodigitality",
});
const agreement = option("assignment", "a1", "Acme Corp");

const result: LoggingForResult = {
	options: [team, agreement],
	selected: null,
	prefill: null,
	unavailable: [
		{
			kind: "assignment",
			id: "a2",
			label: "Pixel Studio",
			reason: "engagement_inactive",
		},
	],
};

afterEach(() => {
	cleanup();
});

describe("ForPicker", () => {
	it("lists agreements first, then the greyed unavailable option with its reason", () => {
		const { container } = render(
			<ForPicker result={result} value={null} onChange={vi.fn()} />,
		);
		const radios = screen.getAllByRole("radio");
		expect(radios).toHaveLength(3);
		const labels = Array.from(container.querySelectorAll("label")).map(
			(label) => label.textContent,
		);
		expect(labels[0]).toContain("Acme Corp");
		expect(labels[0]).toContain("Goes to: Acme Corp");
		expect(labels[1]).toContain("Prodigitality Services Inc. Team");
		expect(labels[1]).toContain(
			"Goes to: Prodigitality Services Inc. Team's owners and admins",
		);
		const off = container.querySelector(
			'[data-unavailable="engagement_inactive"]',
		);
		expect(off?.textContent).toContain(
			"Your agreement with Pixel Studio has ended.",
		);
		expect((radios[2] as HTMLInputElement).disabled).toBe(true);
		expect(screen.getByTestId("for-workspace-tag").textContent).toBe(
			"Prodigitality",
		);
	});

	it("reports a choice and the remember box", () => {
		const onChange = vi.fn();
		const onRemember = vi.fn();
		render(
			<ForPicker
				result={result}
				value={{ kind: "team", id: "t1" }}
				onChange={onChange}
				remember
				onRememberChange={onRemember}
			/>,
		);
		const [agreementRadio, teamRadio] = screen.getAllByRole("radio");
		expect((teamRadio as HTMLInputElement).checked).toBe(true);
		fireEvent.click(agreementRadio);
		expect(onChange).toHaveBeenCalledWith(agreement);
		const box = screen.getByRole("checkbox", {
			name: "Use for new time on this project",
		}) as HTMLInputElement;
		expect(box.checked).toBe(true);
		fireEvent.click(box);
		expect(onRemember).toHaveBeenCalledWith(false);
	});

	it("hides the remember box without a handler", () => {
		render(<ForPicker result={result} value={null} onChange={vi.fn()} />);
		expect(screen.queryByRole("checkbox")).toBeNull();
	});
});

describe("ForPickerPanel", () => {
	it("names the chosen option on the primary button (one tap confirms)", () => {
		const onConfirm = vi.fn();
		render(
			<ForPickerPanel
				mode="start"
				result={{ ...result, prefill: agreement }}
				value={{ kind: "assignment", id: "a1" }}
				onChange={vi.fn()}
				onConfirm={onConfirm}
				onCancel={vi.fn()}
			/>,
		);
		expect(screen.getByText("Choose who this time is for")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Start for Acme Corp" }),
		);
		expect(onConfirm).toHaveBeenCalled();
	});

	it("says Add for … in add mode and cuts long names", () => {
		render(
			<ForPickerPanel
				mode="add"
				result={result}
				value={{ kind: "team", id: "t1" }}
				onChange={vi.fn()}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Add for Prodigitality Services…" }),
		).toBeTruthy();
	});

	it("disables the primary button until something is chosen, and shows the error", () => {
		const onCancel = vi.fn();
		render(
			<ForPickerPanel
				mode="start"
				result={result}
				value={null}
				onChange={vi.fn()}
				onConfirm={vi.fn()}
				onCancel={onCancel}
				error="That choice isn't available any more. Pick again."
			/>,
		);
		const primary = screen.getByRole("button", {
			name: "Start timer",
		}) as HTMLButtonElement;
		expect(primary.disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toBe(
			"That choice isn't available any more. Pick again.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onCancel).toHaveBeenCalled();
	});

	it("locks every control while busy", () => {
		render(
			<ForPickerPanel
				mode="start"
				result={result}
				value={{ kind: "team", id: "t1" }}
				onChange={vi.fn()}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
				busy
			/>,
		);
		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});
});
