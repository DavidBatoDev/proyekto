import { describe, expect, it } from "vitest";
import {
	EMPTY_CUSTOM_FIELDS,
	areProjectBriefFieldsEqual,
	getOverviewBriefState,
} from "./stateSync";
import type { ProjectBriefField } from "./types";

const fields: ProjectBriefField[] = [
	{ key: "Budget", value: "$10k", position: 0 },
	{ key: "Timeline", value: "Q3", position: 1 },
];

describe("overview state sync helpers", () => {
	it("uses a stable empty custom fields fallback", () => {
		expect(getOverviewBriefState(undefined)).toEqual({
			projectSummary: null,
			customFields: EMPTY_CUSTOM_FIELDS,
		});
		expect(getOverviewBriefState(null).customFields).toBe(EMPTY_CUSTOM_FIELDS);
		expect(getOverviewBriefState({ project_summary: "Plan" })).toEqual({
			projectSummary: "Plan",
			customFields: EMPTY_CUSTOM_FIELDS,
		});
	});

	it("passes through real custom fields without creating a fallback array", () => {
		const result = getOverviewBriefState({
			project_summary: "Plan",
			custom_fields: fields,
		});

		expect(result.projectSummary).toBe("Plan");
		expect(result.customFields).toBe(fields);
	});

	it("compares custom fields by content instead of reference", () => {
		expect(
			areProjectBriefFieldsEqual(fields, [
				{ key: "Budget", value: "$10k", position: 0 },
				{ key: "Timeline", value: "Q3", position: 1 },
			]),
		).toBe(true);

		expect(
			areProjectBriefFieldsEqual(fields, [
				{ key: "Budget", value: "$12k", position: 0 },
				{ key: "Timeline", value: "Q3", position: 1 },
			]),
		).toBe(false);
		expect(areProjectBriefFieldsEqual(fields, fields.slice(0, 1))).toBe(false);
	});
});
