import { describe, expect, it } from "vitest";
import { contractBannerText } from "./contractBannerText";

describe("contractBannerText", () => {
	it("names the contract on the web", () => {
		expect(contractBannerText(true, false)).toContain("signed contract");
		expect(contractBannerText(false, false)).toContain("signed contract");
	});

	it("never says contract in the installed app", () => {
		for (const enforce of [true, false]) {
			expect(contractBannerText(enforce, true).toLowerCase()).not.toContain(
				"contract",
			);
		}
	});
});
