/**
 * Fixtures for the dashboard tour replay.
 *
 * Every id is prefixed `tour-demo-` so demo rows are greppable, assertable in
 * tests, and obviously not real if one ever escapes into a log. Nothing here is
 * ever written back — `TourDemoGuard` blocks navigation and interaction while
 * demo mode is on.
 */

import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import type { Project } from "@/services/project.service";
import type { Team } from "@/services/teams.service";
import type { TourDemoDataset } from "../types";

const NOW = "2026-01-15T10:00:00.000Z";
const EARLIER = "2026-01-08T10:00:00.000Z";

const DEMO_OWNER_ID = "tour-demo-owner";

const teams: Team[] = [
	{
		id: "tour-demo-team-1",
		owner_id: DEMO_OWNER_ID,
		name: "Northwind Studio",
		description: "Design and delivery crew",
		avatar_url: null,
		tags: ["design", "delivery"],
		is_personal: false,
		time_tracking_enabled: true,
		created_at: EARLIER,
		updated_at: NOW,
		members_count: 4,
		members_preview: [],
	},
	{
		id: "tour-demo-team-2",
		owner_id: DEMO_OWNER_ID,
		name: "My Workspace",
		description: null,
		avatar_url: null,
		tags: [],
		is_personal: true,
		time_tracking_enabled: false,
		created_at: EARLIER,
		updated_at: EARLIER,
		members_count: 1,
		members_preview: [],
	},
];

// Varied statuses so the status chips actually render in more than one colour.
const projects: Project[] = [
	{
		id: "tour-demo-project-1",
		title: "Mobile app revamp",
		brief: "Rebuild the customer app around the new design system.",
		status: "active",
		owner_id: DEMO_OWNER_ID,
		created_at: EARLIER,
		updated_at: NOW,
	},
	{
		id: "tour-demo-project-2",
		title: "Q1 marketing site",
		brief: "New landing pages and pricing.",
		status: "bidding",
		owner_id: DEMO_OWNER_ID,
		created_at: EARLIER,
		updated_at: EARLIER,
	},
	{
		id: "tour-demo-project-3",
		title: "Billing migration",
		brief: "Move invoicing onto the new provider.",
		status: "draft",
		owner_id: DEMO_OWNER_ID,
		created_at: EARLIER,
		updated_at: EARLIER,
	},
];

const roadmaps: RoadmapPreview[] = [
	{
		id: "tour-demo-roadmap-1",
		project_id: "tour-demo-project-1",
		name: "Mobile app revamp roadmap",
		description: "Discovery through launch",
		owner_id: DEMO_OWNER_ID,
		status: "active",
		created_at: EARLIER,
		updated_at: NOW,
		project: { id: "tour-demo-project-1", title: "Mobile app revamp" },
		milestones: [],
		epics: [],
	} as unknown as RoadmapPreview,
	{
		id: "tour-demo-roadmap-2",
		project_id: null,
		name: "Billing migration plan",
		description: "Drafted with the AI assistant",
		owner_id: DEMO_OWNER_ID,
		status: "draft",
		created_at: EARLIER,
		updated_at: EARLIER,
		project: null,
		milestones: [],
		epics: [],
	} as unknown as RoadmapPreview,
];

export const DASHBOARD_DEMO_DATASET: TourDemoDataset = {
	teams,
	teamInvites: [],
	projects,
	projectInvites: [],
	roadmaps,
};
