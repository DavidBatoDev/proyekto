import { describe, expect, it } from "vitest";
import type { Decision, DecisionCategory } from "@/services/delivery.service";
import {
	isEditable,
	isOptimisticId,
	optimisticDecision,
	removeDecision,
	replaceDecision,
	upsertDecision,
	withCategory,
	withFinalized,
	withLinkRemoved,
	withOptionAdded,
	withOptionEdited,
	withOptionRemoved,
	withOptionSelected,
	withSuperseded,
} from "./decisionCache";

function decision(overrides: Partial<Decision> = {}): Decision {
	return {
		id: "dec-1",
		project_id: "p1",
		reference: 1,
		title: "Database choice",
		context: null,
		decision: "Use PostgreSQL.",
		rationale: null,
		alternatives_considered: null,
		category_id: null,
		decided_by: null,
		decided_on: "2026-08-10",
		status: "final",
		supersedes_decision_id: null,
		version: 1,
		visibility: "shared",
		created_at: "2026-08-10T00:00:00Z",
		updated_at: "2026-08-10T00:00:00Z",
		links: [],
		options: [],
		...overrides,
	};
}

function option(id: string, isSelected = false, position = 0) {
	return {
		id,
		decision_id: "dec-1",
		title: id,
		detail: null,
		is_selected: isSelected,
		position,
	};
}

const CATEGORY: DecisionCategory = {
	id: "cat-1",
	project_id: "p1",
	name: "Technical",
	color: "blue",
	icon: "cpu",
	position: 0,
	created_at: "2026-08-01T00:00:00Z",
	updated_at: "2026-08-01T00:00:00Z",
};

describe("list membership", () => {
	it("prepends a decision that is not in the list", () => {
		const list = upsertDecision([decision({ id: "a" })], decision({ id: "b" }));
		expect(list.map((d) => d.id)).toEqual(["b", "a"]);
	});

	it("replaces in place when the id already exists", () => {
		const list = upsertDecision(
			[decision({ id: "a", title: "Old" })],
			decision({ id: "a", title: "New" }),
		);
		expect(list).toHaveLength(1);
		expect(list[0].title).toBe("New");
	});

	it("swaps a temp row for the real one instead of duplicating it", () => {
		// The whole point of tracking previousId: without it the optimistic card
		// and the server's card both appear.
		const temp = decision({ id: "temp-decision-1", reference: null });
		const real = decision({ id: "dec-9", reference: 9 });
		const list = replaceDecision([temp], "temp-decision-1", real);
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe("dec-9");
	});

	it("falls back to inserting when the temp row already went away", () => {
		const list = replaceDecision([], "temp-decision-1", decision({ id: "x" }));
		expect(list.map((d) => d.id)).toEqual(["x"]);
	});

	it("removes by id", () => {
		const list = removeDecision(
			[decision({ id: "a" }), decision({ id: "b" })],
			"a",
		);
		expect(list.map((d) => d.id)).toEqual(["b"]);
	});
});

describe("isOptimisticId", () => {
	it("recognises the temp- convention and nothing else", () => {
		expect(isOptimisticId("temp-decision-123")).toBe(true);
		expect(isOptimisticId("dec-1")).toBe(false);
		expect(isOptimisticId("3f2a-temp-1")).toBe(false);
	});
});

describe("isEditable", () => {
	it("freezes a superseded decision, matching the server", () => {
		expect(isEditable(decision({ status: "superseded" }))).toBe(false);
		expect(isEditable(decision({ status: "final" }))).toBe(true);
		expect(isEditable(decision({ status: "proposed" }))).toBe(true);
	});
});

describe("withCategory", () => {
	it("sets both the id and the embedded row so the chip renders at once", () => {
		const result = withCategory(decision(), CATEGORY);
		expect(result.category_id).toBe("cat-1");
		expect(result.category?.name).toBe("Technical");
	});

	it("clears both when the category is removed", () => {
		const result = withCategory(
			decision({ category_id: "cat-1", category: CATEGORY }),
			null,
		);
		expect(result.category_id).toBeNull();
		expect(result.category).toBeNull();
	});
});

describe("withFinalized", () => {
	it("stamps the caller when the proposal had no decider", () => {
		const result = withFinalized(
			decision({ status: "proposed", decided_by: null }),
			"user-2",
			"2026-08-17",
		);
		expect(result.status).toBe("final");
		expect(result.decided_by).toBe("user-2");
	});

	it("does not rewrite an attribution that was already recorded", () => {
		// Overwriting would change what the History panel says happened.
		const result = withFinalized(
			decision({ status: "proposed", decided_by: "user-1" }),
			"user-2",
			"2026-08-17",
		);
		expect(result.decided_by).toBe("user-1");
	});

	it("is a no-op on a decision that is not proposed", () => {
		const already = decision({ status: "final", decided_by: "user-1" });
		expect(withFinalized(already, "user-2", "2026-08-17")).toBe(already);
		const history = decision({ status: "superseded" });
		expect(withFinalized(history, "user-2", "2026-08-17")).toBe(history);
	});
});

describe("withSuperseded", () => {
	it("retires the row", () => {
		expect(withSuperseded(decision()).status).toBe("superseded");
	});
});

