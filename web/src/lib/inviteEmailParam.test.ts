import { describe, expect, it } from "vitest";
import { parseInviteEmailParam } from "./inviteEmailParam";

/**
 * Runs on attacker-influenced input by design: a mention-invite email links to
 * signup with `?email=`, and whatever survives here is rendered into a form field
 * and written to sessionStorage.
 */
describe("parseInviteEmailParam", () => {
	it.each(["alice@example.com", "a.b+c@sub.example.co.uk"])(
		"accepts %s",
		(value) => {
			expect(parseInviteEmailParam(value)).toBe(value);
		},
	);

	it.each([
		["not-an-email"],
		["alice@"],
		["@example.com"],
		["alice@example"],
		["alice example@test.com"],
		[""],
		['"><script>alert(1)</script>'],
		["javascript:alert(1)"],
		["alice@example.com\r\nBcc: victim@x.test"],
	])("drops %p", (value) => {
		expect(parseInviteEmailParam(value)).toBeUndefined();
	});

	it.each([[42], [["a@b.co"]], [null], [undefined], [{}]])(
		"drops the non-string %p",
		(value) => {
			expect(parseInviteEmailParam(value)).toBeUndefined();
		},
	);

	it("drops an address past the RFC 5321 length", () => {
		expect(
			parseInviteEmailParam(`${"a".repeat(250)}@example.com`),
		).toBeUndefined();
	});
});
