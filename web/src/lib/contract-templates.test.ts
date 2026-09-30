import { describe, expect, it } from "vitest";
import {
	recordedAgreementLabel,
	teamOwnerTemplateLabel,
} from "./contract-templates";

describe("recordedAgreementLabel", () => {
	it("says where and when the agreement was signed", () => {
		expect(recordedAgreementLabel("2026-03-01")).toBe(
			"Recorded agreement — signed outside Proyekto on March 1, 2026",
		);
	});

	it("still labels a record with no date", () => {
		expect(recordedAgreementLabel(null)).toBe(
			"Recorded agreement — signed outside Proyekto",
		);
	});
});

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
