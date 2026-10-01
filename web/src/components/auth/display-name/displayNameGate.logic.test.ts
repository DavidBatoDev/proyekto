import { describe, expect, it } from "vitest";
import {
	needsDisplayName,
	suggestedDisplayName,
	validateDisplayName,
} from "./displayNameGate.logic";

describe("needsDisplayName", () => {
	const unnamed = { display_name: null, first_name: null, last_name: null };

	it("prompts a signed-in person with no display name, new or existing", () => {
		expect(needsDisplayName(unnamed, "/w/acme/dashboard")).toBe(true);
		expect(needsDisplayName({ display_name: "   " }, "/")).toBe(true);
	});

	it("prompts on the invite-accept pages too", () => {
		expect(needsDisplayName(unnamed, "/invites/team/abc")).toBe(true);
	});

	it("leaves named people, guests and deleted accounts alone", () => {
		expect(needsDisplayName({ display_name: "Jamie" }, "/")).toBe(false);
		expect(needsDisplayName({ ...unnamed, is_guest: true }, "/")).toBe(false);
		expect(
			needsDisplayName({ ...unnamed, deleted_at: "2026-10-01" }, "/"),
		).toBe(false);
		expect(needsDisplayName(null, "/")).toBe(false);
	});

	it("stays out of the sign-in and consent pages", () => {
		expect(needsDisplayName(unnamed, "/auth/callback")).toBe(false);
		expect(needsDisplayName(unnamed, "/oauth/consent")).toBe(false);
		expect(needsDisplayName(unnamed, "/authors")).toBe(true);
	});
});

describe("suggestedDisplayName", () => {
	it("starts from the person's first and last name", () => {
		expect(
			suggestedDisplayName({
				display_name: null,
				first_name: " Jamie ",
				last_name: "Cruz",
			}),
		).toBe("Jamie Cruz");
		expect(suggestedDisplayName({ display_name: null })).toBe("");
	});
});

describe("validateDisplayName", () => {
	it("tidies whitespace and refuses blanks, emails and overlong names", () => {
		expect(validateDisplayName("  Jamie   Cruz ")).toEqual({
			ok: true,
			value: "Jamie Cruz",
		});
		expect(validateDisplayName("   ").ok).toBe(false);
		expect(validateDisplayName("jamie@example.com").ok).toBe(false);
		expect(validateDisplayName("x".repeat(81)).ok).toBe(false);
	});
});
