import { describe, expect, it } from "vitest";
import {
	CATEGORY_NAME_MAX,
	DECISION_TITLE_MAX,
	type DecisionFormValues,
	EMPTY_DECISION_FORM,
	hasDecisionErrors,
	OPTION_TITLE_MAX,
	toCreateDecisionPayload,
	validateCategoryName,
	validateDecisionForm,
	validateOptionTitle,
} from "./decisionForm";

function form(overrides: Partial<DecisionFormValues> = {}): DecisionFormValues {
	return {
		...EMPTY_DECISION_FORM,
		title: "Database choice",
		decision: "Use PostgreSQL rather than MongoDB.",
		...overrides,
	};
}

describe("validateDecisionForm", () => {
	it("accepts the minimum viable decision", () => {
		expect(hasDecisionErrors(validateDecisionForm(form()))).toBe(false);
	});

	it("requires a title and a decision", () => {
		const errors = validateDecisionForm(form({ title: "  ", decision: "" }));
		expect(errors.title).toBeTruthy();
		expect(errors.decision).toBeTruthy();
	});

	it("enforces the DTO's length caps", () => {
		const errors = validateDecisionForm(
			form({ title: "x".repeat(DECISION_TITLE_MAX + 1) }),
		);
		expect(errors.title).toContain(`${DECISION_TITLE_MAX}`);
	});

	it("drops an entirely blank option row instead of rejecting it", () => {
		// Someone added a row and changed their mind; making them delete it before
		// they can save is friction with no purpose.
		const errors = validateDecisionForm(
			form({ options: [{ title: "", detail: "" }] }),
		);
		expect(hasDecisionErrors(errors)).toBe(false);
	});

	it("flags a row that has detail but no name", () => {
		const errors = validateDecisionForm(
			form({ options: [{ title: "", detail: "Flexible schema" }] }),
		);
		expect(errors.optionRows?.[0]).toBeTruthy();
	});

	it("flags duplicate options case-insensitively, marking the second row", () => {
		const errors = validateDecisionForm(
			form({
				options: [
					{ title: "PostgreSQL", detail: "" },
					{ title: "postgresql", detail: "" },
				],
			}),
		);
		expect(errors.optionRows?.[0]).toBeUndefined();
		expect(errors.optionRows?.[1]).toBeTruthy();
	});

	it("caps an option title and its detail", () => {
		const long = validateDecisionForm(
			form({
				options: [{ title: "x".repeat(OPTION_TITLE_MAX + 1), detail: "" }],
			}),
		);
		expect(long.optionRows?.[0]).toContain(`${OPTION_TITLE_MAX}`);
	});
});

describe("hasDecisionErrors", () => {
	it("is false for an empty error object", () => {
		expect(hasDecisionErrors({})).toBe(false);
	});

	it("is false when optionRows is present but empty", () => {
		// The bug this guards: `Object.keys({optionRows: {}}).length > 0` is true.
		expect(hasDecisionErrors({ optionRows: {} })).toBe(false);
	});

	it("is true when only a row is bad", () => {
		expect(hasDecisionErrors({ optionRows: { 1: "nope" } })).toBe(true);
	});
});

describe("toCreateDecisionPayload", () => {
	it("trims and drops empty optional fields", () => {
		const payload = toCreateDecisionPayload(
			form({ title: "  Database choice  ", context: "   ", rationale: "" }),
		);
		expect(payload.title).toBe("Database choice");
		expect(payload.context).toBeUndefined();
		expect(payload.rationale).toBeUndefined();
	});

	it("omits options entirely when none were filled in", () => {
		const payload = toCreateDecisionPayload(
			form({ options: [{ title: "", detail: "" }] }),
		);
		expect(payload.options).toBeUndefined();
	});

	it("marks the chosen option, indexing against the ORIGINAL rows", () => {
		// The selected index points into the form's rows; if blank rows were
		// dropped before resolving it, the wrong option would come back selected.
		const payload = toCreateDecisionPayload(
			form({
				options: [
					{ title: "", detail: "" },
					{ title: "PostgreSQL", detail: "Strong relational integrity" },
					{ title: "MongoDB", detail: "" },
				],
				selectedOption: 2,
			}),
		);
		expect(payload.options?.map((o) => [o.title, o.is_selected])).toEqual([
			["PostgreSQL", false],
			["MongoDB", true],
		]);
	});

	it("sends no selection when nothing was chosen", () => {
		const payload = toCreateDecisionPayload(
			form({
				options: [{ title: "PostgreSQL", detail: "" }],
				selectedOption: null,
			}),
		);
		expect(payload.options?.every((o) => !o.is_selected)).toBe(true);
	});

	it("passes the status and visibility straight through", () => {
		const payload = toCreateDecisionPayload(
			form({ status: "proposed", visibility: "internal" }),
		);
		expect(payload.status).toBe("proposed");
		expect(payload.visibility).toBe("internal");
	});

	it("omits an unset category rather than sending an empty string", () => {
		// An empty string would fail the backend's @IsUUID and 400 the request.
		expect(
			toCreateDecisionPayload(form({ categoryId: "" })).category_id,
		).toBeUndefined();
	});
});

describe("validateCategoryName", () => {
	const existing = [
		{ id: "cat-1", name: "Technical" },
		{ id: "cat-2", name: "Design" },
	];

	it("accepts a fresh name", () => {
		expect(validateCategoryName("Security", existing)).toBeNull();
	});

	it("requires a name", () => {
		expect(validateCategoryName("   ", existing)).toBeTruthy();
	});

	it("rejects a case-insensitive duplicate, matching the unique index", () => {
		// uq_decision_categories_name is on lower(name); catching it here means a
		// message in the form rather than a 409 from the server.
		expect(validateCategoryName("technical", existing)).toBeTruthy();
		expect(validateCategoryName("  TECHNICAL  ", existing)).toBeTruthy();
	});

	it("lets a category keep its own name while renaming", () => {
		expect(validateCategoryName("Technical", existing, "cat-1")).toBeNull();
	});

	it("still rejects taking a sibling's name while renaming", () => {
		expect(validateCategoryName("Design", existing, "cat-1")).toBeTruthy();
	});

	it("enforces the length cap", () => {
		expect(
			validateCategoryName("x".repeat(CATEGORY_NAME_MAX + 1), existing),
		).toContain(`${CATEGORY_NAME_MAX}`);
	});
});

describe("validateOptionTitle", () => {
	it("rejects a duplicate of an option already listed", () => {
		expect(
			validateOptionTitle("postgresql", [{ title: "PostgreSQL" }]),
		).toBeTruthy();
	});

	it("accepts a new one", () => {
		expect(validateOptionTitle("Redis", [{ title: "PostgreSQL" }])).toBeNull();
	});

	it("requires a name", () => {
		expect(validateOptionTitle("  ", [])).toBeTruthy();
	});
});
