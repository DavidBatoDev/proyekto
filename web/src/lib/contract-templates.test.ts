import { describe, expect, it } from "vitest";
import { teamOwnerTemplateLabel } from "./contract-templates";

describe("teamOwnerTemplateLabel", () => {
	it("names each Team Owner Agreement variant by its counterparty", () => {
		expect(teamOwnerTemplateLabel("team_owner:talent")).toBe(
			"Team Contractor Agreement",
		);
		expect(teamOwnerTemplateLabel("team_owner:consultant")).toBe(
			"Team Consulting Agreement",
		);
		expect(teamOwnerTemplateLabel("team_owner:client")).toBe(
			"Team Services Agreement",
		);
	});

	it("has no label for the standard agreement", () => {
		expect(teamOwnerTemplateLabel(null)).toBeNull();
		expect(teamOwnerTemplateLabel("standard")).toBeNull();
	});
});
