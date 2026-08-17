import { describe, expect, it } from "vitest";
import {
	attachMarketplaceEnrollmentFields,
	consultantStatusFromEmbed,
	freelancerStatusFromEmbed,
	PROFILE_WITH_ENROLLMENT_SELECT,
} from "./marketplace-enrollment";

describe("PROFILE_WITH_ENROLLMENT_SELECT", () => {
	// Regression guard for the bug this module exists to fix: a plain
	// select("*") returns the derived fields as undefined, which silently
	// fails every capability gate closed.
	it("requests both enrollment embeds", () => {
		expect(PROFILE_WITH_ENROLLMENT_SELECT).toContain(
			"consultant_profile:consultant_profiles",
		);
		expect(PROFILE_WITH_ENROLLMENT_SELECT).toContain(
			"freelancer_profile:freelancer_profiles(status)",
		);
	});

	// consultant_profiles has two FKs to profiles (user_id, status_changed_by),
	// so dropping this hint makes the embed ambiguous and PostgREST rejects the
	// entire profile query — breaking sign-in, not just the capability fields.
	it("disambiguates the consultant embed by foreign key", () => {
		expect(PROFILE_WITH_ENROLLMENT_SELECT).toContain(
			"consultant_profiles!consultant_profiles_user_id_fkey(status)",
		);
	});
});

describe("consultantStatusFromEmbed", () => {
	it("reads an object embed", () => {
		expect(consultantStatusFromEmbed({ status: "verified" })).toBe("verified");
	});

	// PostgREST returns a to-one embed as an object or a single-element array
	// depending on how the relationship is resolved.
	it("reads a single-element array embed", () => {
		expect(consultantStatusFromEmbed([{ status: "suspended" }])).toBe(
			"suspended",
		);
	});

	it("returns null for a missing or empty enrollment", () => {
		expect(consultantStatusFromEmbed(null)).toBeNull();
		expect(consultantStatusFromEmbed(undefined)).toBeNull();
		expect(consultantStatusFromEmbed([])).toBeNull();
	});

	it("rejects a status outside the enum", () => {
		expect(consultantStatusFromEmbed({ status: "banana" })).toBeNull();
	});
});

describe("freelancerStatusFromEmbed", () => {
	it("accepts active and paused only", () => {
		expect(freelancerStatusFromEmbed({ status: "active" })).toBe("active");
		expect(freelancerStatusFromEmbed({ status: "paused" })).toBe("paused");
		expect(freelancerStatusFromEmbed({ status: "verified" })).toBeNull();
	});
});

describe("attachMarketplaceEnrollmentFields", () => {
	it("derives the four fields a verified consultant needs", () => {
		const result = attachMarketplaceEnrollmentFields({
			id: "user-1",
			consultant_profile: { status: "verified" },
			freelancer_profile: null,
		});

		expect(result.consultant_status).toBe("verified");
		expect(result.is_consultant_verified).toBe(true);
		expect(result.freelancer_status).toBeNull();
		expect(result.is_public).toBe(false);
	});

	it("treats a non-verified consultant as lacking the capability", () => {
		for (const status of ["pending", "suspended", "revoked"]) {
			const result = attachMarketplaceEnrollmentFields({
				consultant_profile: { status },
			});
			expect(result.consultant_status).toBe(status);
			expect(result.is_consultant_verified).toBe(false);
		}
	});

	it("marks an active freelancer public", () => {
		const result = attachMarketplaceEnrollmentFields({
			freelancer_profile: { status: "active" },
		});
		expect(result.is_public).toBe(true);
	});

	it("does not treat a paused freelancer as public", () => {
		const result = attachMarketplaceEnrollmentFields({
			freelancer_profile: { status: "paused" },
		});
		expect(result.freelancer_status).toBe("paused");
		expect(result.is_public).toBe(false);
	});

	it("drops the raw embeds so nothing downstream depends on their shape", () => {
		const result = attachMarketplaceEnrollmentFields({
			id: "user-1",
			consultant_profile: { status: "verified" },
			freelancer_profile: { status: "active" },
		}) as Record<string, unknown>;

		expect(result.consultant_profile).toBeUndefined();
		expect(result.freelancer_profile).toBeUndefined();
		expect(result.id).toBe("user-1");
	});

	it("defaults to no capability when the profile has no enrollment at all", () => {
		const result = attachMarketplaceEnrollmentFields({ id: "user-1" });

		expect(result.consultant_status).toBeNull();
		expect(result.freelancer_status).toBeNull();
		expect(result.is_consultant_verified).toBe(false);
		expect(result.is_public).toBe(false);
	});
});
