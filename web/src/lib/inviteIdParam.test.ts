import { describe, expect, it } from "vitest";
import { parseInviteIdParam } from "./inviteIdParam";

describe("parseInviteIdParam", () => {
	it("accepts a uuid, in either case", () => {
		expect(parseInviteIdParam("6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d")).toBe(
			"6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
		);
		expect(parseInviteIdParam("6F1B2C3D-4E5F-4A6B-8C9D-0E1F2A3B4C5D")).toBe(
			"6F1B2C3D-4E5F-4A6B-8C9D-0E1F2A3B4C5D",
		);
	});

	it.each([
		["", "empty"],
		["not-a-uuid", "arbitrary text"],
		["6f1b2c3d4e5f4a6b8c9d0e1f2a3b4c5d", "no dashes"],
		["6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5", "one char short"],
		["6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5dd", "one char long"],
		// The reason the guard exists: this value would otherwise reach a DOM
		// lookup and be reflected back into the URL.
		["<script>alert(1)</script>", "markup"],
		["../../etc/passwd", "traversal"],
	])("rejects %s (%s)", (raw) => {
		expect(parseInviteIdParam(raw)).toBeUndefined();
	});

	it.each([[null], [undefined], [42], [{}], [["a"]]])(
		"rejects the non-string %s",
		(raw) => {
			expect(parseInviteIdParam(raw)).toBeUndefined();
		},
	);
});
