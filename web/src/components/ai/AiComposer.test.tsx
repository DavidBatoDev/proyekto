/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import type { Project } from "@/services/project.service";
import {
	AI_COMPOSER_AUTO_CHIP_TITLE,
	AI_COMPOSER_NO_CONTEXT_MATCHES_LABEL,
	AiComposer,
} from "./AiComposer";
import { AI_MENTION_LOADING_LABEL } from "./AiMentionPicker";
import {
	type AiContextChip,
	type AiMentionCandidate,
	type AiMentionPick,
	buildAiMentionCandidates,
} from "./aiMentions";

afterEach(() => {
	cleanup();
});

const PLACEHOLDER = "Chat or request roadmap edits...";

function roadmap(id: string, name: string): RoadmapPreview {
	return {
		id,
		name,
		project_id: null,
		project: null,
		owner_id: "u1",
		status: "active",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		epics: [],
		milestones: [],
	} as unknown as RoadmapPreview;
}

function project(id: string, title: string): Project {
	return {
		id,
		title,
		status: "active",
		owner_id: "u1",
		workspace_id: null,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
	} as unknown as Project;
}

// "onb" -> [roadmap Client onboarding, roadmap Onboarding, project Onboarding revamp]
const ROADMAPS = [
	roadmap("r-client", "Client onboarding"),
	roadmap("r-onb", "Onboarding"),
];
const PROJECTS = [project("p-revamp", "Onboarding revamp")];

/**
 * Minimal host: owns value/picks like the panel does and derives candidates
 * from the query the composer reports (the `useAiMentionCandidates` role).
 */
function Harness({
	onSend = () => {},
	onChange,
	onPickerActiveChange,
	disabled,
	initialValue = "",
	candidatesLoading = false,
	withCandidates = true,
	contextRefs,
	onAddRef,
	onRemoveRef,
}: {
	onSend?: () => void;
	onChange?: (value: string, picks: AiMentionPick[]) => void;
	onPickerActiveChange?: (active: boolean, query: string) => void;
	disabled?: boolean;
	initialValue?: string;
	candidatesLoading?: boolean;
	withCandidates?: boolean;
	contextRefs?: AiContextChip[];
	onAddRef?: (candidate: AiMentionCandidate) => void;
	onRemoveRef?: (key: string) => void;
}) {
	const [value, setValue] = useState(initialValue);
	const [picks, setPicks] = useState<AiMentionPick[]>([]);
	const [picker, setPicker] = useState({ active: false, query: "" });
	const candidates = useMemo(
		() =>
			picker.active && withCandidates
				? buildAiMentionCandidates({
						query: picker.query,
						roadmaps: ROADMAPS,
						projects: PROJECTS,
						currentWorkspaceId: null,
						myWorkspaceIds: [],
					})
				: [],
		[picker, withCandidates],
	);
	return (
		<AiComposer
			value={value}
			picks={picks}
			onChange={(nextValue, nextPicks) => {
				onChange?.(nextValue, nextPicks);
				setValue(nextValue);
				setPicks(nextPicks);
			}}
			onSend={onSend}
			disabled={disabled}
			placeholder={PLACEHOLDER}
			candidates={candidates}
			candidatesLoading={candidatesLoading}
			onPickerActiveChange={(active, query) => {
				onPickerActiveChange?.(active, query);
				setPicker({ active, query });
			}}
			contextRefs={contextRefs}
			onAddRef={onAddRef}
			onRemoveRef={onRemoveRef}
		/>
	);
}

const getTextarea = () =>
	screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;

function type(text: string) {
	const textarea = getTextarea();
	fireEvent.change(textarea, { target: { value: text } });
	return textarea;
}

