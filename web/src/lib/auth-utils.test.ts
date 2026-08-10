import { describe, expect, it } from "vitest";
import type { Profile } from "../types/profile.types";
import {
	isActiveConsultant,
	isClient,
	isConsultant,
	isTalent,
} from "./auth-utils";

const profile = (role: Profile["role"], is_consultant_verified = false) =>
	({ role, is_consultant_verified }) as Profile;

describe("account role helpers", () => {
	it("checks each durable identity", () => {
		expect(isClient(profile("client"))).toBe(true);
		expect(isTalent(profile("talent"))).toBe(true);
		expect(isConsultant(profile("consultant"))).toBe(true);
	});

	it("requires consultant role and verification for capability", () => {
		expect(isActiveConsultant(profile("consultant", true))).toBe(true);
		expect(isActiveConsultant(profile("consultant", false))).toBe(false);
		expect(isActiveConsultant(profile("talent", true))).toBe(false);
		expect(isActiveConsultant(profile("client", true))).toBe(false);
	});
});
