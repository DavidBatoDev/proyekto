/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { TimeEntryView } from "@/services/time.types";
import { EntryBadge, EntryBadges } from "./EntryBadges";

type BadgeFields = Pick<
	TimeEntryView,
	"payout_id" | "legacy_status" | "cost" | "locked_reason"
>;

function fields(over: Partial<BadgeFields> = {}): BadgeFields {
	return {
		payout_id: null,
		legacy_status: null,
		cost: "visible",
		locked_reason: null,
		...over,
	};
}

afterEach(cleanup);

describe("EntryBadges", () => {
	it("renders nothing for an ordinary entry", () => {
		const { container } = render(<EntryBadges entry={fields()} />);
		expect(container.innerHTML).toBe("");
	});

	it("shows Paid in blue (the info token) on a row", () => {
		render(
			<EntryBadges
				entry={fields({ payout_id: "po1", locked_reason: "paid" })}
			/>,
		);
		const badge = screen.getByText("Paid");
		expect(badge.className).toContain("text-info");
		expect(badge.className).not.toMatch(/#[0-9a-f]{3,6}/i);
	});

	it("shows Billed to cost viewers on the web only", () => {
		const billed = fields({ locked_reason: "billed" });
		const { rerender } = render(<EntryBadges entry={billed} native={false} />);
		expect(screen.getByText("Billed")).toBeTruthy();
		rerender(<EntryBadges entry={billed} native />);
		expect(screen.queryByText("Billed")).toBeNull();
		rerender(
			<EntryBadges entry={{ ...billed, cost: "hidden" }} native={false} />,
		);
		expect(screen.queryByText("Billed")).toBeNull();
	});

	it("keeps the legacy markers for the detail", () => {
		const outside = fields({
			legacy_status: "paid_outside",
			locked_reason: "paid",
		});
		const { rerender } = render(<EntryBadges entry={outside} />);
		expect(screen.queryByText("Paid outside Proyekto")).toBeNull();
		rerender(<EntryBadges entry={outside} variant="detail" />);
		expect(screen.getByText("Paid outside Proyekto")).toBeTruthy();
		rerender(
			<EntryBadges
				entry={fields({ legacy_status: "rejected", locked_reason: "legacy" })}
				variant="detail"
			/>,
		);
		expect(screen.getByText("Not approved (legacy)")).toBeTruthy();
	});

	it("EntryBadge renders one badge by kind", () => {
		render(<EntryBadge kind="billed" size="md" />);
		expect(screen.getByText("Billed").getAttribute("data-badge")).toBe(
			"billed",
		);
	});
});
