/* @vitest-environment jsdom */

// ux.md › Chrome: the Overview's "Time" property sends team managers to the
// team's Report and everyone else to their own time for this team.

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			search,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
		} & Record<string, unknown>) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			const query = new URLSearchParams(search ?? {}).toString();
			return (
				<a href={query ? `${href}?${query}` : href} {...rest}>
					{children}
				</a>
			);
		},
	};
});
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: { id: "w1", slug: "acme" },
		workspaces: [],
		isLoading: false,
	}),
}));
vi.mock("./TeamStatusSelector", () => ({ TeamStatusSelector: () => null }));

import type { Team, TeamMember } from "@/services/teams.service";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { TeamPropertiesPanel } from "./TeamPropertiesPanel";

const TEAM_ID = "0b6a3f1e-2c4d-4e8f-9a1b-3c5d7e9f1a2b";
const USER = "viewer";

function team(over: Partial<Team> = {}): Team {
	return {
		id: TEAM_ID,
		owner_id: "owner",
		workspace_id: "w1",
		name: "Northwind Studio",
		description: null,
		avatar_url: null,
		is_personal: false,
		time_tracking_enabled: true,
		member_rates_enabled: false,
		payouts_enabled: false,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...over,
	};
}

function member(userId: string, role: TeamMember["role"]): TeamMember {
	return {
		id: `m-${userId}`,
		team_id: TEAM_ID,
		user_id: userId,
		role,
		position: null,
		joined_at: "2026-01-01T00:00:00.000Z",
		user: null,
	};
}

function timeLink(): HTMLElement {
	return screen.getByRole("link", { name: "Tracking on" });
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as User });
});

afterEach(() => {
	cleanup();
	useAuthStore.setState({ user: null });
});

describe("TeamPropertiesPanel › Time", () => {
	it("sends a team admin to the team's Report", () => {
		render(
			<TeamPropertiesPanel
				team={team()}
				members={[member("owner", "owner"), member(USER, "admin")]}
				projectCount={2}
				canEdit
			/>,
		);
		expect(timeLink().getAttribute("href")).toBe(
			`/w/acme/teams/${TEAM_ID}/time`,
		);
	});

	it("sends the team's owner to the Report too", () => {
		render(
			<TeamPropertiesPanel
				team={team({ owner_id: USER })}
				members={[]}
				projectCount={0}
				canEdit
			/>,
		);
		expect(timeLink().getAttribute("href")).toBe(
			`/w/acme/teams/${TEAM_ID}/time`,
		);
	});

	it("sends a member to their own time for this team", () => {
		render(
			<TeamPropertiesPanel
				team={team()}
				members={[member("owner", "owner"), member(USER, "member")]}
				projectCount={2}
				canEdit={false}
			/>,
		);
		expect(timeLink().getAttribute("href")).toBe(`/time?for=team%3A${TEAM_ID}`);
	});

	it("reads Off with no link while the team's time is off", () => {
		render(
			<TeamPropertiesPanel
				team={team({ time_tracking_enabled: false, owner_id: USER })}
				members={[]}
				projectCount={0}
				canEdit
			/>,
		);
		expect(screen.queryByRole("link", { name: "Tracking on" })).toBeNull();
		expect(screen.getByText("Off")).toBeTruthy();
	});
});
