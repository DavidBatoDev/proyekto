import { describe, expect, it } from "vitest";
import { sanitizePresence } from "../src/room";

describe("sanitizePresence", () => {
  it("round-trips a present editingNodeId so the badge can render on peers", () => {
    const out = sanitizePresence(
      {
        userId: "u1",
        name: "Ada",
        avatarUrl: "https://x/a.png",
        color: "#ef4444",
        editingNodeId: "feature-123",
      },
      "fallback",
    );
    expect(out).toEqual({
      userId: "u1",
      name: "Ada",
      avatarUrl: "https://x/a.png",
      color: "#ef4444",
      editingNodeId: "feature-123",
    });
  });

  it("normalizes a missing/closed editingNodeId to null (clears the badge)", () => {
    expect(sanitizePresence({ userId: "u1" }, "fallback").editingNodeId).toBeNull();
    expect(
      sanitizePresence({ userId: "u1", editingNodeId: null }, "fallback")
        .editingNodeId,
    ).toBeNull();
    // Non-string ids are rejected rather than trusted.
    expect(
      sanitizePresence({ userId: "u1", editingNodeId: 42 }, "fallback")
        .editingNodeId,
    ).toBeNull();
  });

  it("falls back to the socket's userId when the payload omits it", () => {
    expect(sanitizePresence({}, "socket-user").userId).toBe("socket-user");
  });
});
