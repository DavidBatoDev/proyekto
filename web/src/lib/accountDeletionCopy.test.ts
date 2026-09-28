import { describe, expect, it } from "vitest";
import {
	CONFIRMATION_PHRASE,
	deletionCopy,
	matchesConfirmationPhrase,
} from "./accountDeletionCopy";

/**
 * The delete-account flow ships inside the free mobile app, so it is under the
 * same rule as `usageCopy`: no price, no plan-change call to action, and no
 * link to a purchase surface. A reviewer finding one of those inside a free app
 * is the rejection this whole gate exists to avoid.
 */

/** Every string this module can produce, on the given surface. */
function allStrings(surface: "web" | "app"): string[] {
	const counts = {
		workspaces: 2,
		teams: 1,
		projects: 3,
		roadmaps: 1,
		devices: 2,
		apiTokens: 1,
	};
	const kept = {
		chatMessages: 12,
		comments: 4,
		decisions: 1,
		deliverables: 1,
		changeRequests: 1,
		risks: 1,
		activityEntries: 9,
		contracts: 2,
		invoices: 1,
		payouts: 1,
	};

	const billing = deletionCopy.billingNote("Acme Studio", surface);

	return [
		...Object.values(deletionCopy).filter(
			(value): value is string => typeof value === "string",
		),
		...deletionCopy.deletedBullets(counts),
		...deletionCopy.keptBullets(kept),
		deletionCopy.transferBody(3),
		deletionCopy.transferBody(0),
		deletionCopy.decisionsIntro(2),
		deletionCopy.successorWarning("Ayla"),
		deletionCopy.deleteContainerWarning("Acme", 5),
		deletionCopy.disabledBecauseUndecided(2),
		deletionCopy.runningBody(surface),
		billing.text,
		billing.link?.label ?? "",
		billing.link?.to ?? "",
	];
}

describe("account deletion copy on the installed app", () => {
	const strings = allStrings("app");

	it("names no price", () => {
		for (const value of strings) {
			expect(value).not.toMatch(/\$\s?\d/);
			expect(value).not.toMatch(/\bUSD\b/);
			expect(value).not.toMatch(/per month/i);
			expect(value).not.toMatch(/per user/i);
		}
	});

	it("links to no purchase surface", () => {
		for (const value of strings) {
			expect(value).not.toContain("/pricing");
			expect(value).not.toMatch(/\bupgrade\b/i);
		}
	});

	it("offers no way to change a plan", () => {
		expect(deletionCopy.billingNote("Acme", "app").link).toBeNull();
	});

	it("still explains what happens to a paid workspace", () => {
		// Silence would be worse than a link: the user has to know the plan goes
		// somewhere. It just cannot be a purchase steer.
		const note = deletionCopy.billingNote("Acme", "app");
		expect(note.text).toContain("Acme");
		expect(note.text.toLowerCase()).toContain("paid plan");
	});
});

describe("account deletion copy on the web", () => {
	it("may link to plans", () => {
		const note = deletionCopy.billingNote("Acme", "web");
		expect(note.link?.to).toBe("/pricing");
	});
});

describe("account deletion copy, generally", () => {
	it("never says Prodigy", () => {
		for (const value of allStrings("web")) {
			expect(value).not.toMatch(/prodigy/i);
		}
	});

	it("names the tombstone label the backend actually writes", () => {
		expect(deletionCopy.keptIntro).toContain("Deleted user");
		expect(deletionCopy.goodbyeKept).toContain("Deleted user");
	});

	it("omits a bullet at zero rather than saying 0", () => {
		const none = deletionCopy.deletedBullets({
			workspaces: 0,
			teams: 0,
			projects: 0,
			roadmaps: 0,
			devices: 0,
			apiTokens: 0,
		});
		expect(none.join(" ")).not.toMatch(/\b0 /);
		// The two unconditional lines survive.
		expect(none).toHaveLength(2);
	});

	it("gets singular and plural right", () => {
		const one = deletionCopy.deletedBullets({
			workspaces: 1,
			teams: 0,
			projects: 1,
			roadmaps: 0,
			devices: 0,
			apiTokens: 0,
		});
		expect(one.join(" ")).toContain("1 workspace nobody else is in");
		expect(one.join(" ")).toContain("1 project nobody else has access to");

		const many = deletionCopy.deletedBullets({
			workspaces: 2,
			teams: 0,
			projects: 2,
			roadmaps: 0,
			devices: 0,
			apiTokens: 0,
		});
		expect(many.join(" ")).toContain("2 workspaces");
		expect(many.join(" ")).toContain("2 projects");
	});

	it("says nothing needs handing over when nothing does", () => {
		expect(deletionCopy.transferBody(0).toLowerCase()).toContain("nothing");
	});
});

describe("confirmation phrase", () => {
	it("forgives case and surrounding whitespace", () => {
		expect(matchesConfirmationPhrase("delete my account")).toBe(true);
		expect(matchesConfirmationPhrase("  Delete My Account  ")).toBe(true);
		expect(matchesConfirmationPhrase("DELETE MY ACCOUNT")).toBe(true);
	});

	it("forgives nothing else", () => {
		expect(matchesConfirmationPhrase("")).toBe(false);
		expect(matchesConfirmationPhrase("delete account")).toBe(false);
		expect(matchesConfirmationPhrase("delete my acount")).toBe(false);
		expect(matchesConfirmationPhrase("deletemyaccount")).toBe(false);
	});

	it("is what the label tells the user to type", () => {
		expect(deletionCopy.confirmPhraseLabel).toContain(CONFIRMATION_PHRASE);
	});
});
