import { describe, expect, it } from "vitest";
import { isPersonalProject } from "./projectAccess";

describe("isPersonalProject", () => {
	it("classifies a personal project from its project access origin", () => {
		expect(
			isPersonalProject({
				members: [
					{
						user_id: "user-1",
						role: "owner",
						origin: "personal_project",
					},
				],
			}),
		).toBe(true);
	});

	it("still matches the legacy 'personal_workspace' DB literal", () => {
		expect(
			isPersonalProject({
				members: [
					{
						user_id: "user-1",
						role: "owner",
						origin: "personal_workspace",
					},
				],
			}),
		).toBe(true);
	});

	it("does not classify ordinary projects as personal projects", () => {
		expect(
			isPersonalProject({
				members: [{ user_id: "user-1", role: "owner", origin: "direct" }],
			}),
		).toBe(false);
	});
});
