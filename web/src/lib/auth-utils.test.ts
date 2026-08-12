import { describe, expect, it } from "vitest";
import type { Profile } from "../types/profile.types";
import { isActiveConsultant } from "./auth-utils";

const profile = (is_consultant_verified: boolean | undefined) =>
	({ is_consultant_verified }) as Profile;

describe("consultant capability", () => {
	it("requires completed vetting", () => {
		expect(isActiveConsultant(profile(true))).toBe(true);
		expect(isActiveConsultant(profile(false))).toBe(false);
		expect(isActiveConsultant(profile(undefined))).toBe(false);
		expect(isActiveConsultant(null)).toBe(false);
	});
});
