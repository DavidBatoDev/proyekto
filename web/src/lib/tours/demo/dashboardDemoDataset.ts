/**
 * Fixtures for the dashboard tour replay.
 *
 * Every id is prefixed `tour-demo-` so demo rows are greppable, assertable in
 * tests, and obviously not real if one ever escapes into a log. Nothing here is
 * ever written back — `TourDemoGuard` blocks navigation and interaction while
 * demo mode is on.
 */

import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import { deviceTimeZone } from "@/lib/timeFormat";
import type { Project } from "@/services/project.service";
import type { Team } from "@/services/teams.service";
import type { ApprovalRow, TimesheetSummary } from "@/services/time.types";
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
		member_rates_enabled: true,
		payouts_enabled: true,
		created_at: EARLIER,
		updated_at: NOW,
		members_count: 4,
		members_preview: [],
	},
	{
		id: "tour-demo-team-2",
		owner_id: DEMO_OWNER_ID,
		name: "My First Project",
		description: null,
		avatar_url: null,
		tags: [],
		is_personal: true,
		time_tracking_enabled: false,
		member_rates_enabled: false,
		payouts_enabled: false,
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

/**
 * One waiting timesheet for the "Waiting for your approval" card. Hours only:
 * the card never shows money, so neither does the fixture.
 */
function waitingSheet(fields: {
	id: string;
	member: { id: string; name: string };
	scopeKind: ApprovalRow["scope_kind"];
	label: string;
	totalSeconds: number;
	submittedAt: string;
	policyWorkspace: ApprovalRow["policy_workspace"];
}): ApprovalRow {
	return {
		id: fields.id,
		member_user_id: fields.member.id,
		member_display_name_snapshot: fields.member.name,
		scope_kind: fields.scopeKind,
		scope_ref: `${fields.id}-scope`,
		team_id: fields.scopeKind === "team" ? "tour-demo-team-1" : null,
		workspace_id: null,
		engagement_id:
			fields.scopeKind === "engagement" ? `${fields.id}-agreement` : null,
		scope_label_snapshot: fields.label,
		policy_workspace_id: fields.policyWorkspace?.id ?? null,
		period_kind: "weekly",
		period_start: "2026-01-05",
		period_end: "2026-01-11",
		// The reader's own zone, so the replay's period reads "Jan 5–11"
		// without a "(UTC)" suffix the real card would only show for a sheet
		// kept in another timezone.
		timezone: deviceTimeZone(),
		week_start: 1,
		status: "submitted",
		approver_scope: fields.scopeKind === "engagement" ? "hirer" : "team",
		revision: 1,
		submitted_at: fields.submittedAt,
		submitted_by: fields.member.id,
		submission_kind: "manual",
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: fields.totalSeconds,
		payable_seconds: null,
		origin: "app",
		created_at: EARLIER,
		updated_at: fields.submittedAt,
		entry_count: 12,
		running_count: 0,
		logged_seconds: fields.totalSeconds,
		member: {
			id: fields.member.id,
			display_name: fields.member.name,
			avatar_url: null,
		},
		policy_workspace: fields.policyWorkspace,
		flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
	};
}

// Three waiting, two listed: the card shows "+1 more" the way it does for
// real. The second sheet belongs to another workspace, so it carries the tag.
const timeApprovals: { total: number; rows: ApprovalRow[] } = {
	total: 3,
	rows: [
		waitingSheet({
			id: "tour-demo-timesheet-1",
			member: { id: "tour-demo-member-1", name: "Maria Santos" },
			scopeKind: "team",
			label: "Northwind Studio",
			totalSeconds: 38 * 3600 + 15 * 60,
			submittedAt: "2026-01-13T09:30:00.000Z",
			policyWorkspace: null,
		}),
		waitingSheet({
			id: "tour-demo-timesheet-2",
			member: { id: "tour-demo-member-2", name: "Leo Cruz" },
			scopeKind: "engagement",
			label: "Acme Corp",
			totalSeconds: 12 * 3600,
			submittedAt: NOW,
			policyWorkspace: { id: "tour-demo-workspace-2", name: "Pixel Studio" },
		}),
	],
};

// No overdue sheet of the viewer's own during a replay: the welcome line's
// "Submit last week" nudge stays quiet rather than mixing real and demo data.
const timeTimesheets: TimesheetSummary[] = [];

export const DASHBOARD_DEMO_DATASET: TourDemoDataset = {
	teams,
	teamInvites: [],
	projects,
	projectInvites: [],
	roadmaps,
	// Keys read by components/home/dashboardTimeLine.ts (TIME_DEMO_KEYS).
	timeApprovals,
	timeTimesheets,
};
