import { describe, expect, it } from "vitest";
import { pickableProjectStatuses } from "./ProjectsGrid";

const keys = (current: string | null, native: boolean) =>
	pickableProjectStatuses(current, native).map(([key]) => key);

describe("pickableProjectStatuses", () => {
	it("offers every status in a browser, bidding included", () => {
		expect(keys("draft", false)).toContain("bidding");
		expect(keys("draft", false)).toContain("active");
	});

	it("never offers bidding in the app for a project not already in it", () => {
		expect(keys("draft", true)).not.toContain("bidding");
		expect(keys("active", true)).toEqual(
			expect.arrayContaining(["draft", "active", "paused", "completed"]),
		);
	});

	it("keeps bidding in the app when the project is already there, so the picker shows it", () => {
		expect(keys("bidding", true)).toContain("bidding");
		expect(keys("BIDDING", true)).toContain("bidding");
	});
});
