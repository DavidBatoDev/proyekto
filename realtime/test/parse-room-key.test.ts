import { describe, expect, it } from "vitest";
import { parseRoomKey } from "../src/types";

describe("parseRoomKey", () => {
	it("parses each supported namespace", () => {
		expect(parseRoomKey("roadmap:abc")).toEqual({ type: "roadmap", id: "abc" });
		expect(parseRoomKey("chatroom:r1")).toEqual({ type: "chatroom", id: "r1" });
		expect(parseRoomKey("user:u1")).toEqual({ type: "user", id: "u1" });
	});

	it("keeps ids that contain colons (everything after the first)", () => {
		expect(parseRoomKey("roadmap:a:b")).toEqual({ type: "roadmap", id: "a:b" });
	});

	it("rejects unknown namespaces and malformed keys", () => {
		expect(parseRoomKey("teams:t1")).toBeNull();
		expect(parseRoomKey("bogus")).toBeNull();
		expect(parseRoomKey("roadmap:")).toBeNull();
		expect(parseRoomKey(":abc")).toBeNull();
		expect(parseRoomKey("")).toBeNull();
	});
});
