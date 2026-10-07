/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalsTabText, resolveTimeTab, TimeTabs } from "./TimeTabs";

afterEach(() => cleanup());

describe("resolveTimeTab", () => {
	const base = { canApprove: true, hasOwnTime: true, waitingHere: 0 };
	it("never opens Approvals for someone who can't approve here", () => {
		expect(
			resolveTimeTab({ ...base, canApprove: false, requested: "approvals" }),
		).toBe("mine");
	});
	it("follows ?tab= when allowed", () => {
		expect(resolveTimeTab({ ...base, requested: "approvals" })).toBe(
			"approvals",
		);
		expect(
			resolveTimeTab({ ...base, hasOwnTime: false, requested: "mine" }),
		).toBe("mine");
	});
	it("defaults to Approvals without own time, else My time", () => {
		expect(resolveTimeTab({ ...base, hasOwnTime: false })).toBe("approvals");
		expect(resolveTimeTab(base)).toBe("mine");
	});
	it("lands #waiting deep links on Approvals while something waits", () => {
		expect(resolveTimeTab({ ...base, waitingHere: 2, hash: "waiting" })).toBe(
			"approvals",
		);
		expect(resolveTimeTab({ ...base, hash: "waiting" })).toBe("mine");
	});
});

describe("TimeTabs", () => {
	it("counts Approvals and switches", () => {
		const onChange = vi.fn();
		render(<TimeTabs value="mine" approvalsCount={3} onChange={onChange} />);
		expect(
			screen
				.getByRole("tab", { name: "My time" })
				.getAttribute("aria-selected"),
		).toBe("true");
		fireEvent.click(screen.getByRole("tab", { name: "Approvals (3)" }));
		expect(onChange).toHaveBeenCalledWith("approvals");
		expect(approvalsTabText(0)).toBe("Approvals");
	});
});
