/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MilestoneEditorModal } from "./MilestoneEditorModal";

const defaultProps = {
	isOpen: true,
	mode: "edit" as const,
	isSaving: false,
	isDeleting: false,
	draftTitle: "Launch",
	draftDate: "2026-09-01",
	draftStatus: "not_started" as const,
	draftColor: "#6366f1",
	onDraftTitleChange: vi.fn(),
	onDraftDateChange: vi.fn(),
	onDraftStatusChange: vi.fn(),
	onDraftColorChange: vi.fn(),
	onCancel: vi.fn(),
	onSubmit: vi.fn(),
};

afterEach(cleanup);

describe("MilestoneEditorModal", () => {
	it("uses semantic theme colors", () => {
		render(<MilestoneEditorModal {...defaultProps} />);

		expect(
			screen.getByRole("heading", { name: "Edit Milestone" }).parentElement
				?.parentElement?.className,
		).toContain("bg-card");
		expect(
			screen.getByRole("button", { name: "Save Changes" }).className,
		).toContain("bg-primary");
	});

	it("requires confirmation before deleting an edited milestone", () => {
		const onDelete = vi.fn();
		render(<MilestoneEditorModal {...defaultProps} onDelete={onDelete} />);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onDelete).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
		expect(onDelete).toHaveBeenCalledOnce();
	});

	it("does not offer deletion when creating a milestone", () => {
		render(
			<MilestoneEditorModal
				{...defaultProps}
				mode="create"
				onDelete={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
	});
});
