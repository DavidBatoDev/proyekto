/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressMeter } from "@/components/project/delivery/DeliveryPrimitives";
import { MeterBar, meterBarTone, UsageMeter } from "./UsageMeter";

afterEach(cleanup);

function fill(bar: HTMLElement): HTMLElement {
	return bar.firstElementChild as HTMLElement;
}

describe("MeterBar", () => {
	it("is an accessible progressbar with a token fill", () => {
		render(<MeterBar percent={40} label="Projects" />);
		const bar = screen.getByRole("progressbar", { name: "Projects" });
		expect(bar.getAttribute("aria-valuenow")).toBe("40");
		expect(bar.className).toContain("bg-muted");
		expect(bar.className).toContain("h-1.5");
		expect(fill(bar).className).toContain("bg-primary");
		expect(fill(bar).style.width).toBe("40%");
	});

	it("clamps out-of-range values", () => {
		render(<MeterBar percent={140} label="Over" />);
		const bar = screen.getByRole("progressbar", { name: "Over" });
		expect(bar.getAttribute("aria-valuenow")).toBe("100");
		expect(fill(bar).style.width).toBe("100%");
	});

	it("draws warning and danger tones with tokens", () => {
		render(
			<>
				<MeterBar percent={85} tone="warning" label="Warn" />
				<MeterBar percent={100} tone="danger" label="Full" />
			</>,
		);
		expect(
			fill(screen.getByRole("progressbar", { name: "Warn" })).className,
		).toContain("bg-warning");
		expect(
			fill(screen.getByRole("progressbar", { name: "Full" })).className,
		).toContain("bg-destructive");
	});

	it("leaves an untracked bar empty and indeterminate", () => {
		render(<MeterBar percent={null} label="Completion" />);
		const bar = screen.getByRole("progressbar", { name: "Completion" });
		expect(bar.hasAttribute("aria-valuenow")).toBe(false);
		expect(fill(bar).style.width).toBe("0%");
	});

	it("maps meter tones to bar tones", () => {
		expect(meterBarTone("ok")).toBe("default");
		expect(meterBarTone("unlimited")).toBe("default");
		expect(meterBarTone("warning")).toBe("warning");
		expect(meterBarTone("limit")).toBe("danger");
		expect(meterBarTone("over")).toBe("danger");
	});
});

describe("UsageMeter", () => {
	it("shows used of limit over a bar", () => {
		render(<UsageMeter label="Projects" used={2} limit={10} />);
		expect(screen.getByText("Projects")).toBeTruthy();
		expect(screen.getByText("2 of 10")).toBeTruthy();
		const bar = screen.getByRole("progressbar");
		expect(bar.getAttribute("aria-valuenow")).toBe("20");
		expect(fill(bar).className).toContain("bg-primary");
	});

	it("turns destructive at the limit, caption included", () => {
		render(
			<UsageMeter
				label="Teams"
				used={2}
				limit={2}
				caption="At Free's limit. New teams are blocked; everything you have stays."
			/>,
		);
		expect(screen.getByText("2 of 2")).toBeTruthy();
		expect(fill(screen.getByRole("progressbar")).className).toContain(
			"bg-destructive",
		);
		expect(screen.getByText(/At Free's limit/).className).toContain(
			"text-destructive",
		);
	});

	it("warns from 80%", () => {
		render(
			<UsageMeter label="Members" used={8} limit={10} caption="Only 2 left." />,
		);
		expect(fill(screen.getByRole("progressbar")).className).toContain(
			"bg-warning",
		);
		expect(screen.getByText("Only 2 left.").className).toContain(
			"text-warning-foreground",
		);
	});

	it("draws no bar for an unlimited count", () => {
		render(<UsageMeter label="Projects" used={1234} limit={null} />);
		expect(screen.getByText("1,234")).toBeTruthy();
		expect(screen.getByText("Unlimited")).toBeTruthy();
		expect(screen.queryByRole("progressbar")).toBeNull();
	});
});

describe("ProgressMeter keeps its API on the shared bar", () => {
	it("renders a percentage through MeterBar", () => {
		render(<ProgressMeter percent={60} caption="3/5 tasks" />);
		expect(screen.getByText("60%")).toBeTruthy();
		const bar = screen.getByRole("progressbar", { name: "3/5 tasks" });
		expect(fill(bar).style.width).toBe("60%");
	});

	it("says 'Not tracked' rather than drawing a 0% bar", () => {
		render(<ProgressMeter percent={null} />);
		expect(screen.getByText("Not tracked")).toBeTruthy();
		const bar = screen.getByRole("progressbar", { name: "Completion" });
		expect(bar.hasAttribute("aria-valuenow")).toBe(false);
	});
});
