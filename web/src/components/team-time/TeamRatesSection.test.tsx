/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamMember, TeamMemberRate } from "@/services/teams.service";
import { TeamRatesSection } from "./TeamRatesSection";

const member: TeamMember = {
	id: "tm-1",
	team_id: "team-1",
	user_id: "user-1",
	role: "member",
	position: null,
	joined_at: "",
	user: {
		id: "user-1",
		display_name: "Maria Santos",
		avatar_url: null,
		email: null,
		first_name: null,
		last_name: null,
	},
};

const rate: TeamMemberRate = {
	id: "rate-1",
	team_id: "team-1",
	user_id: "user-1",
	project_id: "p1",
	rate_type: "hourly",
	fixed_amount: null,
	fixed_period: "month",
	hourly_rate: 25,
	training_hourly_rate: 15,
	currency: "PHP",
	custom_id: null,
	start_date: "2026-09-01",
	end_date: null,
	weekly_limit_hours: null,
	monthly_limit_hours: null,
	overtime_requires_approval: false,
	created_at: "",
	updated_at: "",
};

afterEach(() => {
	cleanup();
});

describe("TeamRatesSection", () => {
	it("says a rate prices approved time, with no 'log' as a noun", () => {
		const onViewLogs = vi.fn();
		const { container } = render(
			<TeamRatesSection
				members={[member]}
				activeRatesByUserId={{ "user-1": [rate] }}
				allRatesByUserId={{ "user-1": [rate] }}
				projectTitleById={{ p1: "Acme Website" }}
				loadingMembers={false}
				loadingRates={false}
				canManageRates
				pendingMemberById={{}}
				onViewLogs={onViewLogs}
				onOpenAddRate={vi.fn()}
				onManageMember={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("heading", { level: 2, name: "Member rates" }),
		).toBeTruthy();
		expect(
			screen.getByText("A rate prices a member's approved time on a project."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "View time" }));
		expect(onViewLogs).toHaveBeenCalledWith(member);

		const text = container.textContent ?? "";
		expect(text).not.toMatch(/\blogs?\b/i);
		expect(text).not.toContain("My Logs");
	});
});
