import { describe, expect, it } from "vitest";
import {
	buildOnboardingPayload,
	mapLegacyLane,
	normalizeSignupLane,
} from "./onboardingLane";

describe("onboarding lane compatibility", () => {
	it("preserves the historical client default for legacy state without intent", () => {
		expect(mapLegacyLane("client_freelancer")).toBe("client");
	});

	it("maps explicit legacy freelancer and mixed intent to talent", () => {
		expect(mapLegacyLane("client_freelancer", "freelancer")).toBe("talent");
		expect(
			mapLegacyLane("client_freelancer", {
				client: true,
				freelancer: true,
			}),
		).toBe("talent");
	});

	it("keeps each new lane stable", () => {
		expect(mapLegacyLane("client", "freelancer")).toBe("client");
		expect(mapLegacyLane("talent", "client")).toBe("talent");
		expect(mapLegacyLane("consultant", "client")).toBe("consultant");
	});

	it("sends no intent for explicit roles", () => {
		expect(buildOnboardingPayload("client", "freelancer")).toEqual({
			lane: "client",
		});
		expect(buildOnboardingPayload("talent", "client")).toEqual({
			lane: "talent",
		});
		expect(buildOnboardingPayload("consultant")).toEqual({
			lane: "consultant",
		});
	});

	it("preserves legacy intent only for the combined lane", () => {
		expect(buildOnboardingPayload("client_freelancer")).toEqual({
			lane: "client_freelancer",
			intent: {
				client: true,
				freelancer: false,
			},
		});
	});

	it("normalizes legacy lanes into an explicit role", () => {
		expect(normalizeSignupLane("client_freelancer", undefined)).toBe("client");
		expect(normalizeSignupLane("client_freelancer", "freelancer")).toBe(
			"talent",
		);
		expect(normalizeSignupLane("consultant", undefined)).toBe("consultant");
	});
});