describe("AiComposer", () => {
	it("opens the listbox with a Roadmaps group when @onb is typed", () => {
		const onPickerActiveChange = vi.fn();
		render(<Harness onPickerActiveChange={onPickerActiveChange} />);
		const textarea = type("@onb");

		expect(onPickerActiveChange).toHaveBeenLastCalledWith(true, "onb");
		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(screen.getByText("Roadmaps")).toBeTruthy();
		expect(screen.getByText("Projects")).toBeTruthy();
		expect(screen.getByRole("option", { name: "Onboarding" })).toBeTruthy();
		expect(screen.getAllByRole("option")).toHaveLength(3);
		expect(textarea.getAttribute("aria-controls")).toBe(
			screen.getByRole("listbox").id,
		);
		// The first row starts selected.
		expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe(
			"true",
		);
	});

	it("ArrowDown + Enter inserts the mention and records the pick", async () => {
		const onChange = vi.fn();
		const onSend = vi.fn();
		render(<Harness onChange={onChange} onSend={onSend} />);
		const textarea = type("@onb");

		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(onChange).toHaveBeenLastCalledWith("@Onboarding ", [
			{
				kind: "roadmap",
				id: "r-onb",
				label: "Onboarding",
				roadmapId: "r-onb",
				projectId: null,
			},
		]);
		expect(textarea.value).toBe("@Onboarding ");
		expect(onSend).not.toHaveBeenCalled();
		expect(screen.queryByRole("listbox")).toBeNull();

		// The caret lands after the inserted mention once the frame runs.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(textarea.selectionStart).toBe("@Onboarding ".length);
	});

	it("commits the aria-selected row after two ArrowDowns (one-array invariant)", () => {
		const onChange = vi.fn();
		render(<Harness onChange={onChange} />);
		const textarea = type("@onb");

		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		const options = screen.getAllByRole("option");
		const selected = options.find(
			(option) => option.getAttribute("aria-selected") === "true",
		);
		expect(selected).toBe(options[2]);
		expect(textarea.getAttribute("aria-activedescendant")).toBe(selected?.id);
		expect(selected?.textContent).toContain("Onboarding revamp");

		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(onChange).toHaveBeenLastCalledWith("@Onboarding revamp ", [
			expect.objectContaining({ kind: "project", id: "p-revamp" }),
		]);
	});

	it("wraps ArrowUp from the first row to the last and Tab selects", () => {
		const onChange = vi.fn();
		render(<Harness onChange={onChange} />);
		const textarea = type("@onb");

		fireEvent.keyDown(textarea, { key: "ArrowUp" });
		const options = screen.getAllByRole("option");
		expect(options[2].getAttribute("aria-selected")).toBe("true");

		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).toHaveBeenLastCalledWith(
			"@Onboarding revamp ",
			expect.any(Array),
		);
	});

	it("splices the mention into the middle of the text", () => {
		const onChange = vi.fn();
		render(<Harness onChange={onChange} />);
		const textarea = type("Ship @onb");
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(onChange).toHaveBeenLastCalledWith("Ship @Client onboarding ", [
			expect.objectContaining({ kind: "roadmap", id: "r-client" }),
		]);
	});

	it("selects on mouse down without blurring the field", () => {
		const onChange = vi.fn();
		render(<Harness onChange={onChange} />);
		type("@onb");
		const option = screen.getByRole("option", { name: "Onboarding" });
		const event = fireEvent.mouseDown(option);
		expect(event).toBe(false); // preventDefault keeps the textarea focused
		expect(onChange).toHaveBeenLastCalledWith("@Onboarding ", [
			expect.objectContaining({ id: "r-onb" }),
		]);
	});

	it("Escape closes the picker and reports it inactive", () => {
		const onPickerActiveChange = vi.fn();
		const onSend = vi.fn();
		render(
			<Harness onPickerActiveChange={onPickerActiveChange} onSend={onSend} />,
		);
		const textarea = type("@onb");
		expect(screen.getByRole("listbox")).toBeTruthy();

		fireEvent.keyDown(textarea, { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onPickerActiveChange).toHaveBeenLastCalledWith(false, "");
		expect(onSend).not.toHaveBeenCalled();
		expect(textarea.value).toBe("@onb");
	});

	it("closes the picker once the query grows whitespace or has no matches", () => {
		render(<Harness />);
		type("@onb");
		expect(screen.getByRole("listbox")).toBeTruthy();
		type("@onb ");
		expect(screen.queryByRole("listbox")).toBeNull();
		type("@zzz");
		expect(screen.queryByRole("listbox")).toBeNull();
	});

	it("shows the loading footer while candidates are still fetching", () => {
		render(<Harness candidatesLoading withCandidates={false} />);
		type("@onb");
		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(screen.getByText(AI_MENTION_LOADING_LABEL)).toBeTruthy();
		expect(screen.queryAllByRole("option")).toHaveLength(0);
	});

	it("Enter with the picker closed sends", () => {
		const onSend = vi.fn();
		render(<Harness onSend={onSend} />);
		const textarea = type("hello");
		expect(screen.queryByRole("listbox")).toBeNull();
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(onSend).toHaveBeenCalledTimes(1);
	});

	it("Enter with only whitespace does not send", () => {
		const onSend = vi.fn();
		render(<Harness onSend={onSend} />);
		const textarea = type("   ");
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(onSend).not.toHaveBeenCalled();
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("Shift+Enter inserts a newline instead of sending", () => {
		const onSend = vi.fn();
		render(<Harness onSend={onSend} />);
		const textarea = type("hello");
		const notPrevented = fireEvent.keyDown(textarea, {
			key: "Enter",
			shiftKey: true,
		});
		// Default not prevented: the browser inserts the newline.
		expect(notPrevented).toBe(true);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("the send button sends and is disabled while the composer is disabled", () => {
		const onSend = vi.fn();
		const { unmount } = render(<Harness onSend={onSend} />);
		type("hello");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		expect(onSend).toHaveBeenCalledTimes(1);
		unmount();

		const onSendDisabled = vi.fn();
		render(<Harness onSend={onSendDisabled} disabled initialValue="hello" />);
		const textarea = getTextarea();
		expect(textarea.disabled).toBe(true);
		const button = screen.getByRole("button", {
			name: "Send message",
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.click(button);
		expect(onSendDisabled).not.toHaveBeenCalled();
	});

	it("paints picked mentions as pills in the mirror backdrop", () => {
		const { container } = render(<Harness />);
		const textarea = type("@onb");
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		const pill = container.querySelector("span.bg-primary\\/15");
		expect(pill?.textContent).toBe("@Onboarding");
	});

	it("reports inactive on unmount", () => {
		const onPickerActiveChange = vi.fn();
		const { unmount } = render(
			<Harness onPickerActiveChange={onPickerActiveChange} />,
		);
		type("@onb");
		unmount();
		expect(onPickerActiveChange).toHaveBeenLastCalledWith(false, "");
	});
});

// -----------------------------------------------------------------------------
// Context row: chips + the add-context popover
// -----------------------------------------------------------------------------

const CHIPS: AiContextChip[] = [
	{
		key: "roadmap:r-onb",
		kind: "roadmap",
		id: "r-onb",
		label: "Onboarding",
		source: "auto",
	},
	{
		key: "epic:e1",
		kind: "epic",
		id: "e1",
		label: "Signup flow",
		source: "picked",
	},
];

const getSearch = () =>
	screen.getByLabelText("Search context") as HTMLInputElement;
const addContextButton = () =>
	screen.getByRole("button", { name: "Add context" }) as HTMLButtonElement;

describe("AiComposer context row", () => {
	it("renders one chip per ref with a remove button, marking auto chips", () => {
		const onRemoveRef = vi.fn();
		render(
			<Harness
				contextRefs={CHIPS}
				onAddRef={() => {}}
				onRemoveRef={onRemoveRef}
			/>,
		);
		const row = screen.getByTestId("ai-context-row");
		expect(row.textContent).toContain("Onboarding");
		expect(row.textContent).toContain("Signup flow");
		const autoChip = row.querySelector("[data-context-source='auto']");
		expect(autoChip?.getAttribute("title")).toBe(AI_COMPOSER_AUTO_CHIP_TITLE);
		expect(autoChip?.getAttribute("data-mention-kind")).toBe("roadmap");
		expect(autoChip?.querySelector("svg")).toBeTruthy();
		expect(
			row
				.querySelector("[data-context-source='picked']")
				?.getAttribute("title"),
		).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Remove Signup flow from context" }),
		);
		expect(onRemoveRef).toHaveBeenCalledWith("epic:e1");
		fireEvent.click(
			screen.getByRole("button", { name: "Remove Onboarding from context" }),
		);
		expect(onRemoveRef).toHaveBeenLastCalledWith("roadmap:r-onb");
		expect(row.innerHTML).not.toMatch(/slate|gray|violet/);
	});

	it("renders no row without chips or an add handler; the frozen strings stay intact", () => {
		render(<Harness />);
		expect(screen.queryByTestId("ai-context-row")).toBeNull();
		expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
		expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
		expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
	});

	it("keeps the row a sibling above the field so the mirror backdrop stays aligned", () => {
		const { container } = render(
			<Harness contextRefs={CHIPS} onAddRef={() => {}} />,
		);
		const row = screen.getByTestId("ai-context-row");
		const textarea = getTextarea();
		const fieldBox = textarea.parentElement as HTMLElement;
		expect(fieldBox.contains(row)).toBe(false);
		const following =
			row.compareDocumentPosition(fieldBox) & Node.DOCUMENT_POSITION_FOLLOWING;
		expect(following).toBeTruthy();
		// The backdrop is still the field box's own child.
		expect(fieldBox.querySelector("div.absolute.inset-0")).toBeTruthy();
		expect(container.querySelector("textarea")).toBe(textarea);
	});

	it("Add context opens a search-driven popover over the same picker and selects without touching the text", () => {
		const onAddRef = vi.fn();
		const onChange = vi.fn();
		const onPickerActiveChange = vi.fn();
		render(
			<Harness
				onAddRef={onAddRef}
				onChange={onChange}
				onPickerActiveChange={onPickerActiveChange}
				initialValue="hello"
			/>,
		);
		const button = addContextButton();
		expect(button.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(button);
		expect(button.getAttribute("aria-expanded")).toBe("true");
		const search = getSearch();
		expect(document.activeElement).toBe(search);
		expect(onPickerActiveChange).toHaveBeenLastCalledWith(true, "");
		// A bare query shows the preview rows.
		expect(screen.getAllByRole("option")).toHaveLength(3);
		expect(screen.getByRole("listbox").id).toBe(
			search.getAttribute("aria-controls"),
		);

		fireEvent.change(search, { target: { value: "revamp" } });
		expect(onPickerActiveChange).toHaveBeenLastCalledWith(true, "revamp");
		const options = screen.getAllByRole("option");
		expect(options).toHaveLength(1);
		expect(search.getAttribute("aria-activedescendant")).toBe(options[0].id);

		fireEvent.keyDown(search, { key: "Enter" });
		expect(onAddRef).toHaveBeenCalledTimes(1);
		expect(onAddRef.mock.calls[0][0]).toMatchObject({
			kind: "project",
			id: "p-revamp",
			label: "Onboarding revamp",
		});
		expect(onChange).not.toHaveBeenCalled();
		expect(getTextarea().value).toBe("hello");
		expect(screen.queryByLabelText("Search context")).toBeNull();
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onPickerActiveChange).toHaveBeenLastCalledWith(false, "");
		expect(document.activeElement).toBe(getTextarea());
	});

	it("ArrowDown/ArrowUp move the highlighted row and mouse selection adds", () => {
		const onAddRef = vi.fn();
		render(<Harness onAddRef={onAddRef} />);
		fireEvent.click(addContextButton());
		const search = getSearch();
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		let options = screen.getAllByRole("option");
		expect(options[2].getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(search, { key: "ArrowUp" });
		options = screen.getAllByRole("option");
		expect(options[1].getAttribute("aria-selected")).toBe("true");
		expect(search.getAttribute("aria-activedescendant")).toBe(options[1].id);
		fireEvent.keyDown(search, { key: "Enter" });
		expect(onAddRef.mock.calls[0][0]).toMatchObject({ id: "r-onb" });

		fireEvent.click(addContextButton());
		const event = fireEvent.mouseDown(
			screen.getByRole("option", { name: "Client onboarding" }),
		);
		// preventDefault keeps the search focused.
		expect(event).toBe(false);
		expect(onAddRef.mock.calls[1][0]).toMatchObject({ id: "r-client" });
		expect(screen.queryByLabelText("Search context")).toBeNull();
	});

	it("Escape closes the popover without adding; the button toggles it closed too", () => {
		const onAddRef = vi.fn();
		const onPickerActiveChange = vi.fn();
		render(
			<Harness
				onAddRef={onAddRef}
				onPickerActiveChange={onPickerActiveChange}
			/>,
		);
		const button = addContextButton();
		fireEvent.click(button);
		fireEvent.keyDown(getSearch(), { key: "Escape" });
		expect(screen.queryByLabelText("Search context")).toBeNull();
		expect(onAddRef).not.toHaveBeenCalled();
		expect(onPickerActiveChange).toHaveBeenLastCalledWith(false, "");
		expect(document.activeElement).toBe(getTextarea());

		fireEvent.click(button);
		expect(getSearch()).toBeTruthy();
		// Mousedown on the button keeps the search focused so its blur cannot
		// close the popover before the click toggles it.
		expect(fireEvent.mouseDown(button)).toBe(false);
		fireEvent.click(button);
		expect(screen.queryByLabelText("Search context")).toBeNull();
		expect(button.getAttribute("aria-expanded")).toBe("false");
	});

	it("closes on blur (click outside) and shows a no-matches footer", () => {
		render(<Harness onAddRef={() => {}} />);
		fireEvent.click(addContextButton());
		const search = getSearch();
		fireEvent.change(search, { target: { value: "zzz" } });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(screen.getByText(AI_COMPOSER_NO_CONTEXT_MATCHES_LABEL)).toBeTruthy();
		expect(search.getAttribute("aria-controls")).toBeNull();
		// Nothing to pick: Enter is a no-op and the popover stays open.
		fireEvent.keyDown(search, { key: "Enter" });
		expect(getSearch()).toBe(search);
		fireEvent.blur(search);
		expect(screen.queryByLabelText("Search context")).toBeNull();
	});

	it("shows the loading footer in the popover while candidates fetch", () => {
		render(
			<Harness onAddRef={() => {}} candidatesLoading withCandidates={false} />,
		);
		fireEvent.click(addContextButton());
		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(screen.getByText(AI_MENTION_LOADING_LABEL)).toBeTruthy();
		expect(screen.queryByText(AI_COMPOSER_NO_CONTEXT_MATCHES_LABEL)).toBeNull();
	});

	it("keeps one picker open at a time: Add context closes the caret picker and @ still works after", () => {
		render(<Harness onAddRef={() => {}} />);
		const textarea = type("@onb");
		expect(screen.getAllByRole("listbox")).toHaveLength(1);
		expect(textarea.getAttribute("aria-controls")).toBeTruthy();

		fireEvent.click(addContextButton());
		expect(screen.getAllByRole("listbox")).toHaveLength(1);
		expect(getSearch()).toBeTruthy();
		expect(textarea.getAttribute("aria-controls")).toBeNull();

		fireEvent.keyDown(getSearch(), { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		type("@onbo");
		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(screen.queryByLabelText("Search context")).toBeNull();
		expect(textarea.getAttribute("aria-controls")).toBe(
			screen.getByRole("listbox").id,
		);
	});

	it("disables the add and remove buttons while the composer is disabled", () => {
		render(
			<Harness
				disabled
				contextRefs={CHIPS}
				onAddRef={() => {}}
				onRemoveRef={() => {}}
			/>,
		);
		expect(addContextButton().disabled).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "Remove Onboarding from context",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
});
