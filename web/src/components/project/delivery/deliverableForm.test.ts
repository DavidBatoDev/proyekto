import { describe, expect, it } from "vitest";
import {
	CRITERION_MAX,
	type DeliverableFormValues,
	hasErrors,
	TITLE_MAX,
	toCreatePayload,
	todayIsoDate,
	validateCriterionLabel,
	validateDeliverableForm,
	validateEvidenceForm,
} from "./deliverableForm";

const base: DeliverableFormValues = {
	title: "Backend API",
	description: "",
	dueDate: "",
	criteria: [""],
};

describe("validateDeliverableForm", () => {
	it("accepts a title-only deliverable", () => {
		expect(hasErrors(validateDeliverableForm(base, "2026-08-17"))).toBe(false);
	});

	it("requires a title and ignores surrounding whitespace", () => {
		expect(
			validateDeliverableForm({ ...base, title: "   " }).title,
		).toBeDefined();
	});

	it("rejects an over-long title at the DTO's limit", () => {
		const title = "x".repeat(TITLE_MAX + 1);
		expect(validateDeliverableForm({ ...base, title }).title).toContain(
			String(TITLE_MAX),
		);
	});

	it("rejects a due date before today but accepts today itself", () => {
		expect(
			validateDeliverableForm({ ...base, dueDate: "2026-08-16" }, "2026-08-17")
				.dueDate,
		).toBeDefined();
		expect(
			validateDeliverableForm({ ...base, dueDate: "2026-08-17" }, "2026-08-17")
				.dueDate,
		).toBeUndefined();
	});

	it("ignores blank criteria rows rather than flagging them", () => {
		const errors = validateDeliverableForm(
			{ ...base, criteria: ["Deployed", "", "  "] },
			"2026-08-17",
		);
		expect(hasErrors(errors)).toBe(false);
	});

	it("flags a duplicate criterion on the second row only, case-insensitively", () => {
		const errors = validateDeliverableForm(
			{ ...base, criteria: ["Deployed", "deployed"] },
			"2026-08-17",
		);
		expect(errors.criteriaRows).toEqual({ 1: expect.any(String) });
	});

	it("flags an over-long criterion by row index", () => {
		const errors = validateDeliverableForm(
			{ ...base, criteria: ["ok", "x".repeat(CRITERION_MAX + 1)] },
			"2026-08-17",
		);
		expect(errors.criteriaRows?.[1]).toContain(String(CRITERION_MAX));
	});
});

describe("toCreatePayload", () => {
	it("trims, drops blank criteria, and omits empty optional fields", () => {
		expect(
			toCreatePayload({
				title: "  Backend API  ",
				description: "   ",
				dueDate: "",
				criteria: [" Deployed ", "", "Documented"],
			}),
		).toEqual({
			title: "Backend API",
			description: undefined,
			due_date: undefined,
			criteria: ["Deployed", "Documented"],
		});
	});
});

describe("todayIsoDate", () => {
	it("uses local calendar parts, not the UTC instant", () => {
		// 23:30 local on the 17th is already the 18th in UTC for UTC+8 —
		// toISOString() would report the wrong day.
		expect(todayIsoDate(new Date(2026, 7, 17, 23, 30))).toBe("2026-08-17");
	});
});

describe("validateEvidenceForm", () => {
	const evidence = { url: "", label: "", category: "github" as const };

	it("requires a URL", () => {
		expect(validateEvidenceForm(evidence).url).toBeDefined();
	});

	it("accepts http and https", () => {
		expect(
			validateEvidenceForm({
				...evidence,
				url: "https://github.com/x/y/pull/1",
			}).url,
		).toBeUndefined();
		expect(
			validateEvidenceForm({ ...evidence, url: "http://staging.internal" }).url,
		).toBeUndefined();
	});

	it("rejects a bare hostname and non-http schemes", () => {
		expect(
			validateEvidenceForm({ ...evidence, url: "github.com" }).url,
		).toBeDefined();
		expect(
			validateEvidenceForm({ ...evidence, url: "javascript:alert(1)" }).url,
		).toBeDefined();
	});
});

describe("validateCriterionLabel", () => {
	it("rejects blank and duplicate labels, accepts a new one", () => {
		expect(validateCriterionLabel("  ", [])).toBeTruthy();
		expect(validateCriterionLabel("Deployed", ["deployed "])).toBeTruthy();
		expect(validateCriterionLabel("Documented", ["Deployed"])).toBeNull();
	});
});
