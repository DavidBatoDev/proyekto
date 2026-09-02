import { describe, expect, it } from "vitest";
import { isValidWorkspaceSlug, normalizeWorkspaceSlug } from "./workspaceSlug";

describe("normalizeWorkspaceSlug", () => {
	it("matches the database's slugify on the cases that matter", () => {
		expect(normalizeWorkspaceSlug("Prodigitality Workspace")).toBe(
			"prodigitality-workspace",
		);
		expect(normalizeWorkspaceSlug("August Teleg's Workspace")).toBe(
			"august-telegs-workspace",
		);
		expect(normalizeWorkspaceSlug("Earl Clyde Bañez's Workspace")).toBe(
			"earl-clyde-banezs-workspace",
		);
		expect(normalizeWorkspaceSlug("  --Acme__Corp!!  ")).toBe("acme-corp");
	});

	it("caps the length without leaving a trailing hyphen", () => {
		const long = normalizeWorkspaceSlug("very long workspace name ".repeat(10));
		expect(long.length).toBeLessThanOrEqual(60);
		expect(long.endsWith("-")).toBe(false);
	});
});

describe("isValidWorkspaceSlug", () => {
	it("accepts the normalized shape", () => {
		expect(isValidWorkspaceSlug("acme")).toBe(true);
		expect(isValidWorkspaceSlug("acme-corp-2")).toBe(true);
	});

	it("rejects bad shapes, short handles, and uuid look-alikes", () => {
		expect(isValidWorkspaceSlug("ab")).toBe(false);
		expect(isValidWorkspaceSlug("Acme")).toBe(false);
		expect(isValidWorkspaceSlug("acme--corp")).toBe(false);
		expect(isValidWorkspaceSlug("-acme")).toBe(false);
		expect(isValidWorkspaceSlug("00000000-0000-4000-8000-000000000000")).toBe(
			false,
		);
	});
});
