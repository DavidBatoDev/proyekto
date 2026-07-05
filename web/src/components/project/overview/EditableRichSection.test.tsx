/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableRichSection } from "./EditableRichSection";
import type { EditableRichSectionProps } from "./EditableRichSection";

vi.mock("@/components/common/RichTextEditor", () => ({
	RichTextEditor: ({
		value,
		onChange,
		placeholder,
	}: {
		value: string;
		onChange: (value: string) => void;
		placeholder: string;
	}) => (
		<textarea
			aria-label={placeholder}
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
		/>
	),
}));

afterEach(() => {
	cleanup();
});

function renderEditableRichSection(
	overrides: Partial<EditableRichSectionProps> = {},
) {
	const props: EditableRichSectionProps = {
		value: "<p>Current value</p>",
		placeholder: "Write a summary",
		emptyText: "No summary yet.",
		isSaving: false,
		isEditing: false,
		draft: "<p>Current value</p>",
		setDraft: vi.fn(),
		...overrides,
	};

	return {
		props,
		...render(<EditableRichSection {...props} />),
	};
}

describe("EditableRichSection", () => {
	it("does not sync draft when the incoming value is unchanged", () => {
		const setDraft = vi.fn();
		const { props, rerender } = renderEditableRichSection({ setDraft });

		expect(setDraft).not.toHaveBeenCalled();

		rerender(<EditableRichSection {...props} />);

		expect(setDraft).not.toHaveBeenCalled();
	});

	it("syncs draft from the incoming value once when not editing", () => {
		const setDraft = vi.fn();
		const { props, rerender } = renderEditableRichSection({
			value: "<p>Fresh value</p>",
			draft: "<p>Old draft</p>",
			setDraft,
		});

		expect(setDraft).toHaveBeenCalledTimes(1);
		expect(setDraft).toHaveBeenCalledWith("<p>Fresh value</p>");

		rerender(<EditableRichSection {...props} />);

		expect(setDraft).toHaveBeenCalledTimes(1);
	});

	it("does not overwrite draft while the user is editing", () => {
		const setDraft = vi.fn();

		renderEditableRichSection({
			value: "<p>Fresh value</p>",
			draft: "<p>User typing</p>",
			isEditing: true,
			setDraft,
		});

		expect(setDraft).not.toHaveBeenCalled();
	});
});
