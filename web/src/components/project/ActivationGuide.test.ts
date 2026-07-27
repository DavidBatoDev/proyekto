import { describe, expect, it } from "vitest";
import type { ActivationChecklistItem } from "@/services/contract.service";
import { checklistProgress, sortChecklistItems } from "./ActivationGuide";

function item(
	key: string,
	ok: boolean,
	severity: "blocker" | "warning" = "blocker",
): ActivationChecklistItem {
	return { key, label: key, ok, severity, detail: null, fixPath: null };
}

describe("sortChecklistItems", () => {
	it("orders incomplete blockers, then incomplete warnings, then done items", () => {
		const items = [
			item("done-blocker", true, "blocker"),
			item("open-warning", false, "warning"),
			item("done-warning", true, "warning"),
			item("open-blocker", false, "blocker"),
		];
		expect(sortChecklistItems(items).map((i) => i.key)).toEqual([
			"open-blocker",
			"open-warning",
			"done-blocker",
			"done-warning",
		]);
	});

	it("keeps the backend order within a group (stable)", () => {
		const items = [
			item("a", false, "blocker"),
			item("b", false, "blocker"),
			item("c", false, "blocker"),
		];
		expect(sortChecklistItems(items).map((i) => i.key)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("does not mutate the input", () => {
		const items = [item("x", true), item("y", false)];
		const snapshot = items.map((i) => i.key);
		sortChecklistItems(items);
		expect(items.map((i) => i.key)).toEqual(snapshot);
	});
});

describe("checklistProgress", () => {
	it("counts completed items out of total", () => {
		const checklist = {
			project_id: "p",
			ready: false,
			items: [item("a", true), item("b", false), item("c", true)],
		};
		expect(checklistProgress(checklist)).toEqual({ done: 2, total: 3 });
	});
});
