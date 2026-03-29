import { describe, expect, it } from "vitest";
import { RoadmapAgentServiceError, isAgentTimeoutError } from "./roadmap-agent.service";

describe("roadmap agent service timeout detection", () => {
  it("detects timeout roadmap service errors", () => {
    const error = new RoadmapAgentServiceError(
      "Send AI message failed: timeout of 30000ms exceeded",
    );
    expect(isAgentTimeoutError(error)).toBe(true);
  });

  it("does not flag unrelated errors as timeout", () => {
    const error = new Error("validation failed");
    expect(isAgentTimeoutError(error)).toBe(false);
  });
});
