/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engagement } from "@/services/engagement.service";
import { EngagementPortfolio } from "./EngagementPortfolio";

afterEach(cleanup);

function engagement(overrides: Partial<Engagement> = {}): Engagement {
	return {
		id: "eng-1",
		kind: "talent_services",
		scope_mode: "project_specific",
		status: "active",
		origin: "contract",
		activated_by_contract_id: "contract-1",
		started_at: "2026-08-01T00:00:00Z",
		ended_at: null,
		cancelled_at: null,
		status_reason: null,
		viewer_position: "hirer",
		viewer_capacity: "consultant",
		counterparty: {
			position: "provider",
			user_id: "user-2",
			capacity: "talent",
			display_name_snapshot: "Dana Cruz",
			email_snapshot: "dana@example.com",
		},
		project_links: [
			{
				id: "link-1",
				project_id: "project-1",
				project_title_snapshot: "Test Project",
				basis: "contract_scope",
				status: "active",
				linked_at: "2026-08-01T00:00:00Z",
				ended_at: null,
			},
		],
		current_settings: null,
		current_rates: [
			{
				id: "rate-1",
				worker_user_id: "user-2",
				rate_kind: "cost",
				unit: "hour",
				work_type: null,
				amount: 1200,
				currency: "PHP",
				effective_from: "2026-08-01",
				effective_until: null,
			},
		],
		...overrides,
	};
}

describe("EngagementPortfolio", () => {
	it("explains why signed legacy contracts produce no engagement", () => {
		render(
			<EngagementPortfolio
				loading={false}
				error={null}
				items={[]}
				filtered={false}
				onClearProject={vi.fn()}
				onOpen={vi.fn()}
			/>,
		);
		// The old copy said only "sign a contract to start one", which reads as
		// broken to anyone looking at their own already-signed agreements.
		expect(screen.getByText(/before party seats existed/)).toBeTruthy();
	});

	it("says the project has none when a project filter is on", () => {
		render(
			<EngagementPortfolio
				loading={false}
				error={null}
				items={[]}
				filtered
				onClearProject={vi.fn()}
				onOpen={vi.fn()}
			/>,
		);
		expect(
			screen.getByText("No engagement is placed on this project yet"),
		).toBeTruthy();
		// The way out has to be offered, not just described.
		expect(
			screen.getByRole("button", { name: "Show all engagements" }),
		).toBeTruthy();
	});

	it("names the relationship from the viewer's own seat", () => {
		const { rerender } = render(
			<EngagementPortfolio
				loading={false}
				error={null}
				items={[engagement()]}
				filtered={false}
				onClearProject={vi.fn()}
				onOpen={vi.fn()}
			/>,
		);
		expect(screen.getByText("You hired Dana Cruz")).toBeTruthy();

		rerender(
			<EngagementPortfolio
				loading={false}
				error={null}
				items={[engagement({ viewer_position: "provider" })]}
				filtered={false}
				onClearProject={vi.fn()}
				onOpen={vi.fn()}
			/>,
		);
		expect(screen.getByText("Dana Cruz hired you")).toBeTruthy();
	});

	it("opens the engagement itself, not its contract", () => {
		const onOpen = vi.fn();
		render(
			<EngagementPortfolio
				loading={false}
				error={null}
				items={[engagement()]}
				filtered={false}
				onClearProject={vi.fn()}
				onOpen={onOpen}
			/>,
		);
		screen.getByRole("button", { name: /You hired Dana Cruz/ }).click();
		expect(onOpen).toHaveBeenCalledWith("eng-1");
	});

	it("surfaces a load failure instead of an empty list", () => {
		render(
			<EngagementPortfolio
				loading={false}
				error={new Error("Boom")}
				items={[]}
				filtered={false}
				onClearProject={vi.fn()}
				onOpen={vi.fn()}
			/>,
		);
		expect(screen.getByText("Could not load engagements")).toBeTruthy();
		expect(screen.getByText("Boom")).toBeTruthy();
	});
});
