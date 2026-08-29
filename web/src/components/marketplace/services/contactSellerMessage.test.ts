import { describe, expect, it } from "vitest";
import { contactSellerMessage } from "./contactSellerMessage";

describe("contactSellerMessage", () => {
	it("references the service and the chosen tier with its formatted price", () => {
		const text = contactSellerMessage("Build a WordPress site", "USD", {
			title: "Full store",
			price: 300,
		});
		expect(text).toContain('"Build a WordPress site"');
		expect(text).toContain("Full store");
		expect(text).toContain("300");
	});

	it("still reads sensibly without a tier", () => {
		expect(contactSellerMessage("Logo design", "USD")).toBe(
			'Hi — I\'m interested in your service "Logo design".',
		);
	});

	it("does not blank the price on an unknown currency code", () => {
		const text = contactSellerMessage("SEO audit", "ZZZ", {
			title: "Starter",
			price: 80,
		});
		// Intl formats unknown-but-well-formed codes itself, with a
		// non-breaking space — assert loosely on code + amount.
		expect(text).toMatch(/ZZZ\s80/);
	});
});
