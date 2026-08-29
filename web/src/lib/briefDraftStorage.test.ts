/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_BRIEF_DRAFT, isBriefDraftEmpty } from "@/lib/briefDraft";
import {
	clearBriefDraft,
	parseStoredBriefDraft,
	readBriefDraft,
	writeBriefDraft,
} from "@/lib/briefDraftStorage";

const KEY = "proyekto_brief_draft";

describe("briefDraftStorage", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
	});

	it("round-trips a draft", () => {
		writeBriefDraft({
			briefId: null,
			draft: {
				...EMPTY_BRIEF_DRAFT,
				title: "Event vendor marketplace",
				budget_min: "5000",
				duration: "1-3_months",
				sections: [{ key: "Scope of work", value: "Build it", position: 0 }],
				roadmap_id: "r-1",
				roadmap: { id: "r-1", name: "Launch plan" },
			},
			pendingFileIds: ["f-1", "f-2"],
		});

		const stored = readBriefDraft();
		expect(stored?.draft.title).toBe("Event vendor marketplace");
		expect(stored?.draft.budget_min).toBe("5000");
		expect(stored?.draft.sections).toHaveLength(1);
		expect(stored?.draft.roadmap).toEqual({ id: "r-1", name: "Launch plan" });
		expect(stored?.pendingFileIds).toEqual(["f-1", "f-2"]);
		expect(stored?.briefId).toBeNull();
	});

	it("returns null and self-heals when the stored value is unreadable", () => {
		window.sessionStorage.setItem(KEY, "{not json");
		expect(readBriefDraft()).toBeNull();
		expect(window.sessionStorage.getItem(KEY)).toBeNull();
	});

	it("drops a record whose shape it does not recognise", () => {
		window.sessionStorage.setItem(
			KEY,
			JSON.stringify({ draft: { title: 42 } }),
		);
		expect(readBriefDraft()).toBeNull();
		expect(window.sessionStorage.getItem(KEY)).toBeNull();
	});

	it("returns null when nothing is stored", () => {
		expect(readBriefDraft()).toBeNull();
	});

	it("clears", () => {
		writeBriefDraft({
			briefId: "b-1",
			draft: { ...EMPTY_BRIEF_DRAFT, title: "Draft" },
			pendingFileIds: [],
		});
		clearBriefDraft();
		expect(readBriefDraft()).toBeNull();
	});

	it("keeps the brief id that a half-finished save recorded", () => {
		writeBriefDraft({
			briefId: "b-9",
			draft: { ...EMPTY_BRIEF_DRAFT, title: "Half saved" },
			pendingFileIds: ["f-3"],
		});
		expect(readBriefDraft()?.briefId).toBe("b-9");
	});

	it("ignores malformed sections and roadmaps rather than failing the whole draft", () => {
		const parsed = parseStoredBriefDraft({
			briefId: null,
			draft: {
				title: "Partly broken",
				sections: [{ key: "ok", value: "yes", position: 0 }, { key: 1 }, null],
				roadmap: { id: "r-1" },
			},
			pendingFileIds: ["f-1", 7],
		});
		expect(parsed?.draft.sections).toHaveLength(1);
		expect(parsed?.draft.roadmap).toBeNull();
		expect(parsed?.pendingFileIds).toEqual(["f-1"]);
	});

	it("treats an untouched draft as empty so it is never resumed", () => {
		expect(isBriefDraftEmpty(EMPTY_BRIEF_DRAFT)).toBe(true);
		expect(
			isBriefDraftEmpty({ ...EMPTY_BRIEF_DRAFT, summary: "<p></p>" }),
		).toBe(true);
		expect(isBriefDraftEmpty({ ...EMPTY_BRIEF_DRAFT, title: "x" })).toBe(false);
	});
});