describe("options", () => {
	it("appends an option at the end", () => {
		const result = withOptionAdded(
			decision({ options: [option("o1", false, 0)] }),
			{ title: "MongoDB" },
		);
		expect(result.options).toHaveLength(2);
		expect(result.options?.[1].title).toBe("MongoDB");
		expect(result.options?.[1].position).toBe(1);
	});

	it("displaces the previous choice when the new option arrives selected", () => {
		const result = withOptionAdded(
			decision({ options: [option("o1", true, 0)] }),
			{ title: "MongoDB", is_selected: true },
		);
		expect(result.options?.filter((o) => o.is_selected)).toHaveLength(1);
		expect(result.options?.find((o) => o.is_selected)?.title).toBe("MongoDB");
	});

	it("leaves exactly one option selected when selecting another", () => {
		// The partial unique index uq_decision_options_selected will not hold two,
		// so patching two would show a state the database can never reach.
		const result = withOptionSelected(
			decision({
				options: [option("o1", true, 0), option("o2", false, 1)],
			}),
			"o2",
		);
		expect(result.options?.map((o) => o.is_selected)).toEqual([false, true]);
	});

	it("selecting the already-selected option changes nothing", () => {
		const result = withOptionSelected(
			decision({ options: [option("o1", true, 0), option("o2", false, 1)] }),
			"o1",
		);
		expect(result.options?.map((o) => o.is_selected)).toEqual([true, false]);
	});

	it("removes an option by id", () => {
		const result = withOptionRemoved(
			decision({ options: [option("o1"), option("o2")] }),
			"o1",
		);
		expect(result.options?.map((o) => o.id)).toEqual(["o2"]);
	});

	it("edits an option in place without touching its siblings", () => {
		const result = withOptionEdited(
			decision({ options: [option("o1"), option("o2")] }),
			"o1",
			{ title: "PostgreSQL 16" },
		);
		expect(result.options?.[0].title).toBe("PostgreSQL 16");
		expect(result.options?.[1].title).toBe("o2");
	});

	it("survives a decision whose options were never loaded", () => {
		const bare = decision({ options: undefined });
		expect(withOptionRemoved(bare, "o1").options).toEqual([]);
		expect(withOptionSelected(bare, "o1").options).toEqual([]);
		expect(withOptionAdded(bare, { title: "Redis" }).options).toHaveLength(1);
	});
});

describe("withLinkRemoved", () => {
	it("drops the link", () => {
		const result = withLinkRemoved(
			decision({
				links: [{ id: "l1" }, { id: "l2" }] as Decision["links"],
			}),
			"l1",
		);
		expect(result.links?.map((l) => l.id)).toEqual(["l2"]);
	});

	it("survives a decision whose links were never loaded", () => {
		expect(withLinkRemoved(decision({ links: undefined }), "l1").links).toEqual(
			[],
		);
	});
});

describe("optimisticDecision", () => {
	it("builds a temp row the detail route will not try to open", () => {
		const result = optimisticDecision(
			"p1",
			{ title: "Queue", decision: "Use SQS." },
			{ userId: "user-1", today: "2026-08-17" },
		);
		expect(isOptimisticId(result.id)).toBe(true);
		// Only the server can allocate this; the card renders "DEC-—".
		expect(result.reference).toBeNull();
	});

	it("leaves a proposed row unattributed, matching the server", () => {
		const result = optimisticDecision(
			"p1",
			{ title: "Queue", decision: "Probably SQS.", status: "proposed" },
			{ userId: "user-1", today: "2026-08-17" },
		);
		expect(result.status).toBe("proposed");
		expect(result.decided_by).toBeNull();
	});

	it("attributes a final row to the caller", () => {
		const result = optimisticDecision(
			"p1",
			{ title: "Queue", decision: "Use SQS." },
			{ userId: "user-1", today: "2026-08-17" },
		);
		expect(result.status).toBe("final");
		expect(result.decided_by).toBe("user-1");
	});

	it("carries the category through so the chip renders immediately", () => {
		const result = optimisticDecision(
			"p1",
			{ title: "Queue", decision: "Use SQS.", category_id: "cat-1" },
			{ userId: "user-1", today: "2026-08-17", category: CATEGORY },
		);
		expect(result.category?.name).toBe("Technical");
	});

	it("seeds the options in the order given, preserving the choice", () => {
		const result = optimisticDecision(
			"p1",
			{
				title: "Database",
				decision: "Use PostgreSQL.",
				options: [
					{ title: "PostgreSQL", is_selected: true },
					{ title: "MongoDB" },
				],
			},
			{ userId: "user-1", today: "2026-08-17" },
		);
		expect(result.options?.map((o) => [o.title, o.is_selected])).toEqual([
			["PostgreSQL", true],
			["MongoDB", false],
		]);
	});

	it("starts with no links, because a trail needs titles only the server has", () => {
		const result = optimisticDecision(
			"p1",
			{ title: "Queue", decision: "Use SQS." },
			{ userId: "user-1", today: "2026-08-17" },
		);
		expect(result.links).toEqual([]);
	});

	it("mints a distinct id each time", () => {
		const body = { title: "Queue", decision: "Use SQS." };
		const options = { userId: "user-1", today: "2026-08-17" };
		expect(optimisticDecision("p1", body, options).id).not.toBe(
			optimisticDecision("p1", body, options).id,
		);
	});
});
